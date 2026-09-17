// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-003 and ADO-004 preserve form history when a file or the editor changes it. */
import {
  AUTO_DOC_FIELD_TYPES,
  VALUE_CADENCES,
  AUTO_DOC_RULE_OPERATORS,
  AUTO_DOC_CONTRACT_ATTRIBUTES,
  autoDocFormVersions,
  autoDocs,
  autoDocTemplateScans,
  desc,
  eq,
  inArray,
  fields as catalogFields,
  type AutoDocFormDefinition,
  type AutoDocCondition,
  type AutoDocFormField,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { z } from "zod";
import { recordActivity } from "../../lib/activity.js";
import {
  AUTO_DOC_SLUG,
  detectAutoDocTemplate,
  type TemplateDetection,
} from "../../lib/auto-doc-template.js";
import { CurrencySchema } from "../../lib/currencies.js";
import { httpError } from "../../lib/problem.js";
import type { StorageAdapter } from "../../lib/storage/adapter.js";

export const FormFieldInput = z
  .strictObject({
    slug: z.string().min(1).max(120).regex(AUTO_DOC_SLUG),
    label: z.string().trim().min(1).max(200),
    help: z.string().max(4000).nullable().default(null),
    fieldType: z.enum(AUTO_DOC_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(200)).nullable().default(null),
    required: z.boolean().default(false),
    catalogFieldId: z.string().min(1).nullable().default(null),
    contractAttribute: z.enum(AUTO_DOC_CONTRACT_ATTRIBUTES).nullable().default(null),
    valueCurrency: CurrencySchema.nullable().optional(),
    valueCadence: z.enum(VALUE_CADENCES).nullable().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.catalogFieldId && field.contractAttribute)
      ctx.addIssue({
        code: "custom",
        path: ["catalogFieldId"],
        message: "Map a form field to one catalog Field or one Contract attribute.",
      });
    const select = field.fieldType === "single_select" || field.fieldType === "multi_select";
    if (select && (!field.options?.length || new Set(field.options).size !== field.options.length))
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choose distinct, non-empty options.",
      });
    if (!select && field.options !== null)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Only select fields take options.",
      });
  });
const RuleScalar = z.union([z.string().max(4000), z.number().finite(), z.boolean()]);
export const ConditionInput = z
  .strictObject({
    fieldSlug: z.string().regex(AUTO_DOC_SLUG),
    operator: z.enum(AUTO_DOC_RULE_OPERATORS),
    value: z.union([RuleScalar, z.array(RuleScalar).min(1), z.null()]),
  })
  .superRefine((rule, ctx) => {
    if (
      rule.operator === "is_set"
        ? rule.value !== null
        : rule.operator === "is_one_of"
          ? !Array.isArray(rule.value)
          : rule.value === null || Array.isArray(rule.value)
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message:
          "Use no value for is set, a list for is one of, and one value for equals or is not.",
      });
  });
export const ClauseRuleInput = ConditionInput.safeExtend({
  blockName: z.string().regex(AUTO_DOC_SLUG),
});
export const FormSaveInput = z
  .strictObject({
    fields: z.array(FormFieldInput),
    clauseRules: z.array(ClauseRuleInput).default([]),
  })
  .superRefine((definition, ctx) => {
    if (new Set(definition.fields.map((field) => field.slug)).size !== definition.fields.length)
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Each form field needs a distinct template placeholder.",
      });
    if (
      new Set(definition.clauseRules.map((rule) => rule.blockName)).size !==
      definition.clauseRules.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["clauseRules"],
        message: "Give each Block at most one Clause rule.",
      });
  });

export async function validateMaps(db: Executor, definition: AutoDocFormDefinition) {
  const ids = [
    ...new Set(
      definition.fields.flatMap((field) => (field.catalogFieldId ? [field.catalogFieldId] : [])),
    ),
  ];
  if (!ids.length) return;
  const rows = await db
    .select()
    .from(catalogFields)
    .where(inArray(catalogFields.id, ids))
    .for("share");
  const admitted = new Set(
    rows
      .filter((field) => !field.archivedAt && field.moduleScope === "contract")
      .map((field) => field.id),
  );
  const gaps = definition.fields
    .filter((field) => field.catalogFieldId && !admitted.has(field.catalogFieldId))
    .map((field) => `Map "${field.label}" to a live catalog Field with contract scope.`);
  if (gaps.length) throw httpError(400, gaps.join(" "));
}

/**
 * The form field types a format directive can print, matching the fill's
 * value resolver, with the type a fresh detection mints first. Text styles and `upper` accept
 * any answer type.
 */
function directiveNeeds(
  directive: string,
): { types: AutoDocFormField["fieldType"][]; named: string } | null {
  if (directive.startsWith("date:")) return { types: ["date"], named: "a date" };
  if (directive.startsWith("currency:"))
    return { types: ["currency", "number"], named: "a currency or number" };
  return null;
}

export function conditionGaps(
  definition: AutoDocFormDefinition,
  rule: AutoDocCondition,
  label: string,
): string[] {
  const gaps: string[] = [];
  const field = definition.fields.find((field) => field.slug === rule.fieldSlug);
  if (!field) gaps.push(`${label} refers to a field that is no longer available.`);
  else if (field.options && rule.operator !== "is_set") {
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    for (const value of values)
      if (typeof value !== "string" || !field.options.includes(value))
        gaps.push(
          `${label} names option "${String(value)}" that "${field.label}" no longer holds.`,
        );
  } else if (rule.operator !== "is_set") {
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    const expected =
      field.fieldType === "number" || field.fieldType === "currency"
        ? "number"
        : field.fieldType === "boolean"
          ? "boolean"
          : "string";
    if (values.some((value) => typeof value !== expected))
      gaps.push(`${label} needs ${expected} values for "${field.label}".`);
  }
  return gaps;
}

export function publicationGaps(
  definition: AutoDocFormDefinition,
  detection: TemplateDetection,
): string[] {
  const fields = new Map(definition.fields.map((field) => [field.slug, field]));
  const gaps = [...new Set(detection.placeholders)]
    .filter((slug) => !fields.has(slug))
    .map((slug) => `Add a form field for Placeholder "${slug}".`);
  for (const rule of definition.clauseRules ?? []) {
    if (!detection.blocks.includes(rule.blockName))
      gaps.push(`Clause rule "${rule.blockName}" names a Block this file does not hold.`);
    gaps.push(...conditionGaps(definition, rule, `Clause rule "${rule.blockName}"`));
  }
  // Scans saved before directives were detected hold none, so they add no gap.
  for (const { slug, directive } of detection.directives ?? []) {
    const needs = directiveNeeds(directive);
    const field = fields.get(slug);
    if (!needs || !field || needs.types.includes(field.fieldType)) continue;
    gaps.push(
      `Set "${field.label}" to ${needs.named} field for Placeholder "{{${slug}|${directive}}}".`,
    );
  }
  return gaps;
}

export async function latestForm(db: Executor, autoDocId: string) {
  const [row] = await db
    .select()
    .from(autoDocFormVersions)
    .where(eq(autoDocFormVersions.autoDocId, autoDocId))
    .orderBy(desc(autoDocFormVersions.versionNumber))
    .limit(1);
  return row ?? null;
}

/** Caller holds the Auto-Doc row lock, so every snapshot receives its own number. */
export async function appendForm(
  tx: Transaction,
  autoDocId: string,
  actorId: string,
  definition: AutoDocFormDefinition,
  prior?: Awaited<ReturnType<typeof latestForm>>,
) {
  const previous = prior === undefined ? await latestForm(tx, autoDocId) : prior;
  const [row] = await tx
    .insert(autoDocFormVersions)
    .values({
      autoDocId,
      versionNumber: (previous?.versionNumber ?? 0) + 1,
      definition,
      createdBy: actorId,
    })
    .returning();
  await tx
    .update(autoDocs)
    .set({ updatedAt: new Date(), updatedBy: actorId })
    .where(eq(autoDocs.id, autoDocId));
  return row!;
}

export function detectedFields(
  previous: AutoDocFormField[],
  detection: TemplateDetection,
): AutoDocFormField[] {
  const present = new Set(detection.placeholders);
  const result = previous.map((field) => ({
    ...field,
    placeholder: field.placeholder || present.has(field.slug),
  }));
  const known = new Set(result.map((field) => field.slug));
  // A new Placeholder that carries a format directive arrives as the field
  // type that directive prints. Two directives that disagree stay text and
  // publication names the gap.
  const minted = new Map<string, AutoDocFormField["fieldType"]>();
  for (const { slug, directive } of detection.directives ?? []) {
    const wanted = directiveNeeds(directive)?.types[0];
    if (!wanted) continue;
    const held = minted.get(slug);
    minted.set(slug, held === undefined || held === wanted ? wanted : "text");
  }
  for (const slug of present)
    if (!known.has(slug)) {
      const label = slug.replaceAll("_", " ");
      result.push({
        slug,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        help: null,
        fieldType: minted.get(slug) ?? "text",
        options: null,
        required: false,
        displayOrder: result.length,
        placeholder: true,
      });
      known.add(slug);
    }
  return result;
}

/** Used by both the Auto-Doc upload and the ordinary Document Version upload. */
export async function applyTemplateVersion(
  tx: Transaction,
  input: {
    autoDocId: string;
    name: string;
    actorId: string;
    documentId: string;
    versionId: string;
    versionNumber: number;
    detection: TemplateDetection;
  },
) {
  await tx
    .insert(autoDocTemplateScans)
    .values({ documentVersionId: input.versionId, detection: input.detection });
  const previous = await latestForm(tx, input.autoDocId);
  await appendForm(
    tx,
    input.autoDocId,
    input.actorId,
    {
      fields: detectedFields(previous?.definition.fields ?? [], input.detection),
      clauseRules: previous?.definition.clauseRules ?? [],
    },
    previous,
  );
  await tx
    .update(autoDocs)
    .set({ templateDocumentId: input.documentId })
    .where(eq(autoDocs.id, input.autoDocId));
  await recordActivity(tx, {
    entityType: "auto_doc",
    entityId: input.autoDocId,
    actorId: input.actorId,
    action: "auto_doc.template_uploaded",
    visibility: "legal_only",
    payload: {
      name: input.name,
      documentId: input.documentId,
      versionId: input.versionId,
      versionNumber: input.versionNumber,
    },
  });
}

export function detectTemplateUpload(bytes: Buffer, filename: string): TemplateDetection {
  if (!filename.toLowerCase().endsWith(".docx"))
    throw httpError(400, "Upload a Word .docx file as the Auto-Doc template.");
  try {
    return detectAutoDocTemplate(bytes);
  } catch (error) {
    throw httpError(
      400,
      error instanceof Error ? error.message : "The Word template could not be read.",
    );
  }
}

export async function detectStoredTemplate(
  storage: StorageAdapter,
  fileRef: string,
  filename: string,
  maxBytes: number,
) {
  const stream = await storage.get(fileRef);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > maxBytes) {
      stream.destroy();
      throw httpError(413, "The Word template exceeds the upload limit.");
    }
    chunks.push(chunk);
  }
  return detectTemplateUpload(Buffer.concat(chunks), filename);
}
