// SPDX-License-Identifier: AGPL-3.0-only

/** Configurable matter status labels over the fixed open/closed lifecycle. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const MATTER_STATUS_CATEGORIES = ["open", "closed"] as const;
export type MatterStatusCategory = (typeof MATTER_STATUS_CATEGORIES)[number];

export const matterStatuses = pgTable(
  "matter_statuses",
  {
    id: uuidPk(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    category: text("category", { enum: MATTER_STATUS_CATEGORIES }).notNull(),
    displayOrder: integer("display_order").notNull(),
    isSystemDefault: boolean("is_system_default").notNull().default(false),
    // Null means the status remains available for new and existing matters.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("matter_statuses_slug_unique").on(table.slug),
    check("matter_statuses_category_check", sql`${table.category} in ('open', 'closed')`),
  ],
);

export type MatterStatus = typeof matterStatuses.$inferSelect;
