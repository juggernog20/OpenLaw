// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment join (CTR-016, mirroring MTR-011's
 * `matter_type_fields`): which catalog fields appear on which contract
 * types, in what order, and whether each is required there. A field can
 * be required for NDAs and optional elsewhere — the flag lives on the
 * attachment, never on the field. Only `contract` and `global` scoped
 * fields attach here (application-enforced). Detaching deletes the join
 * row only; the catalog definition and stored values are untouched
 * (MTR-014). Hard enforcement of `is_required` arrives with the contract
 * record milestone (M8).
 */

import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { contractTypes } from "./contract-types.js";
import { fields } from "./fields.js";

export const contractTypeFields = pgTable(
  "contract_type_fields",
  {
    /** The type carries the attachment: deleting the type (the CTR-002
     * hard delete) takes its attachments with it. */
    contractTypeId: text("contract_type_id")
      .notNull()
      .references(() => contractTypes.id, { onDelete: "cascade" }),
    /** No cascade: fields have no hard delete (MTR-014), so a dangling
     * attachment can only mean a bug — let the constraint say so. */
    fieldId: text("field_id")
      .notNull()
      .references(() => fields.id),
    /** Per-type form order, 1-based; reorder rewrites the rows whose
     * fields are live. */
    displayOrder: integer("display_order").notNull(),
    /** MTR-014: hard-enforced at record creation/re-type once contracts
     * exist (M8); until then stored and editable only. */
    isRequired: boolean("is_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.contractTypeId, table.fieldId] })],
);

export type ContractTypeField = typeof contractTypeFields.$inferSelect;
