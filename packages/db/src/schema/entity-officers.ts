// SPDX-License-Identifier: AGPL-3.0-only

/** Current and former officers on an Entity (ENT-001). */
import { date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { entities } from "./entities.js";
import { uuidPk } from "./helpers.js";
import { officerRoles } from "./officer-roles.js";

export const entityOfficers = pgTable(
  "entity_officers",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    officerRoleId: text("officer_role_id")
      .notNull()
      .references(() => officerRoles.id),
    /** NULL when the appointment date is not on record. */
    appointedOn: date("appointed_on"),
    /** NULL means a current officer; a date makes them a former one. */
    resignedOn: date("resigned_on"),
    /** The app user this officer is, when they have an account. NULL for
     * the usual case: an officer who is not a user (ENT-001). */
    userId: text("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("entity_officers_entity_idx").on(table.entityId, table.resignedOn, table.createdAt),
    index("entity_officers_role_idx").on(table.officerRoleId),
    index("entity_officers_user_idx").on(table.userId),
  ],
);

export type EntityOfficer = typeof entityOfficers.$inferSelect;
