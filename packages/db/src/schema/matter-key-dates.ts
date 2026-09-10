// SPDX-License-Identifier: AGPL-3.0-only

/** One civil, named Key date on a Matter (MTR-004). */
import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    reminderOffsetDays: jsonb("reminder_offset_days").$type<number[]>().notNull().default([]),
    reminderRecipientIds: jsonb("reminder_recipient_ids").$type<string[]>().notNull().default([]),
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
    check(
      "matter_key_dates_reminder_offsets_check",
      sql`case when jsonb_typeof(${table.reminderOffsetDays}) = 'array' then jsonb_array_length(${table.reminderOffsetDays}) <= 20 and not jsonb_path_exists(${table.reminderOffsetDays}, 'strict $[*] ? (@.type() != "number")') and not jsonb_path_exists(${table.reminderOffsetDays}, 'strict $[*] ? (@.type() == "number") ? (@ < 0 || @ > 730 || @ != @.floor())') else false end`,
    ),
    check(
      "matter_key_dates_reminder_recipients_check",
      sql`case when jsonb_typeof(${table.reminderRecipientIds}) = 'array' then not jsonb_path_exists(${table.reminderRecipientIds}, 'strict $[*] ? (@.type() != "string")') else false end`,
    ),
  ],
);

export type MatterKeyDate = typeof matterKeyDates.$inferSelect;
