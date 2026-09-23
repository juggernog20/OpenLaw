// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DOC-015's Document types: one Administrator-managed list per owning
 * module (Matters, Contracts, Entities), held in one table and told
 * apart by `module`. A Document Version names at most one row from its
 * owner's list. No type is a valid answer.
 *
 * Knowledge has no list here. A Knowledge Item is already typed, and
 * its files show the item's Knowledge type instead (DOC-015 addendum).
 *
 * **Fixed rows carry a system kind.** The Contract list starts with the
 * six CTR-014 negotiation types. Each one maps to the Version kind that
 * code reads (the executed-copy append, the Auto-Doc original, the
 * renewal seed, the pill colours), so those rows cannot be renamed,
 * archived, or deleted. A row an Administrator adds has no system kind,
 * and a Version of that type stores the neutral `general` kind.
 *
 * `generated_redline` is never a row. It records how a file was made,
 * not what somebody called it, so a generated redline has no type.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

/** The owning modules that carry a Document type list. A Knowledge
 * Item's files take the item's type, and an Auto-Doc's template has
 * none. */
export const DOCUMENT_TYPE_MODULES = ["matter", "contract", "entity"] as const;
export type DocumentTypeModule = (typeof DOCUMENT_TYPE_MODULES)[number];

/** The Version kinds a fixed row may stand for: the hand-set ones that
 * name a negotiation round. `general` is what no type means. */
export const DOCUMENT_TYPE_SYSTEM_KINDS = [
  "draft_ours",
  "draft_theirs",
  "redline_theirs",
  "redline_ours",
  "executed",
  "amendment",
] as const;
export type DocumentTypeSystemKind = (typeof DOCUMENT_TYPE_SYSTEM_KINDS)[number];

export const documentTypes = pgTable(
  "document_types",
  {
    ...taxonomyColumns(),
    /** Which owner's list the row belongs to. Never changes. */
    module: text("module", { enum: DOCUMENT_TYPE_MODULES }).notNull(),
    /** The Version kind a fixed row stands for; NULL on every row an
     * Administrator adds. */
    systemKind: text("system_kind", { enum: DOCUMENT_TYPE_SYSTEM_KINDS }),
  },
  (table) => [
    uniqueIndex("document_types_module_slug_unique").on(table.module, table.slug),
    // One fixed row per kind per list, so a kind maps back to one type.
    uniqueIndex("document_types_module_system_kind_unique")
      .on(table.module, table.systemKind)
      .where(sql`${table.systemKind} IS NOT NULL`),
    check("document_types_module_check", sql`${table.module} in ('matter', 'contract', 'entity')`),
    check(
      "document_types_system_kind_check",
      sql`${table.systemKind} is null or ${table.systemKind} in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment')`,
    ),
  ],
);

export type DocumentType = typeof documentTypes.$inferSelect;
