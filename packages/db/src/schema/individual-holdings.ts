// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";
import { HOLDING_SOURCES } from "./entity-holdings.js";
import { entityShareholders } from "./entity-share-register.js";
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
    /** ENT-011: see `entity_holdings.source`. */
    source: text("source", { enum: HOLDING_SOURCES }).notNull().default("manual"),
    /** The register holder a `register` row is projected from, so the
     * projection matches by holder, never by name. */
    shareholderId: text("shareholder_id").references(() => entityShareholders.id, {
      onDelete: "cascade",
    }),
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
    uniqueIndex("individual_holdings_shareholder_idx")
      .on(table.shareholderId)
      .where(sql`${table.shareholderId} is not null`),
    check("individual_holdings_source_known", sql`${table.source} in ('manual', 'register')`),
    check(
      "individual_holdings_source_shape",
      sql`(${table.source} = 'register') = (${table.shareholderId} is not null)`,
    ),
  ],
);
