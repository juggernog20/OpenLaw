// SPDX-License-Identifier: AGPL-3.0-only

/** The working group on a matter; manager remains the record's single accountable field. */
import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { matters } from "./matters.js";

export const MATTER_TEAM_ROLES = ["member", "watcher", "creator", "contributor"] as const;
export type MatterTeamRole = (typeof MATTER_TEAM_ROLES)[number];

export const matterTeam = pgTable(
  "matter_team",
  {
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: MATTER_TEAM_ROLES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "matter_team_pkey", columns: [table.matterId, table.userId, table.role] }),
    index("matter_team_user_idx").on(table.userId),
    check(
      "matter_team_role_check",
      sql`${table.role} in ('member', 'watcher', 'creator', 'contributor')`,
    ),
  ],
);

export type MatterTeamMember = typeof matterTeam.$inferSelect;
