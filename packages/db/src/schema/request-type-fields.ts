// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment join for request types (INT-002). It
 * mirrors CTR-016's `contract_type_fields` and MTR-011's
 * `matter_type_fields`; the shared columns live in `typeFieldColumns`.
 * It records which catalog fields a request type's portal form
 * collects, in what order, and whether each is required on that form.
 *
 * What may attach follows the type's target, not this table: a
 * contract-targeting type takes contract-scoped and global fields, a
 * matter-targeting type takes matter-scoped and global fields, and a
 * type with no target takes global fields only. The rule is
 * application-enforced, as CTR-016's is, because it reads a column on
 * the owning row rather than a constant.
 *
 * The four basics every form collects (Summary, Description,
 * Attachments, and Urgency) are not rows here. They are fixed by
 * INT-002, so nothing configures them and nothing needs a join row to
 * record that they are on.
 *
 * Detaching deletes the join row only; the catalog definition survives
 * (MTR-014), so a field detached from one form is untouched on every
 * other form and on every contract type that also attaches it.
 * `is_required` is stored and editable here; the portal enforces it
 * when a requester submits (M20).
 */

import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { typeFieldColumns } from "./fields.js";
import { requestTypes } from "./request-types.js";

export const requestTypeFields = pgTable(
  "request_type_fields",
  {
    /** The type carries the attachment: hard-deleting the request type
     * takes its form definition with it. */
    typeId: text("request_type_id")
      .notNull()
      .references(() => requestTypes.id, { onDelete: "cascade" }),
    ...typeFieldColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.fieldId] }),
    // The PK leads with the type id; the catalog's per-field counts and
    // the fields FK checks look up by field id alone.
    index("request_type_fields_field_id_idx").on(table.fieldId),
  ],
);

export type RequestTypeField = typeof requestTypeFields.$inferSelect;
