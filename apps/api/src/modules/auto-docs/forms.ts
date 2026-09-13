// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-003 and ADO-004 preserve form history when a file or the editor changes it. */
import {
  AUTO_DOC_FIELD_TYPES,
  autoDocFormVersions,
  autoDocs,
  autoDocTemplateScans,
  desc,
  eq,
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
  })
  .superRefine((field, ctx) => {
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
export const FormSaveInput = z
  .strictObject({ fields: z.array(FormFieldInput) })
  .superRefine((definition, ctx) => {
    if (new Set(definition.fields.map((field) => field.slug)).size !== definition.fields.length)
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Each form field needs a distinct slug.",
      });
  });

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
  fields: AutoDocFormField[],
  prior?: Awaited<ReturnType<typeof latestForm>>,
) {
  const previous = prior === undefined ? await latestForm(tx, autoDocId) : prior;
  const [row] = await tx
    .insert(autoDocFormVersions)
    .values({
      autoDocId,
      versionNumber: (previous?.versionNumber ?? 0) + 1,
      definition: { fields },
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
  for (const slug of present)
    if (!known.has(slug)) {
      const label = slug.replaceAll("_", " ");
      result.push({
        slug,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        help: null,
        fieldType: "text",
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
    detectedFields(previous?.definition.fields ?? [], input.detection),
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
