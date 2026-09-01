// SPDX-License-Identifier: AGPL-3.0-only

/** A lightweight checklist item on one Matter (MTR-005, M23/4). */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";
import { matters } from "./matters.js";

export const matterTasks = pgTable(
  "matter_tasks",
  {
    id: uuidPk(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isDone: boolean("is_done").notNull().default(false),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** An internal target only: it never joins Matter Key dates or deadline surfaces. */
    dueDate: date("due_date"),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("matter_tasks_matter_order_idx").on(table.matterId, table.displayOrder),
    index("matter_tasks_assignee_due_idx").on(table.assigneeId, table.dueDate),
    check("matter_tasks_title_check", sql`length(btrim(${table.title})) between 1 and 200`),
  ],
);

export type MatterTask = typeof matterTasks.$inferSelect;
