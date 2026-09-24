// SPDX-License-Identifier: AGPL-3.0-only
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
