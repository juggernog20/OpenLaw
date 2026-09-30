// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ownership graph between our Entities (ENT-003). Every row is
 * projected from the owned Entity's share register after an entry write
 * (ENT-011, ENT-012); no route writes one by hand.
 */
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";

export const entityHoldings = pgTable(
  "entity_holdings",
  {
    ownerEntityId: text("owner_entity_id")
      .notNull()
      .references(() => entities.id),
    ownedEntityId: text("owned_entity_id")
      .notNull()
      .references(() => entities.id),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.ownerEntityId, table.ownedEntityId] }),
    index("entity_holdings_owned_idx").on(table.ownedEntityId),
    check(
      "entity_holdings_percent_range",
      sql`${table.ownershipPercent} >= 0 and ${table.ownershipPercent} <= 100`,
    ),
    check(
      "entity_holdings_distinct_entities",
      sql`${table.ownerEntityId} <> ${table.ownedEntityId}`,
    ),
  ],
);

export type EntityHolding = typeof entityHoldings.$inferSelect;
