// SPDX-License-Identifier: AGPL-3.0-only

/** Column helpers shared by every schema file (SCHEMA.md conventions). */

import { boolean, integer, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/** UUID v7 primary key (TECH-004). */
export const uuidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * The shared taxonomy base columns (identity, ordering, system-default
 * marker, archive, and audit timestamps): contract types, matter types,
 * and contract statuses all include these. Each table adds its own
 * domain-specific columns on top.
 */
export const taxonomyBaseColumns = () => ({
  id: uuidPk(),
  /** Machine identity, derived from the name at creation; never changes. */
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  /** Picker and list position, 1-based; reorder rewrites the live rows. */
  displayOrder: integer("display_order").notNull(),
  /** True for the seed rows; user-created rows are false. */
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
});

/**
 * The full taxonomy column set (MTR-001, mirrored by CTR-002): every
 * configurable-taxonomy table that carries a description — matter types,
 * contract types — is this shape, which is what lets one machinery serve
 * them all. The `other` row of each table is system-protected in
 * application code.
 */
export const taxonomyColumns = () => ({
  ...taxonomyBaseColumns(),
  /** Shown in the type editor; NULL = the type has no description. */
  description: text("description"),
});
