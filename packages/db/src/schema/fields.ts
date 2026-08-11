// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared custom-field catalog (MTR-011, revised by CTR-016): a field
 * is defined once here with a module scope, and per-type attachment
 * joins control which records render it (the joins land with their
 * tickets — TECH-014). `slug` and `field_type` are immutable after
 * creation; scope moves only by promotion to `global`, and narrows back
 * only while no other module attaches the field. Three contract core
 * fields are seeded by the migration that creates the table, each with
 * a default, editable AI extraction prompt (CTR-008). Archived fields
 * are hidden everywhere; stored values are always retained (MTR-014).
 */

import { check, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidPk } from "./helpers.js";

/**
 * The CTR-016 scope enum: module-scoped fields attach only inside their
 * module; `global` attaches across all of them. The catalog only holds
 * `contract` and `global` rows until the matter (M22) and entity (M27)
 * milestones open their scopes — the API gates creation accordingly.
 */
export const FIELD_MODULE_SCOPES = ["matter", "contract", "entity", "global"] as const;
export type FieldModuleScope = (typeof FIELD_MODULE_SCOPES)[number];

/**
 * The nine CTR-016 field types. Immutable after creation — archive and
 * recreate instead; there is no silent value coercion.
 */
export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "boolean",
  "single_select",
  "multi_select",
  "user",
  "entity",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The select types — the only ones that carry an options list. */
export const SELECT_FIELD_TYPES = ["single_select", "multi_select"] as const;

/** The DD-015 tag: `business` fields render for Contributors, `legal`
 * fields stay legal-side. Every field carries exactly one. */
export const FIELD_TAGS = ["business", "legal"] as const;
export type FieldTag = (typeof FIELD_TAGS)[number];

export const fields = pgTable(
  "fields",
  {
    id: uuidPk(),
    /** Machine identity, derived from the name at creation; never
     * changes — it keys the per-module `custom_fields` jsonb. */
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    /** Shown as help text on forms; NULL = the field renders with no
     * help text. */
    description: text("description"),
    moduleScope: text("module_scope", { enum: FIELD_MODULE_SCOPES }).notNull(),
    fieldType: text("field_type", { enum: FIELD_TYPES }).notNull(),
    /** Option labels for the select types, in display order; NULL on
     * every other type — the options check enforces both directions. */
    options: jsonb("options").$type<string[]>(),
    fieldTag: text("field_tag", { enum: FIELD_TAGS }).notNull(),
    /** The CTR-008 extraction prompt, consumed by contract AI analysis;
     * lives on contract-scoped fields, seeded on the core three. NULL =
     * contract analysis skips the field. */
    aiPrompt: text("ai_prompt"),
    /** SET-003 soft delete: NULL = live; a timestamp = archived, hidden
     * everywhere, stored values retained (MTR-014). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Application code owns every write here, so $onUpdate keeps the
    // audit trail honest for writers that forget to set it (org.ts note).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fields_slug_unique").on(table.slug),
    check(
      "fields_module_scope_check",
      sql`${table.moduleScope} in ('matter', 'contract', 'entity', 'global')`,
    ),
    check(
      "fields_field_type_check",
      sql`${table.fieldType} in ('text', 'long_text', 'number', 'date', 'boolean', 'single_select', 'multi_select', 'user', 'entity')`,
    ),
    check("fields_field_tag_check", sql`${table.fieldTag} in ('business', 'legal')`),
    // Options ride exactly the select types: a non-null jsonb array on
    // single/multi select, SQL NULL everywhere else. jsonb_typeof(NULL)
    // is NULL, so the array arm also refuses a missing list.
    check(
      "fields_options_check",
      sql`(${table.fieldType} in ('single_select', 'multi_select') and jsonb_typeof(${table.options}) = 'array') or (${table.fieldType} not in ('single_select', 'multi_select') and ${table.options} is null)`,
    ),
  ],
);

export type Field = typeof fields.$inferSelect;
