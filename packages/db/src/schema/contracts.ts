// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record core (M8/1): the workspace for work whose
 * deliverable is a signed document. Only the columns this milestone
 * step reads land here, per the incremental-schema doctrine (TECH-014)
 * — `number`, `title`, the type and status FKs, `manager_id`,
 * `priority`, `risk`, the CTR-010 value trio, `description`,
 * `custom_fields`, timestamps, and the soft-delete stamp. Term,
 * confidentiality, parent, and matter linking arrive with their own
 * milestones. SCHEMA.md is the naming reference, never a migration to
 * transcribe.
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
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contractStatuses } from "./contract-statuses.js";
import { contractTypes } from "./contract-types.js";
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
  ],
);

export type Contract = typeof contracts.$inferSelect;
