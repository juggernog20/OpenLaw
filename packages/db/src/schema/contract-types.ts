// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-type taxonomy (CTR-002): a configurable, ordered list of
 * types, Admin-managed via Contracts Settings → Types. Slugs are derived
 * at creation and immutable; display names are presentation. Eight rows
 * are seeded by the migration that creates the table; the `other` row is
 * system-protected in application code — no archive, no hard delete — so
 * a non-null fallback type always exists. The `description` column and
 * the per-type field attachments arrive with the type-editor feature
 * (TECH-014: columns land with the feature that reads them).
 */

import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const contractTypes = pgTable(
  "contract_types",
  {
    id: uuidPk(),
    /** Machine identity, derived from the name at creation; never changes. */
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    /** Picker and list position, 1-based; reorder rewrites the live rows. */
    displayOrder: integer("display_order").notNull(),
    /** True for the eight CTR-002 seed rows; user-created rows are false. */
    isSystemDefault: boolean("is_system_default").notNull().default(false),
    /** SET-003 soft delete: NULL = live; a timestamp = archived, out of
     * pickers and the default list, nothing lost. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("contract_types_slug_unique").on(table.slug)],
);

export type ContractType = typeof contractTypes.$inferSelect;
