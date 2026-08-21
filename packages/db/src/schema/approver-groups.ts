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

import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

export const approverGroups = pgTable(
  "approver_groups",
  {
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
  },
  (table) => [
    /**
     * Two live groups may not share a name, and the comparison is
     * case-insensitive — the same rule folder siblings and saved views
     * already follow (DES-033), and the same reading the picker's own
     * sort takes. The name is the only identity this table has: there
     * is no slug and no display order, so two "Commercial sign-off"
     * rows are two indistinguishable entries in the apply picker and an
     * Administrator has no way to tell which one they are editing
     * (CTR-012's #391 addendum).
     *
     * Partial on the live rows, because archiving frees the name.
     * An archived group is out of the picker and out of the default
     * list, and applying one already snapshotted its members into the
     * requests that used it — so nothing an archived row's name could
     * collide with is still being read.
     */
    uniqueIndex("approver_groups_name_idx")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
  ],
);

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
