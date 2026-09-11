// SPDX-License-Identifier: AGPL-3.0-only
/** INT-008: Revalidates original sources and their promoted immutable Versions before disclosing evidence. */
import { z } from "zod";
import {
  and,
  contracts,
  documents,
  documentVersions,
  entities,
  eq,
  isNull,
  knowledgeItems,
  matters,
  type Executor,
} from "@openlaw/db";
import type { ConversionAttachmentRead, ConversionSuggestion } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { conversionSources, normalizeQuote } from "../../lib/conversion-draft.js";
import { documentRepositoryScope } from "../../lib/document-access.js";

export const EvidenceSchema = z.object({
  available: z.boolean(),
  citations: z.array(
    z.object({
      label: z.string(),
      text: z.string(),
      quote: z.string(),
      sourceId: z.string(),
      attachment: z
        .object({
          previewHref: z.string().nullable(),
          downloadHref: z.string(),
          documentId: z.string().nullable(),
          versionId: z.string().nullable(),
          method: z.string().nullable(),
        })
        .optional(),
    }),
  ),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export async function authorizedAttachment(
  db: Executor,
  user: AuthenticatedUser,
  source: Awaited<ReturnType<typeof conversionSources>>,
  read: ConversionAttachmentRead,
) {
  const file = source.attachments.find(
    (a) => a.id === read.sourceId && a.revision === read.revision && !a.restricted,
  );
  if (!file || !["readable", "truncated"].includes(read.status)) return null;
  if (file.versionId) {
    const [version] = await db
      .select({
        documentId: documents.id,
        versionId: documentVersions.id,
        fileRef: documentVersions.fileRef,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .leftJoin(contracts, eq(documents.contractId, contracts.id))
      .leftJoin(matters, eq(documents.matterId, matters.id))
      .leftJoin(entities, eq(documents.entityId, entities.id))
      .leftJoin(knowledgeItems, eq(documents.knowledgeItemId, knowledgeItems.id))
      .where(
        and(
          eq(documentVersions.id, file.versionId),
          isNull(documents.archivedAt),
          documentRepositoryScope(db, user),
        ),
      )
      .limit(1);
    if (!version) return null;
    return { file, version };
  }
  // A deleted promoted Version cannot fall back to the Request's retained download.
  if (file.id.startsWith("attachment:") && source.row.status !== "new") return null;
  return { file, version: null };
}
export async function conversionEvidence(
  db: Executor,
  user: AuthenticatedUser,
  source: Awaited<ReturnType<typeof conversionSources>>,
  draft: { id: string; attachmentReads: ConversionAttachmentRead[] },
  proposal: ConversionSuggestion | undefined,
): Promise<Evidence> {
  const citations: Evidence["citations"] = [];
  for (const citation of proposal?.citations ?? []) {
    const live = source.sources.find(
      (s) => s.id === citation.sourceId && s.revision === citation.revision,
    );
    if (live && normalizeQuote(live.text).includes(normalizeQuote(citation.quote))) {
      citations.push({
        label: live.label,
        text: live.text,
        quote: citation.quote,
        sourceId: live.id,
      });
      continue;
    }
    const read = draft.attachmentReads.find(
      (a) => a.sourceId === citation.sourceId && a.revision === citation.revision,
    );
    if (!read || !normalizeQuote(read.text).includes(normalizeQuote(citation.quote))) continue;
    const authorized = await authorizedAttachment(db, user, source, read);
    if (!authorized) continue;
    const root = `/api/v1/requests/${source.row.number}/conversion-drafts/${draft.id}/sources/${encodeURIComponent(read.sourceId)}`;
    const versionRoot = authorized.version
      ? `/api/v1/documents/${authorized.version.documentId}/versions/${authorized.version.versionId}`
      : null;
    citations.push({
      sourceId: read.sourceId,
      label: read.label,
      text: read.text,
      quote: citation.quote,
      attachment: {
        previewHref: read.previewRef ? `${versionRoot ?? root}/preview` : null,
        downloadHref: `${versionRoot ?? root}/download`,
        documentId: authorized.version?.documentId ?? null,
        versionId: authorized.version?.versionId ?? null,
        method: read.method ?? null,
      },
    });
  }
  return citations.length > 0 && citations.length === proposal?.citations.length
    ? { available: true, citations }
    : { available: false, citations: [] };
}
