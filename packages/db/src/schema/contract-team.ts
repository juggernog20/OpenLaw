// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The working group on a contract (CTR-004, M8/2) — the `matter_team`
 * sibling, built to the same shape so one set of membership queries
 * serves both records. The single accountable person is not here: the
 * Owner lives on `contracts.manager_id`, because there is exactly one
 * of them (MTR-003's promotion of the old `assignee` role).
 *
 * The primary key is compound on (contract, user, role), so one person
 * may hold two roles on the same contract — the creator who later joins
 * as a member keeps both facts. That is why the role is part of the key
 * and not a column beside it.
 *
 * External counsel participate as `contributor` (MTR-006); `creator` is
 * written once at creation, so provenance survives every owner change.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contracts } from "./contracts.js";

/** CTR-004's role enum, identical to `matter_team`'s. Code branches on
 * it (a watcher is notified, a member works, a contributor is scoped by
 * the DD-015 grid), so it is fixed, not admin-configurable. */
export const CONTRACT_TEAM_ROLES = ["member", "watcher", "creator", "contributor"] as const;
export type ContractTeamRole = (typeof CONTRACT_TEAM_ROLES)[number];

export const contractTeam = pgTable(
  "contract_team",
  {
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    // No cascade: a person is archived, never deleted (SET-005), so the
    // membership outlives their leaving and the record keeps its history.
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: CONTRACT_TEAM_ROLES }).notNull(),
    /** When the membership started. A row is written or deleted, never
     * edited, so there is no `updated_at` to keep beside it. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Compound key: the same user may hold two roles on one contract.
    primaryKey({
      name: "contract_team_pkey",
      columns: [table.contractId, table.userId, table.role],
    }),
    // "Which contracts am I on" — the read the DD-015 grid and the
    // notification fan-out will both ride.
    index("contract_team_user_idx").on(table.userId),
    check(
      "contract_team_role_check",
      sql`${table.role} in ('member', 'watcher', 'creator', 'contributor')`,
    ),
  ],
);

export type ContractTeamMember = typeof contractTeam.$inferSelect;
