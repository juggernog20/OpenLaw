// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One typed, directional link between two contracts (CTR-015, M16/5).
 *
 * `contracts.parent_id` carries the shape teams draw most — an MSA with
 * its SOWs under it — and it is cheap to walk because it is one column.
 * This table carries every other statement one contract makes about
 * another, and it carries the **type** of the statement, because CTR-007
 * needs a renewal to be identified by its link rather than by the shape
 * of the record: a successor is a renewal because it says `renews`, not
 * because somebody named it "renewal".
 *
 * **Directional, and the direction is the sentence.** The row reads
 * from-verb-to: the successor `renews` its predecessor, the amending
 * contract `amends` the one it amends. `related` is the symmetric one —
 * it says the two belong together and nothing more — and one row still
 * says it, read from either end.
 *
 * **One row per pair per type**, which the compound primary key makes a
 * database rule rather than an application convention. The application
 * refuses a duplicate first, by name, so a caller reads an answer rather
 * than a constraint violation; the key is what holds whichever code got
 * there.
 *
 * **A contract never relates to itself.** A self-link says nothing and
 * would make every walk over this table have to defend itself against a
 * one-row cycle, so it is refused here as well as at the seam.
 *
 * **Nothing flows along a link** (CTR-015, CTR-018). Status, team, and
 * confidentiality never cross it, so this table has no audience of its
 * own: each end is reached under its own contract's predicate, and a
 * relative the viewer cannot reach is M17's to draw.
 *
 * M16 writes these rows and narrates the writes. Every read surface —
 * the relations panel, the hierarchy breadcrumb, manual linking, the
 * "restricted contract" rendering — is M17's.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";

/**
 * CTR-015's link vocabulary, and the whole of it.
 *
 * Code branches on it — renewal reporting reads `renews` and nothing
 * else, and the two directional types draw a different sentence from the
 * symmetric one — so it is a fixed enum rather than an admin-configurable
 * list. Adding a fourth kind of relationship is a decision, not a
 * settings row.
 */
export const CONTRACT_RELATION_TYPES = ["related", "renews", "amends"] as const;
export type ContractRelationType = (typeof CONTRACT_RELATION_TYPES)[number];

export const contractRelations = pgTable(
  "contract_relations",
  {
    /** The contract making the statement — the subject of the sentence.
     * Cascade: the link is not a fact about anything but these two
     * records, so it goes when either of them does. */
    fromContractId: text("from_contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    /** The contract the statement is about. */
    toContractId: text("to_contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    relationType: text("relation_type", { enum: CONTRACT_RELATION_TYPES }).notNull(),
    /** When the link was made. A row is written or deleted, never
     * edited, so there is no `updated_at` beside it — the
     * `contract_team` rule for the same reason. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // CTR-015's duplicate-direction guard, stated as the shape. Two
    // contracts may hold two links of different types at once — a
    // successor that also amends — so the type is part of the key
    // rather than a column beside it.
    primaryKey({
      name: "contract_relations_pkey",
      columns: [table.fromContractId, table.toContractId, table.relationType],
    }),
    // "What points at this contract" — the far half of every relations
    // read. The near half rides the primary key's leading column.
    index("contract_relations_to_idx").on(table.toContractId, table.relationType),
    check(
      "contract_relations_type_check",
      sql`${table.relationType} in ('related', 'renews', 'amends')`,
    ),
    check("contract_relations_self_check", sql`${table.fromContractId} <> ${table.toContractId}`),
  ],
);

export type ContractRelation = typeof contractRelations.$inferSelect;
