// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment join for contracts (CTR-016, mirroring
 * MTR-011's `matter_type_fields` — the shared columns live in
 * `typeFieldColumns`): which catalog fields appear on which contract
 * types, in what order, and whether each is required there. Only
 * `contract` and `global` scoped fields attach here
 * (application-enforced). Detaching deletes the join row only; the
 * catalog definition and stored values are untouched (MTR-014) — the
 * values are keyed by slug in `contracts.custom_fields`, so
 * re-attaching brings them back. `is_required` is hard-enforced from
 * M8: a contract cannot be created on this type, or re-typed onto it,
 * while a field it marks required has no value.
 */

import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { contractTypes } from "./contract-types.js";
import { typeFieldColumns } from "./fields.js";

export const contractTypeFields = pgTable(
  "contract_type_fields",
  {
    /** The type carries the attachment: deleting the type (the CTR-002
     * hard delete) takes its attachments with it. */
    typeId: text("contract_type_id")
      .notNull()
      .references(() => contractTypes.id, { onDelete: "cascade" }),
    ...typeFieldColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.fieldId] }),
    // The PK leads with the type id; the catalog's per-field counts and
    // the fields FK checks look up by field id alone.
    index("contract_type_fields_field_id_idx").on(table.fieldId),
  ],
);

export type ContractTypeField = typeof contractTypeFields.$inferSelect;
