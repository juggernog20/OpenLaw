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
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contractTypes } from "./contract-types.js";
import { documents, documentVersions } from "./documents.js";
import { FIELD_TYPES, type FieldType } from "./fields.js";
import { uuidPk } from "./helpers.js";

export const AUTO_DOC_STATES = ["draft", "published", "archived"] as const;
export const AUTO_DOC_AUDIENCES = ["legal_only", "selected", "everyone"] as const;
export const AUTO_DOC_RULE_OPERATORS = ["equals", "is_one_of", "is_set", "is_not"] as const;
export const AUTO_DOC_CONTRACT_ATTRIBUTES = [
  "title",
  "primary_counterparty_name",
  "entity_id",
  "owning_department_id",
  "region",
  "value",
  "effective_date",
  "expiry_date",
  "term_type",
] as const;
export interface AutoDocCondition {
  fieldSlug: string;
  operator: (typeof AUTO_DOC_RULE_OPERATORS)[number];
  value: string | number | boolean | (string | number | boolean)[] | null;
}
export interface AutoDocClauseRule extends AutoDocCondition {
  blockName: string;
}
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
  /** Absent in snapshots saved before maps were added. */
  catalogFieldId?: string | null;
  contractAttribute?: (typeof AUTO_DOC_CONTRACT_ATTRIBUTES)[number] | null;
}
export interface AutoDocFormDefinition {
  fields: AutoDocFormField[];
  clauseRules?: AutoDocClauseRule[];
}

export const autoDocs = pgTable(
  "auto_docs",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    state: text("state", { enum: AUTO_DOC_STATES }).notNull().default("draft"),
    audience: text("audience", { enum: AUTO_DOC_AUDIENCES }).notNull().default("legal_only"),
    /** Null means this Auto-Doc has no target Contract Type. */
    targetContractTypeId: text("target_contract_type_id").references(() => contractTypes.id, {
      onDelete: "set null",
    }),
    /** Null while no Live pair is published. */
    publishedDocumentVersionId: text("published_document_version_id").references(
      (): AnyPgColumn => documentVersions.id,
    ),
    /** Null while no Live pair is published. */
    publishedFormVersionId: text("published_form_version_id"),
    /** Null while no Live pair is published. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
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
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "auto_docs_published_form_fk",
      columns: [table.publishedFormVersionId],
      foreignColumns: [autoDocFormVersions.id],
    }),
    check("auto_docs_state_check", sql`${table.state} in ('draft', 'published', 'archived')`),
    check(
      "auto_docs_audience_check",
      sql`${table.audience} in ('legal_only', 'selected', 'everyone')`,
    ),
    check(
      "auto_docs_live_pair_check",
      sql`(${table.publishedDocumentVersionId} is null) = (${table.publishedFormVersionId} is null)`,
    ),
    check(
      "auto_docs_publication_state_check",
      sql`((${table.state} = 'published') = (${table.publishedDocumentVersionId} is not null)) and ((${table.publishedAt} is null) = (${table.publishedDocumentVersionId} is null))`,
    ),
    check(
      "auto_docs_archive_state_check",
      sql`(${table.state} = 'archived') = (${table.archivedAt} is not null)`,
    ),
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
    check(
      "auto_doc_form_fields_map_check",
      sql`not jsonb_path_exists(${table.definition}, '$.fields[*] ? (@.catalogFieldId != null && @.contractAttribute != null)')`,
    ),
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
