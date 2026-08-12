// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Counterparties (DD-008, CTR-011, M8/4): the external organizations on
 * the other side of our contracts. They are deliberately not entities.
 * An entity is one of ours and carries a rich identity card; a
 * counterparty is theirs and carries a name. DD-008 split the two
 * because about seventy percent of the columns differ, the lifecycles
 * differ — we incorporate an entity, we meet a counterparty — and the
 * counts differ by two orders of magnitude.
 *
 * The schema is the light DD-008 shape CTR-011 resolved: `name` is the
 * only required column, and everything else is enrichment that arrives
 * later, or never. That is what lets a Legal Team Member type an
 * unknown name into the contract record and have the record exist
 * before they finish the sentence. M8 gives the enrichment columns no
 * screen; they hold what an import or a later milestone puts in them.
 *
 * `archived_at` is the SET-003 soft delete: a counterparty leaves the
 * typeahead, and every contract it signed keeps naming it.
 */

import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const counterparties = pgTable(
  "counterparties",
  {
    id: uuidPk(),
    /** The only required column (CTR-011): inline creation writes this
     * and nothing else. */
    name: text("name").notNull(),
    /** Enrichment, all nullable — no screen writes these in M8. */
    jurisdiction: text("jurisdiction"),
    primaryContactName: text("primary_contact_name"),
    primaryContactEmail: text("primary_contact_email"),
    address: text("address"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** SET-003 soft delete: out of the typeahead, still on every
     * contract it signed. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    // The typeahead's read: ordered by name, case-insensitively, so
    // "iCloud Ltd" files under I wherever the default collation would
    // put it. The same index answers the exact-name lookup that stops
    // inline creation making a second row for a name we already hold.
    //
    // Deliberately not unique. Making it unique would rule, once and
    // permanently, that two organizations may never share a name — and
    // they do, in different jurisdictions, which is what the
    // `jurisdiction` column is for. The no-duplicates guarantee the
    // typeahead needs is narrower than that: it is about not creating a
    // second row for a name someone just searched, and the add route
    // holds it with a name-keyed lock inside its own transaction.
    //
    // It is also a plain b-tree, which the "contains" search cannot use.
    // That is on purpose: the search is capped at twenty rows and no
    // installation has enough counterparties for a scan to be felt yet.
    // A trigram index arrives with the volume that needs it (TECH-014).
    index("counterparties_name_idx").on(sql`lower(${table.name})`, table.createdAt),
  ],
);

export type Counterparty = typeof counterparties.$inferSelect;
