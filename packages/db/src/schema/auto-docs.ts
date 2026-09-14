// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001 and ADO-004: one Auto-Doc, one template chain, immutable form snapshots. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { matters } from "./matters.js";
import { departments } from "./departments.js";
import { users } from "./auth.js";
import { contracts, type TermType, type ValueCadence } from "./contracts.js";
import { entities } from "./entities.js";
import { contractTypes } from "./contract-types.js";
import { documents, documentVersions } from "./documents.js";
import { FIELD_TYPES, type FieldType, type CustomFieldValue } from "./fields.js";
import { uuidPk } from "./helpers.js";

export const AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES = [
  "none",
  "every_use",
  "once_per_auto_doc",
  "once",
] as const;
export const AUTO_DOC_FORMATS = ["docx", "pdf", "both"] as const;
export const AUTO_DOC_EMAIL_STATES = [
  "not_requested",
  "pending",
  "sent",
  "failed",
  "unconfigured",
] as const;
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
  /** The Value map supplies the units that a numeric answer cannot carry. */
  valueCurrency?: string | null;
  valueCadence?: ValueCadence | null;
}
export interface AutoDocFormDefinition {
  fields: AutoDocFormField[];
  clauseRules?: AutoDocClauseRule[];
}

/** Contract facts resolved at submission and retained for the same Generation's retry. */
export interface AutoDocContractSnapshot {
  autoDocName: string;
  contractTypeId: string;
  title: string;
  entityId: string | null;
  businessOwnerId: string | null;
  /** Null or absent in legacy snapshots means the Contract starts unassigned. */
  legalOwnerId?: string | null;
  owningDepartmentId: string | null;
  region: string | null;
  primaryCounterpartyName: string | null;
  customFields: Record<string, CustomFieldValue>;
  value: { amount: number; currency: string; cadence: ValueCadence } | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  termType: TermType;
}

/** ADO-012: content-free identities keep generated Document and Contract provenance after erasure. */
export const autoDocGenerationOrigins = pgTable("auto_doc_generation_origins", { id: uuidPk() });

export const autoDocs = pgTable(
  "auto_docs",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    formats: text("formats", { enum: AUTO_DOC_FORMATS }).notNull().default("both"),
    /** Null omits the optional email cover note. */
    coverNote: text("cover_note"),
    /** Null uses a mapped title, then the Auto-Doc's name. */
    titlePattern: text("title_pattern"),
    /** Null lets the form supply our Entity. */
    fixedEntityId: text("fixed_entity_id").references(() => entities.id),
    /** Null leaves an unmatched Generation without a Legal Owner. */
    defaultLegalOwnerId: text("default_legal_owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    state: text("state", { enum: AUTO_DOC_STATES }).notNull().default("draft"),
    /** Null uses the org acknowledgement text. */
    acknowledgementText: text("acknowledgement_text"),
    acknowledgementFrequency: text("acknowledgement_frequency", {
      enum: AUTO_DOC_ACKNOWLEDGEMENT_FREQUENCIES,
    })
      .notNull()
      .default("once_per_auto_doc"),
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
    check(
      "auto_docs_acknowledgement_frequency_check",
      sql`${table.acknowledgementFrequency} in ('none', 'every_use', 'once_per_auto_doc', 'once')`,
    ),
    check("auto_docs_formats_check", sql`${table.formats} in ('docx', 'pdf', 'both')`),
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
    detection: jsonb("detection")
      .$type<{
        placeholders: string[];
        blocks: string[];
        /** Absent in scans saved before directives were detected. */
        directives?: { slug: string; directive: string }[];
      }>()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "auto_doc_template_scans_version_fk",
      columns: [table.documentVersionId],
      foreignColumns: [documentVersions.id],
    }).onDelete("cascade"),
  ],
);

export interface AutoDocFilingRequest {
  id: string;
  destination: { kind: "matter" | "contract"; number: number };
  format: "docx" | "pdf";
}

export const AUTO_DOC_GENERATION_STATES = ["pending", "ready", "failed"] as const;
export const autoDocGenerations = pgTable(
  "auto_doc_generations",
  {
    id: uuidPk().references(() => autoDocGenerationOrigins.id),
    autoDocId: text("auto_doc_id")
      .notNull()
      .references(() => autoDocs.id),
    documentVersionId: text("document_version_id").notNull(),
    formVersionId: text("form_version_id").notNull(),
    generatedBy: text("generated_by")
      .notNull()
      .references(() => users.id),
    /** Null means this Generation has no automatic Contract destination. */
    contractSnapshot: jsonb("contract_snapshot").$type<AutoDocContractSnapshot>(),
    createdContractId: text("created_contract_id").references((): AnyPgColumn => contracts.id, {
      onDelete: "set null",
    }),
    /** The original primary Document, retained even if Legal chooses a later primary. */
    createdDocumentId: text("created_document_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),
    /** Accepted with the answers; the delivery worker fulfils it once the chosen format is ready. */
    requestedFiling: jsonb("requested_filing").$type<AutoDocFilingRequest>(),
    filingFailure: jsonb("filing_failure").$type<{ code: string; detail: string }>(),
    answers: jsonb("answers").$type<Record<string, CustomFieldValue>>().notNull(),
    formats: text("formats", { enum: AUTO_DOC_FORMATS }).notNull().default("docx"),
    /** Saved at submission; null means this Generation has no cover note. */
    coverNote: text("cover_note"),
    displayValues: jsonb("display_values").$type<Record<string, string>>().notNull().default({}),
    attempt: integer("attempt").notNull().default(1),
    /** Null until conversion completes, or when PDF was not requested. */
    pdfFileRef: text("pdf_file_ref"),
    emailState: text("email_state", { enum: AUTO_DOC_EMAIL_STATES })
      .notNull()
      .default("not_requested"),
    /** Null unless the send was recorded as successful. */
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    /** Null unless email failed or SMTP was unconfigured. */
    emailFailure: jsonb("email_failure").$type<{ code: string; detail: string }>(),
    state: text("state", { enum: AUTO_DOC_GENERATION_STATES }).notNull().default("pending"),
    /** Null until a complete Word output has been stored. */
    docxFileRef: text("docx_file_ref"),
    /** Null unless the Generation failed. */
    failure: jsonb("failure").$type<{ code: string; detail: string }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "auto_doc_generations_file_fk",
      columns: [table.documentVersionId],
      foreignColumns: [documentVersions.id],
    }),
    foreignKey({
      name: "auto_doc_generations_form_fk",
      columns: [table.formVersionId],
      foreignColumns: [autoDocFormVersions.id],
    }),
    uniqueIndex("auto_doc_generations_created_contract_idx").on(table.createdContractId),
    uniqueIndex("auto_doc_generations_created_document_idx").on(table.createdDocumentId),
    index("auto_doc_generations_delivery_idx").on(table.state, table.emailState),
    check("auto_doc_generations_formats_check", sql`${table.formats} in ('docx', 'pdf', 'both')`),
    check("auto_doc_generations_attempt_check", sql`${table.attempt} > 0`),
    check(
      "auto_doc_generations_email_state_check",
      sql`${table.emailState} in ('not_requested', 'pending', 'sent', 'failed', 'unconfigured')`,
    ),
    check(
      "auto_doc_generations_email_sent_check",
      sql`(${table.emailState} = 'sent') = (${table.emailSentAt} is not null)`,
    ),
    check(
      "auto_doc_generations_email_ready_check",
      sql`${table.emailState} not in ('sent', 'unconfigured') or ${table.state} = 'ready'`,
    ),
    check(
      "auto_doc_generations_email_failure_check",
      sql`((${table.emailState} in ('failed', 'unconfigured')) = (${table.emailFailure} is not null)) and
        (${table.emailFailure} is null or (
          jsonb_typeof(${table.emailFailure}) = 'object' and
          jsonb_typeof(${table.emailFailure}->'code') = 'string' and
          jsonb_typeof(${table.emailFailure}->'detail') = 'string' and
          nullif(btrim(${table.emailFailure}->>'code'), '') is not null and
          nullif(btrim(${table.emailFailure}->>'detail'), '') is not null
        ))`,
    ),
    index("auto_doc_generations_auto_doc_idx").on(table.autoDocId, table.createdAt),
    index("auto_doc_generations_person_idx").on(table.generatedBy, table.createdAt),
    index("auto_doc_generations_file_version_idx").on(table.documentVersionId),
    index("auto_doc_generations_form_version_idx").on(table.formVersionId),
    check(
      "auto_doc_generations_state_check",
      sql`${table.state} in ('pending', 'ready', 'failed')`,
    ),
    check(
      "auto_doc_generations_ready_check",
      sql`${table.state} <> 'ready' or (${table.docxFileRef} is not null and (${table.formats} = 'docx' or ${table.pdfFileRef} is not null))`,
    ),
    check(
      "auto_doc_generations_failure_check",
      sql`((${table.state} = 'failed') = (${table.failure} is not null)) and
        (${table.failure} is null or (
          jsonb_typeof(${table.failure}) = 'object' and
          jsonb_typeof(${table.failure}->'code') = 'string' and
          jsonb_typeof(${table.failure}->'detail') = 'string' and
          nullif(btrim(${table.failure}->>'code'), '') is not null and
          nullif(btrim(${table.failure}->>'detail'), '') is not null
        ))`,
    ),
  ],
);
export type AutoDocGeneration = typeof autoDocGenerations.$inferSelect;

/** ADO-006: ordered settings, edited in place under the Auto-Doc row lock. */
export const autoDocAssignmentRules = pgTable(
  "auto_doc_assignment_rules",
  {
    id: uuidPk(),
    autoDocId: text("auto_doc_id")
      .notNull()
      .references(() => autoDocs.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    fieldSlug: text("field_slug").notNull(),
    operator: text("operator", { enum: AUTO_DOC_RULE_OPERATORS }).notNull(),
    /** Null is the operand-free is_set condition. */
    value: jsonb("value").$type<AutoDocCondition["value"]>(),
    legalOwnerId: text("legal_owner_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("auto_doc_assignment_rules_order_idx").on(table.autoDocId, table.displayOrder),
    check("auto_doc_assignment_rules_order_check", sql`${table.displayOrder} >= 0`),
    check(
      "auto_doc_assignment_rules_operator_check",
      sql`${table.operator} in ('equals', 'is_one_of', 'is_set', 'is_not')`,
    ),
  ],
);

/** ADO-009: direct people and live Department membership grant the selected audience. */
export const autoDocAudienceUsers = pgTable(
  "auto_doc_audience_users",
  {
    autoDocId: text("auto_doc_id")
      .notNull()
      .references(() => autoDocs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.autoDocId, table.userId] })],
);
export const autoDocAudienceDepartments = pgTable(
  "auto_doc_audience_departments",
  {
    autoDocId: text("auto_doc_id")
      .notNull()
      .references(() => autoDocs.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.autoDocId, table.departmentId] })],
);

/** ADO-008: standing Acknowledgements and consumed every-use Acknowledgements retain their text hash. */
export const autoDocAcknowledgements = pgTable(
  "auto_doc_acknowledgements",
  {
    id: uuidPk(),
    /** Null gives a once acknowledgement org-wide scope. */
    autoDocId: text("auto_doc_id").references(() => autoDocs.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    frequency: text("frequency", { enum: ["every_use", "once_per_auto_doc", "once"] }).notNull(),
    textHash: text("text_hash").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null until an every-use acknowledgement accepts one Generation. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** Null while the words have not been superseded, including after a later text reversion. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("auto_doc_acknowledgements_person_idx").on(table.userId, table.autoDocId, table.textHash),
    index("auto_doc_acknowledgements_text_idx")
      .on(table.textHash)
      .where(sql`${table.revokedAt} is null`),
    check(
      "auto_doc_acknowledgements_frequency_check",
      sql`${table.frequency} in ('every_use', 'once_per_auto_doc', 'once')`,
    ),
    check(
      "auto_doc_acknowledgements_scope_check",
      sql`(${table.autoDocId} is null) = (${table.frequency} = 'once')`,
    ),
    check("auto_doc_acknowledgements_hash_check", sql`${table.textHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "auto_doc_acknowledgements_consumed_check",
      sql`${table.consumedAt} is null or ${table.frequency} = 'every_use'`,
    ),
  ],
);

/** Each Filing retains its history when an Administrator erases the copied Document. */
export const autoDocFilings = pgTable(
  "auto_doc_filings",
  {
    id: uuidPk(),
    generationId: text("generation_id")
      .notNull()
      .references(() => autoDocGenerations.id),
    contractId: text("contract_id").references((): AnyPgColumn => contracts.id),
    matterId: text("matter_id").references(() => matters.id),
    documentId: text("document_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),
    createdContract: boolean("created_contract").notNull().default(false),
    format: text("format", { enum: ["docx", "pdf"] }).notNull(),
    filedBy: text("filed_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auto_doc_filings_generation_idx").on(table.generationId, table.createdAt),
    uniqueIndex("auto_doc_filings_document_idx").on(table.documentId),
    uniqueIndex("auto_doc_filings_contract_birth_idx")
      .on(table.contractId)
      .where(sql`${table.createdContract}`),
    check(
      "auto_doc_filings_owner_check",
      sql`num_nonnulls(${table.contractId}, ${table.matterId}) = 1`,
    ),
    check(
      "auto_doc_filings_birth_check",
      sql`not ${table.createdContract} or ${table.contractId} is not null`,
    ),
    check("auto_doc_filings_format_check", sql`${table.format} in ('docx', 'pdf')`),
  ],
);
