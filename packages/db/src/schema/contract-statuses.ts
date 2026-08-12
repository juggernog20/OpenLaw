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
  check,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { taxonomyBaseColumns } from "./helpers.js";

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
    ...taxonomyBaseColumns(),
    /** The stage this status maps to; picked at creation, immutable after. */
    stage: text("stage", { enum: CONTRACT_STAGES }).notNull(),
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
