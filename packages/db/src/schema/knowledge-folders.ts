// SPDX-License-Identifier: AGPL-3.0-only

/**
 * KNW-003's blank-start nested hierarchy. These folders organize
 * Knowledge Items; they are deliberately separate from
 * `document_folders`, which organize Documents inside an owning record.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const knowledgeFolders = pgTable(
  "knowledge_folders",
  {
    id: uuidPk(),
    parentId: text("parent_id").references((): AnyPgColumn => knowledgeFolders.id),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("knowledge_folders_parent_idx").on(table.parentId, table.displayOrder, table.id),
    uniqueIndex("knowledge_folders_root_name_idx")
      .on(table.name)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("knowledge_folders_sibling_name_idx")
      .on(table.parentId, table.name)
      .where(sql`${table.parentId} is not null`),
  ],
);

export type KnowledgeFolder = typeof knowledgeFolders.$inferSelect;
