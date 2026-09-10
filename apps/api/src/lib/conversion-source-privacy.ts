// SPDX-License-Identifier: AGPL-3.0-only
/** A narrowed source must not leave unreviewed facts in broader Matter fields. */
import {
  conversionDrafts,
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
      select 1 from ${matters} m
      cross join lateral jsonb_each(coalesce(m.ai_unverified, '{}'::jsonb)) marker
      join ${conversionDrafts} draft on draft.id = marker.value->>'draftId'
      cross join lateral jsonb_array_elements(coalesce(draft.suggestions->marker.key->'citations', '[]'::jsonb)) citation
      where citation->>'sourceId' in (
        select 'attachment:' || a.id from ${requestAttachments} a
        join ${documentVersions} v on v.id = a.promoted_version_id where v.document_id = ${documentId}
        union all
        select 'message-attachment:' || a.id from ${commentAttachments} a where a.filed_document_id = ${documentId}
      )
    ) as present
  `);
  if (dependencies.rows[0]?.present)
    throw httpError(
      409,
      "Review and confirm or edit the unverified Matter values derived from this Document before marking it Confidential. No audience was changed.",
    );
}
