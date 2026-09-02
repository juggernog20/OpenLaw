// SPDX-License-Identifier: AGPL-3.0-only

import type { ContractAnalysisOutcome } from "@openlaw/shared";
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { AI_PRESETS } from "./ai-connector.js";
import { contracts } from "./contracts.js";
import { documentVersions } from "./documents.js";
import { uuidPk } from "./helpers.js";

export const ANALYSIS_RUN_STATES = ["pending", "ready", "failed"] as const;
export type AnalysisRunState = (typeof ANALYSIS_RUN_STATES)[number];

export const ANALYSIS_RUN_TRIGGERS = ["automatic", "manual"] as const;
export type AnalysisRunTrigger = (typeof ANALYSIS_RUN_TRIGGERS)[number];

/** Editable overrides for the shared package's seven core prompts. */
export const aiFieldPrompts = pgTable("ai_field_prompts", {
  slug: text("slug").primaryKey(),
  prompt: text("prompt").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** One reading of one Version against one Contract field schema. */
export const contractAnalysisRuns = pgTable(
  "contract_analysis_runs",
  {
    id: uuidPk(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    /** A lawful Document erasure removes the Version but keeps the run's account. */
    versionId: text("version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    state: text("state", { enum: ANALYSIS_RUN_STATES }).notNull().default("pending"),
    trigger: text("trigger", { enum: ANALYSIS_RUN_TRIGGERS }).notNull(),
    requestedBy: text("requested_by").references(() => users.id),
    preset: text("preset", { enum: AI_PRESETS }).notNull(),
    model: text("model").notNull(),
    truncated: boolean("truncated").notNull().default(false),
    outcome: jsonb("outcome").$type<ContractAnalysisOutcome>(),
    failure: text("failure"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("contract_analysis_runs_contract_idx").on(table.contractId, table.id),
    check(
      "contract_analysis_runs_state_check",
      sql`${table.state} in ('pending', 'ready', 'failed')`,
    ),
    check("contract_analysis_runs_trigger_check", sql`${table.trigger} in ('automatic', 'manual')`),
  ],
);

export type ContractAnalysisRun = typeof contractAnalysisRuns.$inferSelect;
