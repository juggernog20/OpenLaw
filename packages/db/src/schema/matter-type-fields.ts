// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment join for matters (MTR-011, mirrored by
 * CTR-016's `contract_type_fields` — the shared columns live in
 * `typeFieldColumns`): which catalog fields appear on which matter
 * types, in what order, and whether each is required there. M22 opened
 * the `matter` field scope, so matter-scoped and global fields attach
 * here while other module scopes are refused. Detaching deletes the join
 * row only; the catalog definition and stored values are untouched
 * (MTR-014). Matter writes hard-enforce `is_required`.
 */

import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { matterTypes } from "./matter-types.js";
import { typeFieldColumns } from "./fields.js";

export const matterTypeFields = pgTable(
  "matter_type_fields",
  {
    /** The type carries the attachment: deleting the type (the MTR-001
     * hard delete) takes its attachments with it. */
    typeId: text("matter_type_id")
      .notNull()
      .references(() => matterTypes.id, { onDelete: "cascade" }),
    ...typeFieldColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.fieldId] }),
    // The PK leads with the type id; the catalog's per-field counts and
    // the fields FK checks look up by field id alone.
    index("matter_type_fields_field_id_idx").on(table.fieldId),
  ],
);

export type MatterTypeField = typeof matterTypeFields.$inferSelect;
