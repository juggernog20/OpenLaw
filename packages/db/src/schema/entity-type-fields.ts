// SPDX-License-Identifier: AGPL-3.0-only

/** Catalog Fields attached to one Entity type (ENT-001, TECH-023). */
import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { entityTypes } from "./entity-types.js";
import { typeFieldColumns } from "./fields.js";

export const entityTypeFields = pgTable(
  "entity_type_fields",
  {
    typeId: text("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    ...typeFieldColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.typeId, table.fieldId] }),
    index("entity_type_fields_field_id_idx").on(table.fieldId),
  ],
);

export type EntityTypeField = typeof entityTypeFields.$inferSelect;
