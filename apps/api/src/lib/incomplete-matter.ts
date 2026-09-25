// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The SQL test behind the Matter "Incomplete" search property (DOC-009,
 * M44; MTR-014): a Matter whose type requires a Field the record has no
 * answer for. Missing means the key is absent, or holds null, an empty
 * list or an empty string. Archived Fields are ignored, so retiring a
 * required Field does not mark every Matter incomplete.
 */

import { sql, matters, fields, matterTypeFields } from "@openlaw/db";

export const incompleteMatter = sql`exists (
  select 1 from ${matterTypeFields}
  inner join ${fields} on ${fields.id} = ${matterTypeFields.fieldId}
  where ${matterTypeFields.typeId} = ${matters.matterTypeId}
    and ${matterTypeFields.isRequired} = true and ${fields.archivedAt} is null
    and (not jsonb_exists(${matters.customFields}, ${fields.slug})
      or ${matters.customFields} -> ${fields.slug} = 'null'::jsonb
      or ${matters.customFields} -> ${fields.slug} = '[]'::jsonb
      or ${matters.customFields} ->> ${fields.slug} = '')
)`;
