// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";
import { uuidPk } from "./helpers.js";

// Names identify an owner on this holding; matching names are not assumed to be the same person.
export const individualHoldings = pgTable(
  "individual_holdings",
  {
    id: uuidPk(),
    ownedEntityId: text("owned_entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("individual_holdings_owned_idx").on(table.ownedEntityId),
    check(
      "individual_holdings_percent_range",
      sql`${table.ownershipPercent} >= 0 and ${table.ownershipPercent} <= 100`,
    ),
    check("individual_holdings_name_length", sql`length(trim(${table.name})) between 1 and 200`),
  ],
);
