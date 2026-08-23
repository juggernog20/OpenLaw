// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One person's saved way of reading one list (DD-019).
 *
 * **A view is private, and this table has no column that could ever
 * share one.** No `is_shared`, no `organization_id`, no author-versus-
 * owner split. DD-019 clause 1 declined shared views because every
 * clause they add is a permission question, and a 2–10 person team
 * (DD-002) answers "send me your columns" with a sentence.
 *
 * **The surface is a string, so one table serves every destination.**
 * Contracts and Matters (M22) write their own surface slugs today;
 * Documents (M26) and Entities (M27) add theirs by rendering the same
 * managed table (DES-046), not by adding a table here. Nothing
 * joins to a view, which is what makes this the cheap kind of
 * polymorphism rather than the kind DD-008 avoids.
 *
 * **The state is one `jsonb` config, read and written whole.** No query
 * reaches into it — no report asks which views sort by expiry — and the
 * shape changes every time a surface gains a column, so typed columns
 * would freeze what is meant to move (DD-019 clause 4). The API owns the
 * shape and validates it; this column holds it.
 *
 * **A config may name a column the build no longer has.** DD-019 clause
 * 7 makes that a read-past rather than an error: the surface resolves the
 * config against the column catalogue it actually ships, drops what it
 * cannot draw, and renders the rest. So nothing here constrains the
 * config's contents, and no migration ever has to rewrite one.
 */

import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

/** The longest a view name may be. Long enough for "Renewals due this
 * quarter", short enough to read in a menu row without truncating. */
export const MAX_VIEW_NAME_LENGTH = 60;

export const listViews = pgTable(
  "list_views",
  {
    id: uuidPk(),
    /**
     * Whose view this is. Cascade: a view is a preference, not a
     * record — a deleted user's saved columns are nobody's, and keeping
     * them would leave rows no reader can ever reach.
     */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Which list this view is for — `contracts` today. Deliberately not
     * an enum: a new destination adopting DES-046's table should not
     * need a migration to be allowed to save a view.
     */
    surface: text("surface").notNull(),
    /** What the reader called it. Shown in the views menu. */
    name: text("name").notNull(),
    /**
     * The whole list state: which columns are shown, their order, their
     * widths, the filters in force, and the sort (DD-019 clause 2). The
     * API's schema is the authority on the shape.
     */
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    /**
     * The one view this person's list opens on. At most one per person
     * per surface, held by the partial index below. False on every row
     * means the list opens on the built-in layout, which is code rather
     * than a seeded row (DD-019 clause 7).
     */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * Two views of one list may not share a name for one person, and the
     * comparison is case-insensitive — the same reading the menu's sort
     * takes, and the same rule folder siblings follow (DES-033). Names
     * are per person, so two people may both have a "My contracts".
     */
    uniqueIndex("list_views_name_idx").on(table.userId, table.surface, sql`lower(${table.name})`),
    /**
     * At most one default per person per surface, as a database rule
     * rather than a thing the writer is trusted to remember. Partial,
     * because the non-default rows are the many.
     */
    uniqueIndex("list_views_default_idx")
      .on(table.userId, table.surface)
      .where(sql`is_default`),
    /**
     * The name's shape, for the same reason a folder's has one: a view
     * named by whitespace reads as a blank row in the menu, and an
     * untrimmed one sorts where nobody typed it.
     */
    check(
      "list_views_name_check",
      sql`${table.name} <> '' and btrim(${table.name}) = ${table.name}
        and length(${table.name}) <= ${sql.raw(String(MAX_VIEW_NAME_LENGTH))}`,
    ),
    /** A surface key is a slug the build writes, never user text. */
    check("list_views_surface_check", sql`${table.surface} ~ '^[a-z][a-z0-9_]*$'`),
  ],
);
