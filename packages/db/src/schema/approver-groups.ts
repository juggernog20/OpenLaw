// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reusable approver templates (CTR-012), Admin-managed from Settings →
 * Contracts → Approver groups: a name, an optional description, and a
 * member list ("Commercial sign-off" = GC + CFO).
 *
 * A group is a template and nothing more. Applying one snapshots its
 * members into approval requests at apply time, so a later edit — or an
 * archive — never touches a request that already exists. That is why
 * archiving needs no reassignment guard: an archived group only leaves
 * the apply picker.
 *
 * There is no slug and no display order. Nothing machine-reads a group,
 * and the picker lists groups by name, so neither column has a reader
 * (SCHEMA.md specifies the table the same way).
 */

import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

export const approverGroups = pgTable("approver_groups", {
  id: uuidPk(),
  /** What the Administrator called it; renameable, and the only identity
   * the apply picker shows. */
  name: text("name").notNull(),
  /** NULL = the group carries no description. */
  description: text("description"),
  /** SET-003 soft delete: NULL = live; a timestamp = archived, out of
   * the apply picker and the default list, nothing lost. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Application code owns every write here, so $onUpdate keeps the
  // audit trail honest for writers that forget to set it (org.ts note).
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ApproverGroup = typeof approverGroups.$inferSelect;

export const approverGroupMembers = pgTable(
  "approver_group_members",
  {
    /** The group carries the membership: deleting a group would take its
     * members with it. */
    groupId: text("group_id")
      .notNull()
      .references(() => approverGroups.id, { onDelete: "cascade" }),
    // No cascade: a person is archived, never deleted (SET-005), so the
    // membership survives their leaving and the template keeps its shape.
    // Only Member+ users are accepted here — application-enforced, since
    // a role change cannot be checked by a constraint.
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** When the person joined the template. A row is written or deleted,
     * never edited, so there is no `updated_at` beside it. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "approver_group_members_pkey", columns: [table.groupId, table.userId] }),
    // "Which groups is this person on" — the read an archived-user sweep
    // and the M14 apply picker both ride.
    index("approver_group_members_user_idx").on(table.userId),
  ],
);

export type ApproverGroupMember = typeof approverGroupMembers.$inferSelect;
