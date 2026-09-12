// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023: one record membership per person. */
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { matters } from "./matters.js";

export const matterTeam = pgTable(
  "matter_team",
  {
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "matter_team_pkey", columns: [table.matterId, table.userId] }),
    index("matter_team_user_idx").on(table.userId),
  ],
);

export type MatterTeamMember = typeof matterTeam.$inferSelect;
