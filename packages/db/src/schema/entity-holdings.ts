// SPDX-License-Identifier: AGPL-3.0-only

/** The full ownership graph between our Entities (ENT-003). */
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";

export const HOLDING_SOURCES = ["manual", "register"] as const;
export type HoldingSource = (typeof HOLDING_SOURCES)[number];

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
    /** ENT-011: `register` rows are projected from the owned Entity's
     * share register after each entry write and refuse direct edits;
     * `manual` rows are the hand-typed Holdings of ENT-003. */
    source: text("source", { enum: HOLDING_SOURCES }).notNull().default("manual"),
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
