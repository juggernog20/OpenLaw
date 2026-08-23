// SPDX-License-Identifier: AGPL-3.0-only

/** One civil, named Key date on a Matter (MTR-004). */
import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";
import { matters } from "./matters.js";

export const matterKeyDates = pgTable(
  "matter_key_dates",
  {
    id: uuidPk(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    label: text("label").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("matter_key_dates_matter_date_idx").on(table.matterId, table.date),
    check("matter_key_dates_label_check", sql`length(btrim(${table.label})) between 1 and 200`),
    check(
      "matter_key_dates_note_check",
      sql`${table.note} is null or length(btrim(${table.note})) between 1 and 2000`,
    ),
  ],
);

export type MatterKeyDate = typeof matterKeyDates.$inferSelect;
