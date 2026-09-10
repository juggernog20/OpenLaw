// SPDX-License-Identifier: AGPL-3.0-only
/** Source collection and validation for Matter Conversion drafts (INT-008). */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  aiConnector,
  and,
  asc,
  comments,
  eq,
  fields as catalogFields,
  isNull,
  matterTypeFields,
  matterTypes,
  requestAttachments,
  requestTypeFields,
  requests,
  users,
  type Executor,
} from "@openlaw/db";
import { type ConversionSuggestion } from "@openlaw/shared";
import {
  coerceCustomFieldValue,
  selectAttachedFields,
  CustomFieldValueSchema,
} from "./custom-fields.js";
import type { AiExtraction, AiExtractionTarget, AiSource } from "./ai/provider.js";
import { httpError } from "./problem.js";

export const ConversionSuggestionSchema = z.object({
  value: CustomFieldValueSchema,
  citations: z.array(z.object({ sourceId: z.string(), revision: z.string(), quote: z.string() })),
});
export const ConversionProvenanceSchema = z
  .record(
    z.string(),
    z.object({
      draftId: z.string(),
      writtenAt: z.string(),
      targetTypeId: z.string().optional(),
      keyDateId: z.string().optional(),
    }),
  )
  .nullable();
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const normalizeQuote = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
export async function matterPreparationEnabled(db: Executor, lock = false) {
  const query = db
    .select({ enabled: aiConnector.matterPreparation, disabledAt: aiConnector.disabledAt })
    .from(aiConnector)
    .limit(1);
  const [row] = await (lock ? query.for("share") : query);
  return row?.enabled === true && row.disabledAt === null;
}
export async function conversionSources(db: Executor, requestId: string, lockSources = false) {
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, requestId), isNull(requests.archivedAt)))
    .limit(1);
  if (!row) throw httpError(404, "The Request is unavailable.");
  if (lockSources)
    await db
      .select({ id: catalogFields.id })
      .from(catalogFields)
      .innerJoin(requestTypeFields, eq(requestTypeFields.fieldId, catalogFields.id))
      .where(eq(requestTypeFields.typeId, row.requestTypeId))
      .for("share", { of: catalogFields });
  const fields = await selectAttachedFields(db, requestTypeFields, row.requestTypeId);
  const all: (AiSource & { restricted: boolean })[] = [];
  function add(source: Omit<AiSource, "revision">, restricted = false) {
    all.push({ ...source, revision: hash(source), restricted });
  }
  for (const [name, value] of Object.entries({
    summary: row.summary,
    description: row.description,
    urgency: row.urgency,
  })) {
    if (value)
      add({
        id: `request:${row.id}:${name}`,
        kind: "request",
        label: `R-${row.number} ${name}`,
        text: value,
        createdAt: row.createdAt.toISOString(),
      });
  }
  for (const field of fields) {
    const value = row.customFields[field.slug];
    if (value === undefined) continue;
    add(
      {
        id: `field:${row.id}:${field.slug}`,
        kind: "field",
        label: `${field.displayName} (${field.fieldType})`,
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
      field.fieldTag === "legal" || field.fieldType === "entity" || field.fieldType === "user",
    );
  }
  const threadId = row.convertedMatterId ?? row.convertedContractId ?? row.id;
  const threadType = row.convertedMatterId
    ? "matter"
    : row.convertedContractId
      ? "contract"
      : "request";
  const messages = await db
    .select({
      id: comments.id,
      body: comments.body,
      visibility: comments.visibility,
      author: users.displayName,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(
      and(
        eq(comments.entityId, threadId),
        eq(comments.entityType, threadType),
        isNull(comments.deletedAt),
        isNull(comments.redactedAt),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id));
  for (const message of messages) {
    add(
      {
        id: `message:${message.id}`,
        kind: "message",
        label: `${message.author} — ${message.createdAt.toISOString()}`,
        author: message.author,
        createdAt: message.createdAt.toISOString(),
        text: message.body,
      },
      message.visibility !== "full_thread",
    );
    all[all.length - 1]!.revision = hash([
      message.body,
      message.editedAt?.toISOString() ?? null,
      message.visibility,
    ]);
  }
  const warnings: string[] = [];
  if (all.some((s) => s.restricted)) warnings.push("restricted_sources");
  const paper = await db
    .select({ id: requestAttachments.id })
    .from(requestAttachments)
    .where(eq(requestAttachments.requestId, row.id))
    .limit(1);
  if (paper.length) warnings.push("attachments_not_read");
  let characters = 0;
  const sources = all
    .filter((source) => {
      if (source.restricted) return false;
      if (characters + source.text.length > 180_000) {
        warnings.push("source_budget");
        return false;
      }
      characters += source.text.length;
      return true;
    })
    .slice(0, 200)
    .map(({ id, revision, kind, label, text, author, createdAt }) => ({
      id,
      revision,
      kind,
      label,
      text,
      author,
      createdAt,
    }));
  if (all.filter((s) => !s.restricted).length > 200) warnings.push("source_budget");
  return { row, all, sources, warnings: [...new Set(warnings)] };
}
export async function conversionContext(
  db: Executor,
  requestId: string,
  targetTypeId: string,
  lockSources = false,
) {
  const source = await conversionSources(db, requestId, lockSources);
  const types = await db
    .select({ id: matterTypes.id, name: matterTypes.displayName })
    .from(matterTypes)
    .where(isNull(matterTypes.archivedAt))
    .orderBy(asc(matterTypes.id));
  if (targetTypeId && !types.some((t) => t.id === targetTypeId))
    throw httpError(409, "Choose a live Matter Type.");
  const perType: { typeId: string; fields: Awaited<ReturnType<typeof selectAttachedFields>> }[] =
    [];
  for (const type of types)
    perType.push({
      typeId: type.id,
      fields: await selectAttachedFields(db, matterTypeFields, type.id),
    });
  const fields = [
    ...new Map(perType.flatMap((type) => type.fields).map((field) => [field.slug, field])).values(),
  ];
  const allTargets: AiExtractionTarget[] = [
    { slug: "title", prompt: "Propose a concise opening Matter title, at most 200 characters." },
    {
      slug: "matter_type",
      prompt: `Choose an eligible Matter Type id only when supported: ${JSON.stringify(types)}.`,
    },
    {
      slug: "description",
      prompt:
        "Synthesize a useful Matter Overview description from the supported facts, at most 10000 characters. Cite all supporting passages. No legal risk assessment.",
    },
    {
      slug: "priority",
      prompt: "Propose priority: low, medium, high, critical. Request urgency is the default.",
    },
    {
      slug: "needed_by",
      prompt:
        "Extract the explicitly stated Needed by date as YYYY-MM-DD. Do not guess missing date parts.",
    },
    ...fields
      .filter((f) => f.fieldType !== "user" && f.fieldType !== "entity")
      .map((f) => ({
        slug: `field:${f.slug}`,
        prompt: `${f.displayName}: ${f.fieldType}. ${f.options ? `Allowed options: ${JSON.stringify(f.options)}.` : ""} ${f.description ?? ""}`,
      })),
  ];
  let promptCharacters = 0;
  const targets = allTargets.filter((target, index) => {
    if (index >= 100 || promptCharacters + target.prompt.length > 20_000) return false;
    promptCharacters += target.prompt.length;
    return true;
  });
  if (targets.length !== allTargets.length) source.warnings.push("target_budget");
  return { ...source, fields, types, targets, snapshot: hash([source.all, types, perType]) };
}
export function checkedSuggestion(
  answer: AiExtraction,
  context: Awaited<ReturnType<typeof conversionContext>>,
): ConversionSuggestion | null {
  const citations = answer.citations?.length
    ? answer.citations
    : answer.sourceId && answer.evidence
      ? [{ sourceId: answer.sourceId, quote: answer.evidence }]
      : [];
  if (!citations.length || citations.length > 20) return null;
  const checked = citations.flatMap((citation) => {
    const source = context.sources.find((s) => s.id === citation.sourceId);
    return source &&
      citation.quote.trim() &&
      citation.quote.length <= 4000 &&
      normalizeQuote(source.text).includes(normalizeQuote(citation.quote))
      ? [{ ...citation, revision: source.revision }]
      : [];
  });
  if (checked.length !== citations.length) return null;
  const raw = answer.value;
  let value: ConversionSuggestion["value"] | null = null;
  if (answer.conflict) value = "Review conflicting sources";
  else if (answer.slug === "title" || answer.slug === "description")
    value =
      typeof raw === "string" && raw.trim() && raw.length <= (answer.slug === "title" ? 200 : 10000)
        ? raw.trim()
        : null;
  else if (answer.slug === "matter_type")
    value = typeof raw === "string" && context.types.some((t) => t.id === raw) ? raw : null;
  else if (answer.slug === "priority")
    value = ["low", "medium", "high", "critical"].includes(String(raw)) ? String(raw) : null;
  else if (answer.slug === "needed_by") {
    const result = z.iso.date().safeParse(raw);
    value = result.success ? result.data : null;
  } else {
    const field = context.fields.find((f) => `field:${f.slug}` === answer.slug);
    if (field && field.fieldType !== "user" && field.fieldType !== "entity") {
      const parsed = CustomFieldValueSchema.safeParse(raw);
      if (parsed.success)
        try {
          value = coerceCustomFieldValue(field, parsed.data);
        } catch {
          /* Invalid proposals stay out of the creation form. */
        }
    }
  }
  return value === null ? null : { value, citations: checked };
}
