// SPDX-License-Identifier: AGPL-3.0-only
/** INT-008: a narrowed source must not leave unreviewed facts in broader record fields. */
import {
  conversionDrafts,
  contractAnalysisRuns,
  contracts,
  matters,
  requestAttachments,
  commentAttachments,
  documentVersions,
  sql,
  type Executor,
} from "@openlaw/db";
import { httpError } from "./problem.js";
/** The retained marker-to-source dependency graph used by audience narrowing checks. */
export const unverifiedConversionCitations = sql`
  select marker.key as slug, coalesce(draft.request_id, run.source_context->>'requestId') as request_id, citation.value as citation
  from (select ai_unverified from ${matters} where ${matters.aiUnverified} is not null union all select ai_unverified from ${contracts} where ${contracts.aiUnverified} is not null) m
      cross join lateral jsonb_each(coalesce(m.ai_unverified, '{}'::jsonb)) marker
      left join ${conversionDrafts} draft on draft.id = marker.value->>'draftId'
      left join ${contractAnalysisRuns} run on run.id = marker.value->>'runId'
      cross join lateral jsonb_array_elements(coalesce(draft.suggestions->marker.key->'citations', run.source_context->'suggestions'->marker.key->'citations', '[]'::jsonb)) citation(value)
`;

export async function assertConversionDocumentCanNarrow(db: Executor, documentId: string) {
  const dependencies = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from (${unverifiedConversionCitations}) dependency
      where dependency.citation->>'sourceId' in (
        select 'attachment:' || ${requestAttachments.id} from ${requestAttachments}
        join ${documentVersions} on ${documentVersions.id} = ${requestAttachments.promotedVersionId}
        where ${documentVersions.documentId} = ${documentId}
        union all
        select 'message-attachment:' || ${commentAttachments.id} from ${commentAttachments}
        where ${commentAttachments.filedDocumentId} = ${documentId}
      )
    ) as present
  `);
  if (dependencies.rows[0]?.present)
    throw httpError(
      409,
      "Review and confirm or edit the unverified record values derived from this Document before marking it Confidential. No audience was changed.",
    );
}
