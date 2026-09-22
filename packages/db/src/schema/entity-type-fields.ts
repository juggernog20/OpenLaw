// SPDX-License-Identifier: AGPL-3.0-only

/** Catalog Fields attached to one Entity type (ENT-001, TECH-023). */
import { boolean, foreignKey, index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { entityTypeBranches } from "./type-forms.js";
import { entityTypes } from "./entity-types.js";
import { typeFieldColumns } from "./fields.js";

export const entityTypeFields = pgTable(
  "entity_type_fields",
  {
    typeId: text("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    ...typeFieldColumns(),
    visibleOnPortal: boolean("visible_on_portal").notNull().default(true),
    /** NULL places this attachment at the Form root, outside every Branch. */
    branchId: text("branch_id"),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.fieldId] }),
    foreignKey({
      columns: [table.typeId, table.branchId],
      foreignColumns: [entityTypeBranches.typeId, entityTypeBranches.id],
    }).onDelete("cascade"),
    index("entity_type_fields_field_id_idx").on(table.fieldId),
  ],
);

export type EntityTypeField = typeof entityTypeFields.$inferSelect;
