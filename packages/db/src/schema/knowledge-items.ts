// SPDX-License-Identifier: AGPL-3.0-only

/** KNW-001–004's curated know-how record. */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { documents } from "./documents.js";
import { searchVector, uuidPk } from "./helpers.js";
import { knowledgeFolders } from "./knowledge-folders.js";
import { knowledgeTypes } from "./knowledge-types.js";

export const KNOWLEDGE_ITEM_STATES = ["draft", "published"] as const;
export type KnowledgeItemState = (typeof KNOWLEDGE_ITEM_STATES)[number];

export const KNOWLEDGE_ITEM_AUDIENCES = ["legal_only", "everyone"] as const;
export type KnowledgeItemAudience = (typeof KNOWLEDGE_ITEM_AUDIENCES)[number];

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuidPk(),
    title: text("title").notNull(),
    knowledgeTypeId: text("knowledge_type_id")
      .notNull()
      .references(() => knowledgeTypes.id),
    /** Markdown guidance, or NULL for a file-only item (KNW-001). */
    body: text("body"),
    folderId: text("folder_id").references(() => knowledgeFolders.id),
    state: text("state", { enum: KNOWLEDGE_ITEM_STATES }).notNull().default("draft"),
    audience: text("audience", { enum: KNOWLEDGE_ITEM_AUDIENCES }).notNull().default("legal_only"),
    /** The file-first record's designated paper (DES-068). */
    primaryDocumentId: text("primary_document_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),
    /** Optional successor when this item is superseded (KNW-002). */
    replacedById: text("replaced_by_id").references((): AnyPgColumn => knowledgeItems.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    searchVector: searchVector("search_vector").generatedAlwaysAs(sql`
      setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("body", '')), 'B')
    `),
  },
  (table) => [
    index("knowledge_items_type_idx").on(table.knowledgeTypeId),
    index("knowledge_items_folder_idx").on(table.folderId, table.createdAt, table.id),
    index("knowledge_items_primary_document_idx").on(table.primaryDocumentId),
    index("knowledge_items_replaced_by_idx").on(table.replacedById),
    index("knowledge_items_created_by_idx").on(table.createdBy),
    index("knowledge_items_search_vector_idx").using("gin", table.searchVector),
    check("knowledge_items_state_check", sql`${table.state} in ('draft', 'published')`),
    check("knowledge_items_audience_check", sql`${table.audience} in ('legal_only', 'everyone')`),
  ],
);

export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
