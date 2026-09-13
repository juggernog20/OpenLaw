// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001 and ADO-004: one Auto-Doc, one template chain, immutable form snapshots. */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { documents, documentVersions } from "./documents.js";
import { FIELD_TYPES, type FieldType } from "./fields.js";
import { uuidPk } from "./helpers.js";

export const AUTO_DOC_STATES = ["draft", "published", "archived"] as const;
export const AUTO_DOC_FIELD_TYPES = FIELD_TYPES.filter((type) => type !== "user");
export interface AutoDocFormField {
  slug: string;
  label: string;
  help: string | null;
  fieldType: Exclude<FieldType, "user">;
  options: string[] | null;
  required: boolean;
  displayOrder: number;
  /** Retains the link after a Placeholder disappears, so the editor can mark the orphan. */
  placeholder: boolean;
}
export interface AutoDocFormDefinition {
  fields: AutoDocFormField[];
}

export const autoDocs = pgTable(
  "auto_docs",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    state: text("state", { enum: AUTO_DOC_STATES }).notNull().default("draft"),
    /** Null until the first template upload. */
    templateDocumentId: text("template_document_id").references((): AnyPgColumn => documents.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null while the Auto-Doc is live. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check("auto_docs_state_check", sql`${table.state} in ('draft', 'published', 'archived')`),
    uniqueIndex("auto_docs_template_document_idx")
      .on(table.templateDocumentId)
      .where(sql`${table.templateDocumentId} is not null`),
  ],
);

export const autoDocFormVersions = pgTable(
  "auto_doc_form_versions",
  {
    id: uuidPk(),
    autoDocId: text("auto_doc_id")
      .notNull()
      .references(() => autoDocs.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    definition: jsonb("definition").$type<AutoDocFormDefinition>().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auto_doc_form_versions_number_idx").on(table.autoDocId, table.versionNumber),
    check("auto_doc_form_versions_number_check", sql`${table.versionNumber} >= 1`),
  ],
);

export type AutoDoc = typeof autoDocs.$inferSelect;
export type AutoDocFormVersion = typeof autoDocFormVersions.$inferSelect;

/** Detection belongs to one immutable file Version, alongside its ordinary Document chain. */
export const autoDocTemplateScans = pgTable(
  "auto_doc_template_scans",
  {
    documentVersionId: text("document_version_id").primaryKey(),
    detection: jsonb("detection").$type<{ placeholders: string[]; blocks: string[] }>().notNull(),
  },
  (table) => [
    foreignKey({
      name: "auto_doc_template_scans_version_fk",
      columns: [table.documentVersionId],
      foreignColumns: [documentVersions.id],
    }).onDelete("cascade"),
  ],
);
