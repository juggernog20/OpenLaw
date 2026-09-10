// SPDX-License-Identifier: AGPL-3.0-only

import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contracts } from "./contracts.js";

/** DD-021 explicit Portal access, separate from the Business Owner and the team. */
export const contractStakeholders = pgTable(
  "contract_stakeholders",
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
    primaryKey({ name: "contract_stakeholders_pkey", columns: [table.contractId, table.userId] }),
    index("contract_stakeholders_user_idx").on(table.userId),
  ],
);
