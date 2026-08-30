// SPDX-License-Identifier: AGPL-3.0-only

/** Blank-start, human-advanced Entity obligations (ENT-006). */
import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { entities } from "./entities.js";
import { entityRegistrations } from "./entity-registrations.js";
import { uuidPk } from "./helpers.js";
import { matters } from "./matters.js";

export const entityObligations = pgTable(
  "entity_obligations",
  {
    id: uuidPk(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    label: text("label").notNull(),
    /** The Registration this filing belongs to. NULL when the obligation
     * is Entity-wide or its Registration was deleted (the FK sets null). */
    registrationId: text("registration_id").references(() => entityRegistrations.id, {
      onDelete: "set null",
    }),
    /** Months between cycles. NULL means a one-off obligation, which
     * completes on filing instead of rolling `next_due_on` forward. */
    recurrenceMonths: integer("recurrence_months"),
    nextDueOn: date("next_due_on").notNull(),
    /** Who the reminder goes to. NULL means unassigned: the morning round
     * reminds every Administrator instead (NOT-002). */
    assigneeId: text("assignee_id").references(() => users.id),
    /** Free text. NULL when nobody wrote one. */
    note: text("note"),
    /** The Matter that carries the work. NULL when no Matter is linked. */
    matterId: text("matter_id").references(() => matters.id),
    /** The filing date of a one-off obligation. NULL while it is open; a
     * recurring obligation never sets it and rolls `next_due_on` instead. */
    completedOn: date("completed_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("entity_obligations_entity_due_idx").on(table.entityId, table.nextDueOn, table.id),
    index("entity_obligations_registration_idx").on(table.registrationId),
    index("entity_obligations_assignee_due_idx").on(table.assigneeId, table.nextDueOn),
    index("entity_obligations_matter_idx").on(table.matterId),
    check(
      "entity_obligations_recurrence_months_check",
      sql`${table.recurrenceMonths} is null or ${table.recurrenceMonths} > 0`,
    ),
  ],
);

export type EntityObligation = typeof entityObligations.$inferSelect;
