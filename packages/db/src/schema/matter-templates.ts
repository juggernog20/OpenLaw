// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Named Matter creation templates (MTR-013). A template belongs to one
 * Matter type and is copied into a Matter only when somebody explicitly
 * selects it during creation. Editing or archiving this row therefore never
 * changes a Matter that already exists.
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CustomFieldValue } from "./fields.js";
import { uuidPk } from "./helpers.js";
import { matterTypes } from "./matter-types.js";
import { SEVERITY_LEVELS } from "./severity.js";

export const matterTemplates = pgTable(
  "matter_templates",
  {
    id: uuidPk(),
    matterTypeId: text("matter_type_id")
      .notNull()
      .references(() => matterTypes.id),
    name: text("name").notNull(),
    description: text("description"),
    defaultPriority: text("default_priority", { enum: SEVERITY_LEVELS }),
    defaultRisk: text("default_risk", { enum: SEVERITY_LEVELS }),
    defaultCustomFields: jsonb("default_custom_fields").$type<Record<string, CustomFieldValue>>(),
    titlePrefix: text("title_prefix"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("matter_templates_type_idx").on(table.matterTypeId, table.name),
    check(
      "matter_templates_default_priority_check",
      sql`${table.defaultPriority} is null or ${table.defaultPriority} in ('low', 'medium', 'high', 'critical')`,
    ),
    check(
      "matter_templates_default_risk_check",
      sql`${table.defaultRisk} is null or ${table.defaultRisk} in ('low', 'medium', 'high', 'critical')`,
    ),
    /**
     * The name is the only identity the creation picker shows inside one
     * type, so two live templates of a type may not share one. Partial on
     * the live rows, because archiving frees the name: an archived
     * template is out of the picker, and a Matter it was applied to holds
     * its own copy of the values (MTR-013).
     */
    uniqueIndex("matter_templates_name_idx")
      .on(table.matterTypeId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export type MatterTemplate = typeof matterTemplates.$inferSelect;

export const MATTER_TEMPLATE_ASSIGNEE_ROLES = ["matter_manager", "none"] as const;

/** Ordered checklist rows copied into a Matter when its template is applied. */
export const matterTemplateTasks = pgTable(
  "matter_template_tasks",
  {
    id: uuidPk(),
    matterTemplateId: text("matter_template_id")
      .notNull()
      .references(() => matterTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueOffsetDays: integer("due_offset_days"),
    assigneeRole: text("assignee_role", { enum: MATTER_TEMPLATE_ASSIGNEE_ROLES })
      .notNull()
      .default("none"),
    displayOrder: integer("display_order").notNull(),
  },
  (table) => [
    index("matter_template_tasks_order_idx").on(table.matterTemplateId, table.displayOrder),
    check(
      "matter_template_tasks_title_check",
      sql`length(btrim(${table.title})) between 1 and 200`,
    ),
    check(
      "matter_template_tasks_due_offset_check",
      sql`${table.dueOffsetDays} is null or ${table.dueOffsetDays} between 0 and 3650`,
    ),
    check(
      "matter_template_tasks_assignee_role_check",
      sql`${table.assigneeRole} in ('matter_manager', 'none')`,
    ),
    check("matter_template_tasks_order_check", sql`${table.displayOrder} >= 1`),
  ],
);

export type MatterTemplateTask = typeof matterTemplateTasks.$inferSelect;

/** Ordered civil dates resolved from the Matter creation date on application. */
export const matterTemplateKeyDates = pgTable(
  "matter_template_key_dates",
  {
    id: uuidPk(),
    matterTemplateId: text("matter_template_id")
      .notNull()
      .references(() => matterTemplates.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    offsetDays: integer("offset_days").notNull(),
    note: text("note"),
    displayOrder: integer("display_order").notNull(),
  },
  (table) => [
    index("matter_template_key_dates_order_idx").on(table.matterTemplateId, table.displayOrder),
    check(
      "matter_template_key_dates_label_check",
      sql`length(btrim(${table.label})) between 1 and 200`,
    ),
    check("matter_template_key_dates_offset_check", sql`${table.offsetDays} between 0 and 3650`),
    check(
      "matter_template_key_dates_note_check",
      sql`${table.note} is null or length(btrim(${table.note})) between 1 and 2000`,
    ),
    check("matter_template_key_dates_order_check", sql`${table.displayOrder} >= 1`),
  ],
);

export type MatterTemplateKeyDate = typeof matterTemplateKeyDates.$inferSelect;
