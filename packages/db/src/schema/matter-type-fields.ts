// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment join for matters (MTR-011, mirrored by
 * CTR-016's `contract_type_fields` — the shared columns live in
 * `typeFieldColumns`): which catalog fields appear on which matter
 * types, in what order, and whether each is required there. Until the
 * matter record milestone (M22) opens the `matter` field scope, only
 * `global` fields attach here (application-enforced); `matter` joins
 * the rule when that scope opens. Detaching deletes the join row only;
 * the catalog definition and stored values are untouched (MTR-014).
 * Hard enforcement of `is_required` arrives with M22.
 */

import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
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
  (table) => [primaryKey({ columns: [table.typeId, table.fieldId] })],
);

export type MatterTypeField = typeof matterTypeFields.$inferSelect;
