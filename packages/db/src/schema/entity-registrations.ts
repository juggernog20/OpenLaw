// SPDX-License-Identifier: AGPL-3.0-only

/** Jurisdictions where an Entity is registered or qualified (ENT-002). */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";
import { uuidPk } from "./helpers.js";

export const ENTITY_REGISTRATION_STATUSES = ["active", "lapsed", "withdrawn"] as const;
export type EntityRegistrationStatus = (typeof ENTITY_REGISTRATION_STATUSES)[number];

export const entityRegistrations = pgTable(
  "entity_registrations",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    jurisdiction: text("jurisdiction").notNull(),
    /** NULL when the jurisdiction's number is not on record. */
    registrationNumber: text("registration_number"),
    /** NULL when no agent is appointed in this jurisdiction. */
    registeredAgent: text("registered_agent"),
    status: text("status", { enum: ENTITY_REGISTRATION_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("entity_registrations_entity_idx").on(table.entityId, table.createdAt),
    check(
      "entity_registrations_status_check",
      sql`${table.status} in ('active', 'lapsed', 'withdrawn')`,
    ),
  ],
);

export type EntityRegistration = typeof entityRegistrations.$inferSelect;
