// SPDX-License-Identifier: AGPL-3.0-only

/** KNW-001's Administrator-managed Knowledge type taxonomy. */
import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const knowledgeTypes = pgTable("knowledge_types", taxonomyColumns(), (table) => [
  uniqueIndex("knowledge_types_slug_unique").on(table.slug),
]);

export type KnowledgeType = typeof knowledgeTypes.$inferSelect;
