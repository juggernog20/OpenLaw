// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-026: ordered default people copied when a Contract is created. */
import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contractTypes } from "./contract-types.js";

export const contractTypeDefaultPeople = pgTable(
  "contract_type_default_people",
  {
    contractTypeId: text("contract_type_id")
      .notNull()
      .references(() => contractTypes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.contractTypeId, table.userId] })],
);
