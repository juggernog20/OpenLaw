// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record core (M8/1): the workspace for work whose
 * deliverable is a signed document. Only the columns this milestone
 * step reads land here, per the incremental-schema doctrine (TECH-014)
 * — `number`, `title`, the type and status FKs, `manager_id`,
 * `priority`, `risk`, the CTR-010 value trio, `description`,
 * `custom_fields`, timestamps, and the soft-delete stamp. M10 adds
 * `is_confidential`, the one column DD-014's gate needs. M16 adds the
 * five CTR-006 term columns. Parent and matter linking arrive with
 * their own milestones. SCHEMA.md is the naming reference, never a
 * migration to transcribe.
 *
 * `number` is CTR-003's global reference: a dedicated Postgres identity
 * sequence, independent of the future matters sequence, rendered C-###
 * and used in URLs. `GENERATED ALWAYS` makes the immutability a
 * database rule, not an application convention — no write path can set
 * or correct it.
 *
 * The contract stores `status_id` only. Its stage is derived from the
 * status and never stored (CTR-001), so renaming a status can never
 * strand a contract on a stage that no longer exists.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
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
import { contractStatuses } from "./contract-statuses.js";
import { contractTypes } from "./contract-types.js";
// A cycle on purpose: a document names its owning contract (DOC-008)
// and a contract names its primary document (CTR-014). Both sides are
// read inside `references(() => …)`, which Drizzle resolves after both
// modules have finished loading, so neither file touches the other's
// bindings while it is still evaluating.
import { documents } from "./documents.js";
import { entities } from "./entities.js";
import type { CustomFieldValue } from "./fields.js";
import { uuidPk } from "./helpers.js";

/**
 * DES-018's one ordinal severity ramp, shared by priority and risk
 * (CTR-005) and by every future low→critical enum. Code branches on it
 * — sorting a review queue, coloring a pill — so it is a fixed enum,
 * not an admin-configurable list.
 */
export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/**
 * CTR-010's cadence: what the recorded amount is per. It backs the
 * "/year" the mock renders after the money, and it is what makes two
 * contract values comparable later — an annualized figure needs to know
 * whether the number is a one-off, a month, or a year. Code branches on
 * it (the suffix, and reporting's annualization), so it is a fixed
 * enum, not an admin-configurable list.
 */
export const VALUE_CADENCES = ["one_time", "monthly", "annually"] as const;
export type ValueCadence = (typeof VALUE_CADENCES)[number];

/**
 * CTR-006's term type: what kind of commitment this contract is.
 *
 * Code branches on it — an evergreen contract holds no expiry, a
 * renewal period belongs to an auto-renewing one alone, and the
 * "renewal pending confirmation" predicate reads it — so it is a fixed
 * enum, not an admin-configurable list.
 */
export const TERM_TYPES = ["fixed", "auto_renew", "evergreen"] as const;
export type TermType = (typeof TERM_TYPES)[number];

export const contracts = pgTable(
  "contracts",
  {
    id: uuidPk(),
    /** CTR-003's immutable global reference, shown as C-###. */
    number: integer("number")
      .notNull()
      .generatedAlwaysAsIdentity({ name: "contracts_number_seq", startWith: 1 }),
    title: text("title").notNull(),
    /** The configured contract type (CTR-002); required at creation.
     * No cascade: an in-use type refuses hard delete (SET-003). */
    contractTypeId: text("contract_type_id")
      .notNull()
      .references(() => contractTypes.id),
    /** The configurable status (CTR-001); the stage derives from it. */
    statusId: text("status_id")
      .notNull()
      .references(() => contractStatuses.id),
    /** CTR-004's single accountable person, labelled **Owner** in the
     * UI. NULL = unassigned, which reads as triage — a real state a
     * contract sits in until someone takes it, not missing data. The
     * column keeps the `manager_id` name the matter sibling uses
     * (MTR-003), so one query shape serves both records. */
    managerId: text("manager_id").references(() => users.id),
    /** CTR-011's our side of the contract: which of our own Entities
     * signs it. NULL until known — a contract is often recorded before
     * anyone decides which subsidiary is on the paper. Their side is
     * the `contract_counterparties` join, which lands with its own
     * ticket. No cascade: an entity is soft-deleted, never dropped, so
     * a signed contract can never lose the name that signed it. */
    entityId: text("entity_id").references(() => entities.id),
    /** CTR-005: not null, `medium` until someone says otherwise. */
    priority: text("priority", { enum: SEVERITY_LEVELS }).notNull().default("medium"),
    /** CTR-005: NULL = not yet assessed, which is not the same as low. */
    risk: text("risk", { enum: SEVERITY_LEVELS }),
    /**
     * CTR-006's term, in five columns that are five fields (M16/1).
     *
     * The type is not null, because every contract is one of the three
     * kinds whether or not anybody has said so. `fixed` is the default
     * and the backfill for every row that existed before this column
     * did: it is the least-asserting of the three — it claims no
     * automatic roll and no perpetual life — and a team re-types its
     * evergreens by edit.
     */
    termType: text("term_type", { enum: TERM_TYPES }).notNull().default("fixed"),
    /** When the term starts. NULL until known — a contract is often
     * recorded before the countersigned copy comes back. */
    effectiveDate: date("effective_date"),
    /** When the term ends. NULL for an evergreen contract, which has no
     * end, and NULL on the other two until somebody records one. The
     * derived notice deadline and days remaining are both subtractions
     * from this, so both are blank while it is. */
    expiryDate: date("expiry_date"),
    /** How far one confirmed roll advances the expiry. Auto-renewing
     * contracts only: nothing rolls on the other two, so a number there
     * would be a fact about a thing that never happens. */
    renewalPeriodMonths: integer("renewal_period_months"),
    /** The action window before expiry, in days. Legal on any term
     * type: a fixed-term contract can carry a notice obligation just as
     * an auto-renewing one can. The notice deadline derives only when
     * there is an expiry to subtract it from. */
    noticePeriodDays: integer("notice_period_days"),
    /** CTR-010's value, in three columns that are one field. The amount
     * is an integer count of the currency's smallest unit — cents for
     * USD, yen for JPY — never a float, so no rounding can creep into a
     * number that ends up in a report. Total-contract-value math
     * (annual × term) is derived at read time, never stored. */
    valueAmount: bigint("value_amount", { mode: "number" }),
    /** The ISO 4217 code the amount is counted in. Fixed-width by the
     * standard, so the column is too. */
    valueCurrency: char("value_currency", { length: 3 }),
    /** What the amount is per (CTR-010). */
    valueCadence: text("value_cadence", { enum: VALUE_CADENCES }),
    /**
     * CTR-015's hierarchy: the one contract this one sits under (M16/5).
     *
     * **One parent, arbitrary depth, and no cycles.** A single column is
     * the one-parent rule stated as a shape, the way
     * `primary_document_id` states its own. Depth is whatever a team
     * draws — an MSA over its SOWs, and a SOW over an amendment of it.
     * Cycles are refused by the write path, which walks up from the
     * proposed parent before it commits; the column can only say that a
     * row is not its own parent, and it does.
     *
     * **Nothing flows down it** (CTR-015, CTR-018). Status, team,
     * confidentiality, and the term stay the record's own. The link is
     * navigational, so a child born under a confidential parent is open
     * unless somebody says otherwise.
     *
     * NULL is the ordinary case: most contracts stand alone. No cascade
     * — a contract is soft-deleted rather than dropped, so the reference
     * outlives an archive, and nothing here decides what a hard delete
     * would mean.
     */
    // The return type is written out for `primary_document_id`'s reason:
    // the reference closes on this same table, and TypeScript cannot
    // infer a type that depends on itself.
    parentId: text("parent_id").references((): AnyPgColumn => contracts.id),
    /** DD-014's opt-in gate, and the whole of it: when set, only the
     * named team, the Owner, and Administrators reach the record or
     * anything attached to it. Not null with a `false` default because
     * open is the product's default (DD-014) and a NULL here would be a
     * third state the reach predicate would have to guess at. The flag
     * never cascades to or from a linked record (CTR-018), so no other
     * table reads this column. */
    isConfidential: boolean("is_confidential").notNull().default(false),
    /**
     * CTR-014's primary document: which of this contract's documents is
     * the instrument (M11/4). Everything else on the record is a loose
     * attachment, outside the primary chain.
     *
     * **The designation is one column, so exactly one document holds it
     * — the rule is the shape rather than a check.** A flag on
     * `documents` would need a partial unique index to say the same
     * thing, and could still be written twice between two transactions.
     *
     * NULL until the record has paper: the first upload takes the
     * designation (M11/4), and from there it moves to another document
     * or it stays where it is. That the named document is a document of
     * *this* contract is enforced at write time, the way DOC-008's
     * one-owner rule is — the route that sets it addresses the document
     * and derives the contract from it, so no request can name a
     * mismatched pair.
     *
     * SET NULL on delete: hard deletion (DOC-010) takes the whole
     * document, and a contract whose instrument was erased has no
     * primary rather than a dangling one.
     */
    // The return type is written out because the reference closes a
    // cycle — a contract names its primary document, and a document
    // names its owning contract — and TypeScript cannot infer a type
    // that depends on itself.
    primaryDocumentId: text("primary_document_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),
    /** Long-form context that fits no other field. NULL = nothing was
     * written; the write path normalizes a blank string to NULL, so an
     * empty string never reaches the column and readers have one
     * absence to test. */
    description: text("description"),
    /** CTR-016's custom fields: one JSON object keyed by the catalog
     * field's `slug`, never by its id. The slug is the field's machine
     * identity and never changes, which is what lets a value outlive
     * every rename — and what lets it be **retained on detach**, so
     * re-attaching the field to the type brings the value back rather
     * than finding an empty box. Which of these keys render, and in
     * what order, is the `contract_type_fields` join's answer, not this
     * column's: values for fields the type no longer attaches sit here
     * unread until something attaches them again. `{}` = nothing
     * recorded, which is where every contract starts. */
    customFields: jsonb("custom_fields")
      .$type<Record<string, CustomFieldValue>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Soft delete for mistakes and imports (CONTEXT.md: Archiving is
     * never a synonym for Ending, which is CTR-019's own column). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    // Identity guarantees distinct numbers; the index is what the
    // number-keyed read (`/contracts/42`) and the list's newest-first
    // ordering ride on.
    uniqueIndex("contracts_number_unique").on(table.number),
    // The archive guards' read shape (armed in a later M8 step): how
    // many contracts hold this type, or this status.
    index("contracts_contract_type_idx").on(table.contractTypeId),
    index("contracts_status_idx").on(table.statusId),
    // "What is on my desk" — the Owner filter the list offers, and the
    // guard that answers whether a departing person still owns work.
    index("contracts_manager_idx").on(table.managerId),
    // "How many contracts hold a value for this field" — the SET-003
    // number the field archive dialog shows. It is a key-existence test
    // (`custom_fields ? slug`) over every row, which is what the
    // default jsonb GIN opclass indexes.
    index("contracts_custom_fields_idx").using("gin", table.customFields),
    // The primary-document designation's own column — the referencing
    // side of the foreign key into `documents` (M11/5). No read filters
    // on it, because the record page reads it off the contract row it
    // already has, so it carried no index until now. What needs one is
    // DOC-010's hard delete: removing a document row makes Postgres
    // check every contract for one naming it as its instrument, and
    // without an index that check is a sequential scan of `contracts`.
    index("contracts_primary_document_idx").on(table.primaryDocumentId),
    // "What sits under this contract" — the read M17's hierarchy
    // breadcrumb and relations panel ride, and the walk the cycle guard
    // already makes on every parent write.
    index("contracts_parent_idx").on(table.parentId),
    // `entity_id` carries no index yet: nothing in M8 reads contracts by
    // the entity that signs them. The roll-up that will (ENT-007, M27)
    // brings its own, per the incremental-schema doctrine.
    check(
      "contracts_priority_check",
      sql`${table.priority} in ('low', 'medium', 'high', 'critical')`,
    ),
    check("contracts_risk_check", sql`${table.risk} in ('low', 'medium', 'high', 'critical')`),
    check(
      "contracts_value_cadence_check",
      sql`${table.valueCadence} in ('one_time', 'monthly', 'annually')`,
    ),
    check(
      "contracts_term_type_check",
      sql`${table.termType} in ('fixed', 'auto_renew', 'evergreen')`,
    ),
    // CTR-006's two shape rules, stated where no write path can get
    // past them. The API refuses both with a named problem type, which
    // is the answer a person reads; these are the answer the row obeys,
    // so a term can never contradict its own type whichever code put it
    // there. An evergreen contract has no end, and only an
    // auto-renewing one rolls.
    check(
      "contracts_evergreen_expiry_check",
      sql`${table.termType} <> 'evergreen' or ${table.expiryDate} is null`,
    ),
    check(
      "contracts_renewal_period_term_check",
      sql`${table.termType} = 'auto_renew' or ${table.renewalPeriodMonths} is null`,
    ),
    // Two periods, two bounds. A roll of zero months would advance an
    // expiry to itself, and a negative notice period would put the
    // deadline after the date it warns about — neither is a term, both
    // are data-entry slips. The ceilings are generous rather than
    // meaningful: a century of months and a century of days.
    check(
      "contracts_renewal_period_range_check",
      sql`${table.renewalPeriodMonths} is null or ${table.renewalPeriodMonths} between 1 and 1200`,
    ),
    check(
      "contracts_notice_period_range_check",
      sql`${table.noticePeriodDays} is null or ${table.noticePeriodDays} between 0 and 36500`,
    ),
    // Two bounds on one column. A negative contract value is not a
    // value — it is a data-entry slip; rebates and credits are
    // payment-tracking territory, which CTR-010 keeps out of these
    // columns. The ceiling is JavaScript's largest exact integer:
    // `bigint` holds far more than that, but every reader of this
    // column is a JavaScript runtime, so a larger number would be read
    // back as a different one. The API refuses it too; this is the
    // rule stated where no caller can get past it.
    check("contracts_value_amount_check", sql`${table.valueAmount} between 0 and 9007199254740991`),
    // CTR-010's "nullable as a group", made a database rule rather than
    // an application convention: either the whole value is recorded or
    // none of it is. It is what stops a stray amount with no currency —
    // a number nobody can read — from ever reaching a row, whichever
    // write path put it there.
    check(
      "contracts_value_group_check",
      sql`num_nonnulls(${table.valueAmount}, ${table.valueCurrency}, ${table.valueCadence}) in (0, 3)`,
    ),
    // The custom fields are a map from slug to value, so the column
    // holds a JSON object or it holds nothing readable. A stored array
    // or bare string would make `custom_fields ? slug` — the archive
    // guard's own test — an error rather than an answer.
    check("contracts_custom_fields_check", sql`jsonb_typeof(${table.customFields}) = 'object'`),
    // The shortest cycle CTR-015 forbids, stated where no write path can
    // get past it. The longer ones need a walk and the walk is the write
    // path's; this is the one case a single row can decide by itself.
    check(
      "contracts_parent_not_self_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  ],
);

export type Contract = typeof contracts.$inferSelect;
