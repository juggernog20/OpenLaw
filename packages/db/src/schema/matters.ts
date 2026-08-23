// SPDX-License-Identifier: AGPL-3.0-only

/** The MTR-002/MTR-003 matter record core, addressed by its own M-number. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import type { CustomFieldValue } from "./fields.js";
import { uuidPk } from "./helpers.js";
import { matterStatuses } from "./matter-statuses.js";
import { matterTypes } from "./matter-types.js";
import { SEVERITY_LEVELS } from "./severity.js";

export const matters = pgTable(
  "matters",
  {
    id: uuidPk(),
    number: integer("number")
      .notNull()
      .generatedAlwaysAsIdentity({ name: "matters_number_seq", startWith: 1 }),
    title: text("title").notNull(),
    description: text("description"),
    matterTypeId: text("matter_type_id")
      .notNull()
      .references(() => matterTypes.id),
    statusId: text("status_id")
      .notNull()
      .references(() => matterStatuses.id),
    // Null leaves the matter unassigned.
    managerId: text("manager_id").references(() => users.id),
    priority: text("priority", { enum: SEVERITY_LEVELS }).notNull().default("medium"),
    // Null means risk has not been assessed.
    risk: text("risk", { enum: SEVERITY_LEVELS }),
    customFields: jsonb("custom_fields")
      .$type<Record<string, CustomFieldValue>>()
      .notNull()
      .default({}),
    /** MTR-015's navigational hierarchy. Nothing inherits along this
     * reference; the write path alone prevents arbitrary-depth cycles. */
    parentId: text("parent_id").references((): AnyPgColumn => matters.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    // Null means the matter is not closed.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    isConfidential: boolean("is_confidential").notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Null means the matter remains active and appears in collections.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("matters_number_unique").on(table.number),
    index("matters_type_idx").on(table.matterTypeId),
    index("matters_status_idx").on(table.statusId),
    index("matters_manager_idx").on(table.managerId),
    index("matters_parent_idx").on(table.parentId),
    check(
      "matters_parent_self_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    check(
      "matters_priority_check",
      sql`${table.priority} in ('low', 'medium', 'high', 'critical')`,
    ),
    check(
      "matters_risk_check",
      sql`${table.risk} is null or ${table.risk} in ('low', 'medium', 'high', 'critical')`,
    ),
  ],
);

export type Matter = typeof matters.$inferSelect;
