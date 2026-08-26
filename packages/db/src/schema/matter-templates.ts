// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Named Matter creation templates (MTR-013). A template belongs to one
 * Matter type and is copied into a Matter only when somebody explicitly
 * selects it during creation. Editing or archiving this row therefore never
 * changes a Matter that already exists.
 */

import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
