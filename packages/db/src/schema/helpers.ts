// SPDX-License-Identifier: AGPL-3.0-only

/** Column helpers shared by every schema file (SCHEMA.md conventions). */

import type { BuildColumns } from "drizzle-orm";
import { boolean, integer, text, timestamp, type PgTableWithColumns } from "drizzle-orm/pg-core";
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

/**
 * Any table built on {@link taxonomyColumns} — the shape the one
 * taxonomy machinery serves (#85).
 *
 * Structural rather than a union of the type tables, because a mount
 * may carry columns of its own beside the shared ones: the machinery
 * reads and writes the shared set and knows nothing of the rest, which
 * is what lets a per-mount extras hook project and patch them. Declared
 * here because the shape is declared here, and exported so the API's
 * factory names one type rather than restating drizzle's.
 */
export type TaxonomyTable = PgTableWithColumns<{
  name: string;
  schema: undefined;
  columns: BuildColumns<string, ReturnType<typeof taxonomyColumns>, "pg">;
  dialect: "pg";
}>;

/** Fails to compile unless what it is given is `true`. */
type Assert<T extends true> = T;

/**
 * Compile-time witness for the property the taxonomy machinery's extras
 * hook rests on: a table that carries a column of its own beside the
 * shared set is still a {@link TaxonomyTable}. Every type table is that
 * exact set today, so nothing else here would say if the property were
 * lost — request types bring the first table that widens it (#350).
 */
// Referenced by nothing: it exists so `tsc` checks the property. Kept
// module-local so it stays out of the package's surface, which is why
// the unused rule is waived here rather than satisfied by an export.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _TaxonomyTableTakesExtraColumns = Assert<
  PgTableWithColumns<{
    name: string;
    schema: undefined;
    columns: BuildColumns<
      string,
      ReturnType<typeof taxonomyColumns> & { targetModule: ReturnType<typeof text> },
      "pg"
    >;
    dialect: "pg";
  }> extends TaxonomyTable
    ? true
    : false
>;
