// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-008's shared target vocabulary, answer provenance, and source-text budget. */

/** The writer types carried by the seven built-in Contract targets. */
export const CORE_ANALYSIS_TARGET_TYPES = [
  "term_type",
  "date",
  "integer",
  "value",
  "counterparty",
] as const;
export type CoreAnalysisTargetType = (typeof CORE_ANALYSIS_TARGET_TYPES)[number];

export interface CoreAnalysisTarget {
  slug:
    | "term_type"
    | "effective_date"
    | "expiry_date"
    | "renewal_period_months"
    | "notice_period_days"
    | "value"
    | "counterparty";
  defaultPrompt: string;
  type: CoreAnalysisTargetType;
}

/** CTR-008's built-in field schema. Prompt overrides live in the database. */
export const CORE_ANALYSIS_TARGETS = [
  {
    slug: "term_type",
    defaultPrompt:
      "Extract whether the Contract has a fixed term, auto-renews, or continues indefinitely.",
    type: "term_type",
  },
  {
    slug: "effective_date",
    defaultPrompt: "Extract the Contract's effective date as YYYY-MM-DD.",
    type: "date",
  },
  {
    slug: "expiry_date",
    defaultPrompt: "Extract the Contract's expiry or end date as YYYY-MM-DD.",
    type: "date",
  },
  {
    slug: "renewal_period_months",
    defaultPrompt: "Extract the length of each automatic renewal period as a number of months.",
    type: "integer",
  },
  {
    slug: "notice_period_days",
    defaultPrompt: "Extract the notice period for non-renewal or termination as a number of days.",
    type: "integer",
  },
  {
    slug: "value",
    defaultPrompt:
      "Extract the Contract value as an object with integer minor-unit amount, ISO 4217 currency, and cadence one_time, monthly, or annually.",
    type: "value",
  },
  {
    slug: "counterparty",
    defaultPrompt: "Extract the full legal name of the primary Counterparty.",
    type: "counterparty",
  },
] as const satisfies readonly CoreAnalysisTarget[];

export type CoreAnalysisSlug = (typeof CORE_ANALYSIS_TARGETS)[number]["slug"];

/** Maximum source characters sent to one provider call. */
export const AI_ANALYSIS_CHARACTER_BUDGET = 200_000;

export interface AiUnverifiedEntry {
  evidence: string;
  runId: string;
  writtenAt: string;
}

export type AiUnverifiedMap = Record<string, AiUnverifiedEntry>;

export interface ContractAnalysisOutcome {
  written: string[];
  kept: string[];
  unsupported: string[];
  invalid: string[];
  unmatched?: string;
}
