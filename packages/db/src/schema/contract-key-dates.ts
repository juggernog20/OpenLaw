// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One free-form named date on one contract (CTR-009, M16/3).
 *
 * CTR-006's five term columns carry the dates every contract has — when
 * it starts, when it ends, how long a roll is, how much notice it takes.
 * A price review, an option-exercise window, a warranty expiry, a
 * delivery milestone: those are dates a *particular* contract has, and
 * they have no column because no two contracts hold the same set. This
 * table is that escape hatch.
 *
 * **The shape is `matter_key_dates`, adopted before matters exist to use
 * it** (CTR-009, MTR-004). Date, label, optional note, and nothing else.
 * Matters take the same machinery in their own arc, and the two surfaces
 * then read alike because they were one shape from the start rather than
 * two that were reconciled later.
 *
 * **Deliberately flat.** No owner column, because the matters-side owner
 * question is a matters question and nothing on a contract asks it. No
 * per-date reminder schedule, because NOT-004 already fixed one global
 * offset list for every tracked date — key dates, notice deadlines, and
 * expiries alike — and a schedule per row would be that decision made
 * twice.
 *
 * **The date is a calendar date, not a moment.** A deadline is a day:
 * "the price review opens on 1 March" is true in every timezone, and a
 * timestamp would make it true in some and false in others. Every
 * subtraction the deadline surfaces do is therefore whole days.
 *
 * **Access is the owning contract's and nothing is held here** (DD-014,
 * CTR-021). There is no team, no flag, and no tier on this table: a
 * viewer who reaches the contract reaches its key dates, and a viewer
 * outside a confidential record's audience is answered as if the record
 * were never made. Confidentiality composes for free because this table
 * says nothing about it.
 */

import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";
import { uuidPk } from "./helpers.js";

export const contractKeyDates = pgTable(
  "contract_key_dates",
  {
    id: uuidPk(),
    /** The record the date is on. Cascade: a key date is part of the
     * contract, and a contract that is gone has no dates of its own. */
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    /** The day itself. `date` rather than `timestamptz` because a
     * deadline is day-granular (SCHEMA.md, MTR-004) — display is
     * DES-014's. */
    date: date("date").notNull(),
    /** What the day is: "Price review window opens", "Insurance
     * certificate renewal". Not null, because a date nobody named is a
     * date nobody can act on. */
    label: text("label").notNull(),
    /** Anything more the team wants beside it. NULL = nothing was
     * written; the write path normalizes a blank string to NULL, so an
     * empty string never reaches the column and readers have one
     * absence to test — the rule `contracts.description` already
     * follows. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** "This contract's dates, in date order" — the one read every
     * deadline surface rides, and the shape SCHEMA.md names for the
     * matter sibling. */
    index("contract_key_dates_contract_date_idx").on(table.contractId, table.date),
    /** A label is a line, not a document. Stated here as well as at the
     * seam for the reason every other bound in this schema is: the
     * refusal a person reads is the route's, and this is the rule the
     * row obeys whichever code put it there. Trimmed length, so a label
     * of nothing but spaces is refused rather than stored as a name
     * nobody can see. */
    check("contract_key_dates_label_check", sql`length(btrim(${table.label})) between 1 and 200`),
    /** And a note is a paragraph, not the record's conversation — that
     * is what comments are for (CMT-004). NULL is the absence; an empty
     * string is not a shorter note, it is the same absence spelled
     * differently, and the seam normalizes it away before it gets here. */
    check(
      "contract_key_dates_note_check",
      sql`${table.note} is null or length(btrim(${table.note})) between 1 and 2000`,
    ),
  ],
);

export type ContractKeyDate = typeof contractKeyDates.$inferSelect;
