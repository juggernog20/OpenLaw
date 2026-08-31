// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One approval request on one contract (CTR-012).
 *
 * A Member+ user asks a named colleague to sign a contract off. Every
 * request runs in parallel with every other one — there are no chains
 * and no order — and each approver answers for themselves with an
 * approve or a reject plus an optional note.
 *
 * **A decision is final.** There is no un-approve: the row keeps the
 * answer it was given, and asking the same person again after a
 * rejection writes a **new** row. That is why the history of asks
 * survives a re-request rather than being overwritten by it.
 *
 * **A pending request is deleted when it is cancelled, and the activity
 * entry is the durable record** — the same rule the rest of the product
 * follows for a withdrawn act. A decided row is never deleted.
 *
 * `source` says how the request came to be: a person picked the
 * approver by hand (`manual`), or an approver group was applied and its
 * members were snapshotted onto the record (`group`, with `group_id`
 * naming the template). The snapshot is the point — a later edit to the
 * group, or archiving it, never touches a request that already exists.
 */

import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { approverGroups } from "./approver-groups.js";
import { users } from "./auth.js";
import { contracts } from "./contracts.js";
import { uuidPk } from "./helpers.js";

/**
 * How a request came to exist (CTR-012). Code branches on it — the
 * roster names the group a request came from and says "added manually"
 * otherwise — so it is a fixed enum rather than a configurable list.
 */
export const APPROVAL_SOURCES = ["manual", "group"] as const;
export type ApprovalSource = (typeof APPROVAL_SOURCES)[number];

/**
 * Where a request stands (CTR-012). Fixed for the reason the source is:
 * the soft gate branches on "unresolved", the roster draws one DES-005
 * pill family per value, and a renameable label could not carry either.
 */
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const contractApprovals = pgTable(
  "contract_approvals",
  {
    id: uuidPk(),
    /** The record the sign-off is about. Cascade: the request is part of
     * the contract, and a contract that is gone has no approvals. */
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    // No cascade: a person is archived, never deleted (SET-005), so the
    // request survives their leaving and the record still says who was
    // asked. Only Member+ users are accepted — application-enforced,
    // because a role change cannot be checked by a constraint.
    approverId: text("approver_id")
      .notNull()
      .references(() => users.id),
    source: text("source", { enum: APPROVAL_SOURCES }).notNull(),
    /** The template a `group` request was snapshotted from; NULL on a
     * manual one. No cascade and no set-null: the row records which
     * group was applied, and an archived group leaves the picker
     * without disturbing what it already produced. */
    groupId: text("group_id").references(() => approverGroups.id),
    status: text("status", { enum: APPROVAL_STATUSES }).notNull().default("pending"),
    /** The approver's own words on their decision; NULL when they gave
     * none, and always NULL while the request is pending. */
    note: text("note"),
    /** Who asked. Not the same person as the approver in general, and
     * allowed to be (CTR-012 permits self-approval). */
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    /** When the answer landed; NULL while the request is pending. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** "The roster of this contract" — the read every approval surface
     * rides, and the one the soft gate asks. */
    index("contract_approvals_contract_idx").on(table.contractId),
    /**
     * At most one **pending** request per approver per contract
     * (CTR-012), as the database's own last word behind the check the
     * request route makes under the contract's row lock.
     *
     * Partial on purpose: a decided row does not block a re-request, so
     * the same person can be asked again after a rejection and the
     * earlier asks stay on the record.
     */
    uniqueIndex("contract_approvals_pending_idx")
      .on(table.contractId, table.approverId)
      .where(sql`status = 'pending'`),
    /** M29's cross-record read: one person's unresolved asks. Status is
     * beside the approver so decided history is skipped in the index. */
    index("contract_approvals_approver_status_idx").on(table.approverId, table.status),
    /**
     * `source` and `status` hold only the values CTR-012 defines.
     *
     * Drizzle's `{ enum }` is a TypeScript narrowing and emits no
     * constraint, so without these the database accepts any text — and
     * the paired checks below do not catch it: an unknown `source` with
     * a NULL `group_id` satisfies the group-source pair, and an unknown
     * `status` with a `decided_at` satisfies the decided-at pair. Every
     * other closed union in this schema is guarded the same way.
     */
    check("contract_approvals_source_check", sql`source in ('manual', 'group')`),
    check("contract_approvals_status_check", sql`status in ('pending', 'approved', 'rejected')`),
    /** `group_id` is set exactly when the request came from a group.
     * The pair is one datum, and a half-set pair would draw a source
     * cell nobody could read. */
    check("contract_approvals_group_source", sql`(source = 'group') = (group_id is not null)`),
    /** A decision and its timestamp arrive together, and a pending
     * request carries neither. The roster prints "—" for an undecided
     * row rather than guessing, so a row with a time and no decision
     * would be unreadable. */
    check("contract_approvals_decided_at", sql`(status = 'pending') = (decided_at is null)`),
  ],
);

export type ContractApproval = typeof contractApprovals.$inferSelect;
