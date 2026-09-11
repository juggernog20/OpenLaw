// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023: one record membership per person. */
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contracts } from "./contracts.js";

export const contractTeam = pgTable(
  "contract_team",
  {
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "contract_team_pkey", columns: [table.contractId, table.userId] }),
    index("contract_team_user_idx").on(table.userId),
  ],
);

export type ContractTeamMember = typeof contractTeam.$inferSelect;
