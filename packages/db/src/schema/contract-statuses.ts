// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-status taxonomy (CTR-001): configurable, renameable
 * lifecycle labels, each mapped to exactly one of the six fixed stages.
 * Code branches on `stage`, never on the label — the stage is picked at
 * creation and is immutable afterward. Eight rows are seeded by the
 * migration that creates the table. Application code enforces the
 * guardrails: every stage keeps at least one unarchived status, and the
 * `draft`, `active`, and `expired` seed rows refuse archive and hard
 * delete entirely.
 */

import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidPk } from "./helpers.js";

/**
 * The fixed six-stage backbone (CTR-001), in canonical forward order.
 * An immutable enum: approvals, e-sign, renewals, and surfaces branch
 * on these — never on status labels.
 */
export const CONTRACT_STAGES = [
  "draft",
  "review",
  "approval",
  "signature",
  "active",
  "ended",
] as const;
export type ContractStage = (typeof CONTRACT_STAGES)[number];

export const contractStatuses = pgTable(
  "contract_statuses",
  {
    id: uuidPk(),
    /** Machine identity, derived from the name at creation; never changes. */
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    /** The stage this status maps to; picked at creation, immutable after. */
    stage: text("stage", { enum: CONTRACT_STAGES }).notNull(),
    /** Picker and list position, 1-based; reorder rewrites the live rows. */
    displayOrder: integer("display_order").notNull(),
    /** True for the eight CTR-001 seed rows; user-created rows are false. */
    isSystemDefault: boolean("is_system_default").notNull().default(false),
    /** SET-003 soft delete: NULL = live; a timestamp = archived, out of
     * pickers and the default list, nothing lost. */
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
    uniqueIndex("contract_statuses_slug_unique").on(table.slug),
    check(
      "contract_statuses_stage_check",
      sql`${table.stage} in ('draft', 'review', 'approval', 'signature', 'active', 'ended')`,
    ),
  ],
);

export type ContractStatus = typeof contractStatuses.$inferSelect;
