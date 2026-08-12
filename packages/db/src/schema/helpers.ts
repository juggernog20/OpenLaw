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
 * The one taxonomy column set (MTR-001, mirrored by CTR-002): every
 * configurable-taxonomy table — matter types, contract types — is this
 * exact shape, which is what lets one machinery serve them all. Slugs
 * are derived at creation and immutable; display names are
 * presentation; the `other` row of each table is system-protected in
 * application code.
 */
export const taxonomyColumns = () => ({
  id: uuidPk(),
  /** Machine identity, derived from the name at creation; never changes. */
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  /** Shown in the type editor; NULL = the type has no description. */
  description: text("description"),
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
