// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A lightweight checklist item on one contract (CTR-017, M17/1).
 *
 * **The shape is `matter_tasks`, adopted before matters exist to use it**
 * (CTR-017, MTR-005). Title, done flag, optional assignee and due date,
 * and nothing else. Matters take the same machinery in their own arc,
 * and the two surfaces then read alike because they were one shape from
 * the start rather than two that were reconciled later.
 *
 * **Task due dates deliberately do NOT feed deadline surfaces.** A task
 * due date is a team intention — "finish the redline by Friday" — not a
 * contractual obligation. Deadline surfaces (NOT-004) track dates the
 * counterparty or the law imposed; mixing the two would drown real
 * deadlines in internal housekeeping.
 *
 * **Deliberately flat.** No comments, no statuses beyond done/not-done,
 * no sub-tasks. A checklist item that needs a conversation is a matter,
 * not a task; a checklist item that needs children is a project plan,
 * not a checklist. The shape stays small so the surface stays fast and
 * the migration to matters carries no weight it does not need.
 *
 * **Access is the owning contract's and nothing is held here** (DD-014,
 * CTR-021). There is no team, no flag, and no tier on this table: a
 * viewer who reaches the contract reaches its tasks, and a viewer
 * outside a confidential record's audience is answered as if the record
 * were never made. Confidentiality composes for free because this table
 * says nothing about it.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

export const contractTasks = pgTable(
  "contract_tasks",
  {
    id: uuidPk(),
    /** The record the task is on. Cascade: a task is part of the
     * contract, and a contract that is gone has no tasks of its own. */
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    /** What needs doing. Not null, because a task nobody named is a
     * task nobody can act on. */
    title: text("title").notNull(),
    /** Whether the task is complete. The only status a checklist item
     * carries — done or not done, nothing in between. */
    isDone: boolean("is_done").notNull().default(false),
    /** The person responsible. NULL = unassigned; the UI shows the task
     * without an avatar and anyone on the contract can pick it up. */
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** When the team intends to finish this. NULL = no target date.
     * `date` rather than `timestamptz` because a due date is
     * day-granular — display is DES-014's. */
    dueDate: date("due_date"),
    /** Position in the checklist. The write path sets this on create and
     * adjusts siblings on reorder; the read surface orders by it. */
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** "This contract's tasks, in display order" — the one read every
     * checklist surface rides. */
    index("contract_tasks_contract_order_idx").on(table.contractId, table.displayOrder),
    /** M29's cross-record checklist read, ordered from the assignee to
     * the dated work. NULL due dates sort after the dated rows. */
    index("contract_tasks_assignee_due_idx").on(table.assigneeId, table.dueDate),
    /** A title is a line, not a document. Stated here as well as at the
     * seam for the reason every other bound in this schema is: the
     * refusal a person reads is the route's, and this is the rule the
     * row obeys whichever code put it there. Trimmed length, so a title
     * of nothing but spaces is refused rather than stored as a name
     * nobody can see. */
    check("contract_tasks_title_check", sql`length(btrim(${table.title})) between 1 and 200`),
  ],
);

export type ContractTask = typeof contractTasks.$inferSelect;
