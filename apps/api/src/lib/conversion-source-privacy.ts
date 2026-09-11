// SPDX-License-Identifier: AGPL-3.0-only
/** INT-008: a narrowed source must not leave unreviewed facts in broader record fields. */
import {
  conversionDrafts,
  contracts,
  matters,
  requestAttachments,
  commentAttachments,
  documentVersions,
  sql,
  type Executor,
} from "@openlaw/db";
import { httpError } from "./problem.js";
export async function assertConversionDocumentCanNarrow(db: Executor, documentId: string) {
  const dependencies = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from (select ai_unverified from ${matters} union all select ai_unverified from ${contracts}) m
      cross join lateral jsonb_each(coalesce(m.ai_unverified, '{}'::jsonb)) marker
      join ${conversionDrafts} draft on draft.id = marker.value->>'draftId'
      cross join lateral jsonb_array_elements(coalesce(draft.suggestions->marker.key->'citations', '[]'::jsonb)) citation
      where citation->>'sourceId' in (
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
