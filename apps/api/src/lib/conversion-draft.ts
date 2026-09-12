// SPDX-License-Identifier: AGPL-3.0-only
/** Source collection and validation for Conversion drafts (INT-008). */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  aiConnector,
  and,
  asc,
  comments,
  commentAttachments,
  inArray,
  eq,
  fields as catalogFields,
  isNull,
  matterTypeFields,
  matterTypes,
  contractTypes,
  contractTypeFields,
  requestAttachments,
  requestTypeFields,
  requests,
  users,
  type Executor,
} from "@openlaw/db";
import {
  MAX_COUNTERPARTY_NAME_LENGTH,
  INTAKE_CARRY_SLUGS,
  sameConversionValue,
  type ConversionSuggestion,
  type ConversionAttachmentRead,
} from "@openlaw/shared";
import {
  coerceCustomFieldValue,
  selectAttachedFields,
  CustomFieldValueSchema,
} from "./custom-fields.js";
import type { AiExtraction, AiExtractionTarget, AiSource } from "./ai/provider.js";
import { type AttachmentSource } from "./conversion-attachments.js";
import { httpError } from "./problem.js";

export const ConversionSuggestionSchema = z.object({
  value: CustomFieldValueSchema,
  citations: z.array(z.object({ sourceId: z.string(), revision: z.string(), quote: z.string() })),
  justification: z.string().max(1000).optional(),
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
export async function preparationEnabled(
  db: Executor,
  module: "matter" | "contract",
  lock = false,
) {
  const query = db
    .select({
      enabled:
        module === "matter" ? aiConnector.matterPreparation : aiConnector.contractPreparation,
      disabledAt: aiConnector.disabledAt,
    })
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
  const attachments: AttachmentSource[] = [];
  const paper = await db
    .select()
    .from(requestAttachments)
    .where(eq(requestAttachments.requestId, row.id))
    .orderBy(asc(requestAttachments.createdAt), asc(requestAttachments.id));
  for (const file of paper)
    attachments.push({
      id: `attachment:${file.id}`,
      label: file.filename,
      fileRef: file.fileRef,
      revision: hash([file.id, file.fileRef, file.filename]),
      restricted: false,
      versionId: file.promotedVersionId,
    });
  if (messages.length) {
    const files = await db
      .select()
      .from(commentAttachments)
      .where(
        inArray(
          commentAttachments.commentId,
          messages.map((m) => m.id),
        ),
      )
      .orderBy(asc(commentAttachments.createdAt), asc(commentAttachments.id));
    for (const file of files) {
      const message = messages.find((m) => m.id === file.commentId)!;
      attachments.push({
        id: `message-attachment:${file.id}`,
        label: file.filename,
        fileRef: file.fileRef,
        revision: hash([file.id, file.fileRef, file.filename, message.visibility]),
        restricted: message.visibility !== "full_thread",
        versionId: file.filedVersionId,
      });
    }
  }
  const sources = all
    .filter((source) => !source.restricted)
    .map(({ id, revision, kind, label, text, author, createdAt }) => ({
      id,
      revision,
      kind,
      label,
      text,
      author,
      createdAt,
    }));
  return { row, all, sources, attachments, warnings: [...new Set(warnings)] };
}
export async function conversionContext(
  db: Executor,
  requestId: string,
  targetTypeId: string,
  lockSources = false,
  targetModule: "matter" | "contract" = "matter",
) {
  const source = await conversionSources(db, requestId, lockSources);
  const typeTable = targetModule === "matter" ? matterTypes : contractTypes;
  const typeFields = targetModule === "matter" ? matterTypeFields : contractTypeFields;
  const moduleLabel = targetModule === "matter" ? "Matter" : "Contract";
  const types = await db
    .select({ id: typeTable.id, name: typeTable.displayName })
    .from(typeTable)
    .where(isNull(typeTable.archivedAt))
    .orderBy(asc(typeTable.id));
  if (targetTypeId && !types.some((t) => t.id === targetTypeId))
    throw httpError(409, `Choose a live ${moduleLabel} Type.`);
  // A chosen Type answers for itself; only an unanswered target reads
  // every live Type. The whole context is rebuilt on each freshness
  // check and on each poll, so a read per Type is a read per second.
  const asked = targetTypeId ? types.filter((type) => type.id === targetTypeId) : types;
  const attached: Awaited<ReturnType<typeof selectAttachedFields>>[] = [];
  for (const type of asked) attached.push(await selectAttachedFields(db, typeFields, type.id));
  const fields = [...new Map(attached.flat().map((field) => [field.slug, field])).values()];
  const allTargets: AiExtractionTarget[] = [
    {
      slug: "title",
      prompt: `Propose a concise opening ${moduleLabel} title, at most 200 characters.`,
    },
    {
      slug: `${targetModule}_type`,
      prompt: `Choose an eligible ${moduleLabel} Type id only when supported: ${JSON.stringify(asked)}.`,
    },
    {
      slug: "description",
      prompt: `Synthesize a useful ${moduleLabel} Overview description from the supported facts, at most 10000 characters. Cite all supporting passages. No legal risk assessment.`,
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
    ...(targetModule === "contract"
      ? [
          {
            slug: "counterparty",
            prompt: `Extract the explicitly named Counterparty legal name, at most ${MAX_COUNTERPARTY_NAME_LENGTH} characters. Never invent a name.`,
          },
        ]
      : []),
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
  return {
    ...source,
    targetModule,
    targetTypeId,
    fields,
    types,
    targets,
    snapshot: hash([
      "complete-sources-v2",
      targetModule,
      targetTypeId,
      source.all,
      source.attachments.map((a) => ({
        id: a.id,
        revision: a.revision,
        label: a.label,
        fileRef: a.fileRef,
        restricted: a.restricted,
      })),
      types,
      // The attached Fields the targets were built from, in the same
      // order as the Types above. Re-attaching a Field the proposal
      // could use makes the draft stale.
      attached,
    ]),
  };
}
/** Exact source identity, quote bounds and normalized matching shared by both conversion passes. */
export function checkedCitations(answer: AiExtraction, sources: readonly AiSource[]) {
  const citations = answer.citations?.length
    ? answer.citations
    : answer.sourceId && answer.evidence
      ? [{ sourceId: answer.sourceId, quote: answer.evidence }]
      : [];
  if (!citations.length || citations.length > 20) return null;
  const checked = citations.flatMap((citation) => {
    const source = sources.find((s) => s.id === citation.sourceId);
    return source &&
      citation.quote.trim() &&
      citation.quote.length <= 4000 &&
      normalizeQuote(source.text).includes(normalizeQuote(citation.quote))
      ? [{ ...citation, revision: source.revision }]
      : [];
  });
  return checked.length === citations.length ? checked : null;
}

export function isCarriedConversionValue(
  slug: string,
  value: unknown,
  row: Awaited<ReturnType<typeof conversionSources>>["row"],
) {
  const values: Record<string, unknown> = {
    title: row.summary,
    description: row.description,
    priority: row.urgency,
    counterparty: row.customFields[INTAKE_CARRY_SLUGS.counterpartyName],
    needed_by: row.customFields[INTAKE_CARRY_SLUGS.neededBy],
  };
  return sameConversionValue(
    value,
    slug.startsWith("field:") ? row.customFields[slug.slice(6)] : values[slug],
  );
}

export function checkedSuggestion(
  answer: AiExtraction,
  context: Awaited<ReturnType<typeof conversionContext>>,
): ConversionSuggestion | null {
  const checked = checkedCitations(answer, context.sources);
  if (!checked) return null;
  const raw = answer.value;
  let value: ConversionSuggestion["value"] | null = null;
  if (answer.conflict) value = "Review conflicting sources";
  else if (answer.slug === "title" || answer.slug === "description")
    value =
      typeof raw === "string" && raw.trim() && raw.length <= (answer.slug === "title" ? 200 : 10000)
        ? raw.trim()
        : null;
  else if (answer.slug === `${context.targetModule}_type`)
    value =
      typeof raw === "string" &&
      context.types.some((t) => t.id === raw) &&
      (!context.targetTypeId || raw === context.targetTypeId)
        ? raw
        : null;
  else if (answer.slug === "counterparty" && context.targetModule === "contract")
    value =
      typeof raw === "string" && raw.trim() && raw.length <= MAX_COUNTERPARTY_NAME_LENGTH
        ? raw.trim()
        : null;
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
  return value === null ||
    (!answer.conflict && isCarriedConversionValue(answer.slug, value, context.row))
    ? null
    : { value, citations: checked, justification: answer.justification };
}

/** Metadata determines freshness; cached text enters only execution and authorized evidence reads. */
export function withAttachmentReads<T extends Awaited<ReturnType<typeof conversionContext>>>(
  context: T,
  reads: ConversionAttachmentRead[],
): T {
  for (const read of reads) {
    const source = context.attachments.find(
      (a) => a.id === read.sourceId && a.revision === read.revision && !a.restricted,
    );
    if (source && (read.status === "readable" || read.status === "truncated") && read.text) {
      context.sources.push({
        id: source.id,
        revision: source.revision,
        kind: "document",
        label: source.label,
        text: read.text,
        author: undefined,
        createdAt: undefined,
      });
    }
    if (read.status !== "readable") context.warnings.push("attachment_omissions");
  }
  context.warnings = [...new Set(context.warnings)];
  return context;
}
