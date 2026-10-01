// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";
import { entityShareholders } from "./entity-share-register.js";
import { entityRegisterParties } from "./entity-trust-register.js";
import { uuidPk } from "./helpers.js";

// A projected individual owner, matched by share holder or register party.
// Matching names are not assumed to be the same person.
export const individualHoldings = pgTable(
  "individual_holdings",
  {
    id: uuidPk(),
    ownedEntityId: text("owned_entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }).notNull(),
    /** The register holder this row is projected from. */
    registerPartyId: text("register_party_id").references(() => entityRegisterParties.id, {
      onDelete: "cascade",
    }),
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
    check(
      "individual_holdings_register_identity",
      sql`num_nonnulls(${table.shareholderId}, ${table.registerPartyId}) = 1`,
    ),
    uniqueIndex("individual_holdings_register_party_idx")
      .on(table.registerPartyId)
      .where(sql`${table.registerPartyId} is not null`),
    uniqueIndex("individual_holdings_shareholder_idx")
      .on(table.shareholderId)
      .where(sql`${table.shareholderId} is not null`),
  ],
);
