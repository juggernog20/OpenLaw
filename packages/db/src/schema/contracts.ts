// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record core (M8/1): the workspace for work whose
 * deliverable is a signed document. Only the columns this milestone
 * step reads land here, per the incremental-schema doctrine (TECH-014)
 * — `number`, `title`, the type and status FKs, `priority`, `risk`,
 * `description`, timestamps, and the soft-delete stamp. Owner and team,
 * parties, value, and custom fields arrive with the tickets that read
 * them; term, confidentiality, parent, and matter linking arrive with
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
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { contractStatuses } from "./contract-statuses.js";
import { contractTypes } from "./contract-types.js";
import { uuidPk } from "./helpers.js";

/**
 * DES-018's one ordinal severity ramp, shared by priority and risk
 * (CTR-005) and by every future low→critical enum. Code branches on it
 * — sorting a review queue, coloring a pill — so it is a fixed enum,
 * not an admin-configurable list.
 */
export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

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
    /** CTR-005: not null, `medium` until someone says otherwise. */
    priority: text("priority", { enum: SEVERITY_LEVELS }).notNull().default("medium"),
    /** CTR-005: NULL = not yet assessed, which is not the same as low. */
    risk: text("risk", { enum: SEVERITY_LEVELS }),
    /** Long-form context that fits no other field. NULL = nothing was
     * written; the write path normalizes a blank string to NULL, so an
     * empty string never reaches the column and readers have one
     * absence to test. */
    description: text("description"),
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
    check(
      "contracts_priority_check",
      sql`${table.priority} in ('low', 'medium', 'high', 'critical')`,
    ),
    check("contracts_risk_check", sql`${table.risk} in ('low', 'medium', 'high', 'critical')`),
  ],
);

export type Contract = typeof contracts.$inferSelect;
