// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Their side of the contract (CTR-011, M8/4): the join that puts N
 * counterparties on one contract, with exactly one flagged primary.
 *
 * DD-008 is why this points at `counterparties` and not at a shared
 * party table: our entities and their organizations are separate tables,
 * so "a party" is never one foreign key. TECH-014 is why the table lands
 * here and not earlier. It arrives with the feature that reads it.
 *
 * A contract has more than one other side more often than the mocks
 * admit. Assignments, novations, and tripartite agreements are ordinary
 * legal work, so this is a join and not a `counterparty_id` column.
 * The primary is the one the list column and the record name first,
 * because a list needs one name per row.
 *
 * The one-primary rule is the application's to keep (CTR-011): the
 * routes decide which row is promoted when the primary leaves, and they
 * do it under the contract row's lock. The partial unique index below is
 * a backstop, not the rule. It can refuse a second primary, but it
 * cannot choose the replacement.
 */

import { sql } from "drizzle-orm";
import { boolean, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";
import { counterparties } from "./counterparties.js";

export const contractCounterparties = pgTable(
  "contract_counterparties",
  {
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    // No cascade: a counterparty is archived, never deleted, so the
    // contract can never lose the name of who it was signed with.
    counterpartyId: text("counterparty_id")
      .notNull()
      .references(() => counterparties.id),
    /** Exactly one true per contract, kept by the routes (CTR-011). */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** When this party joined the contract. A row is written, promoted,
     * or deleted. The promotion is audited, so there is no
     * `updated_at` here to read it from. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "contract_counterparties_pkey",
      columns: [table.contractId, table.counterpartyId],
    }),
    // The backstop: a second primary on one contract cannot be written,
    // whatever a future caller believes. Demote-then-promote is the
    // order every write path here already uses.
    uniqueIndex("contract_counterparties_one_primary")
      .on(table.contractId)
      .where(sql`${table.isPrimary}`),
    // `counterparty_id` carries no index of its own yet: nothing in M8
    // reads the join from that side. The feature that will, "which
    // contracts is this counterparty on", brings its own index, per
    // the incremental-schema rule (TECH-014).
  ],
);

export type ContractCounterparty = typeof contractCounterparties.$inferSelect;
