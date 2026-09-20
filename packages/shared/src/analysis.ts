// SPDX-License-Identifier: AGPL-3.0-only

/** Per-call ceilings; the provider's model may impose a lower maximum. */
export const AI_OUTPUT_TOKEN_DEFAULT = 32_768;
export const AI_OUTPUT_TOKEN_WARNING = 32_768;
export const AI_OUTPUT_TOKEN_MIN = 1_024;
export const AI_OUTPUT_TOKEN_MAX = 262_144;

/** CTR-008's shared target vocabulary, answer provenance, and source-text budget. */
import type {
  ConversionAttachmentRead,
  ConversionSuggestion,
  ConversionProvenance,
} from "./conversion-draft.js";

/** The writer types carried by the seven built-in Contract targets. */
export const CORE_ANALYSIS_TARGET_TYPES = [
  "term_type",
  "date",
  "integer",
  "value",
  "counterparty",
] as const;
export type CoreAnalysisTargetType = (typeof CORE_ANALYSIS_TARGET_TYPES)[number];

/** CTR-008's built-in field schema. Prompt overrides live in the database. */
export const CORE_ANALYSIS_TARGETS = [
  {
    slug: "term_type",
    defaultPrompt: "Extract the Contract term type.",
    type: "term_type",
  },
  {
    slug: "effective_date",
    defaultPrompt: "Extract the Contract's effective date.",
    type: "date",
  },
  {
    slug: "expiry_date",
    defaultPrompt: "Extract the Contract's expiry or end date.",
    type: "date",
  },
  {
    slug: "renewal_period_months",
    defaultPrompt: "Extract the length of each automatic renewal period.",
    type: "integer",
  },
  {
    slug: "notice_period_days",
    defaultPrompt: "Extract the notice period for non-renewal or termination.",
    type: "integer",
  },
  {
    slug: "value",
    defaultPrompt: "Extract the Contract value.",
    type: "value",
  },
  {
    slug: "counterparty",
    defaultPrompt: "Extract the full legal name of the primary Counterparty.",
    type: "counterparty",
  },
] as const satisfies readonly {
  slug: string;
  defaultPrompt: string;
  type: CoreAnalysisTargetType;
}[];

export type CoreAnalysisTarget = (typeof CORE_ANALYSIS_TARGETS)[number];
export type CoreAnalysisSlug = CoreAnalysisTarget["slug"];
/** The route-validator view of the one canonical target list. */
export const CORE_ANALYSIS_SLUGS = CORE_ANALYSIS_TARGETS.map((target) => target.slug) as [
  CoreAnalysisSlug,
  ...CoreAnalysisSlug[],
];

/** The Organization default for text Field answers. */
export const AI_ANSWER_STYLES = ["few_words", "sentence", "full_clause"] as const;
export type AiAnswerStyle = (typeof AI_ANSWER_STYLES)[number];

/**
 * The Conversion draft's built-in targets (INT-008): the values every
 * draft proposes beside the target type's own Fields. `{module}` is
 * replaced with "Matter" or "Contract" when the prompt is sent.
 */
export const CONVERSION_PROMPTS = [
  {
    slug: "conversion.title",
    type: "text",
    defaultPrompt: "Propose a concise opening {module} title.",
  },
  {
    slug: "conversion.description",
    type: "long_text",
    defaultPrompt:
      "Synthesize a useful {module} Overview description from the supported facts. Cite all supporting passages. No legal risk assessment.",
  },
  {
    slug: "conversion.priority",
    type: "single_select",
    options: ["low", "medium", "high", "critical"],
    defaultPrompt: "Propose priority. Request urgency is the default.",
  },
  {
    slug: "conversion.needed_by",
    type: "date",
    defaultPrompt: "Extract the explicitly stated Needed by date. Do not guess missing date parts.",
  },
  {
    slug: "conversion.counterparty",
    type: "counterparty",
    defaultPrompt: "Extract the explicitly named Counterparty legal name. Never invent a name.",
  },
] as const satisfies readonly {
  slug: string;
  defaultPrompt: string;
  type: CoreAnalysisTargetType | "text" | "long_text" | "single_select";
  options?: readonly string[];
}[];

/** The two sections of the Prompts card, in the order it draws them. */
export const AI_PROMPT_GROUPS = ["conversion", "analysis"] as const;
export type AiPromptGroup = (typeof AI_PROMPT_GROUPS)[number];

/**
 * Every editable prompt, keyed by slug: the Conversion
 * draft's built-in targets, and CTR-008's seven core analysis targets.
 * `ai_field_prompts` stores an override under any of these slugs; the
 * Prompts card reads and writes them through one route.
 */
export const AI_PROMPTS: readonly {
  slug: AiPromptSlug;
  group: AiPromptGroup;
  defaultPrompt: string;
  type: CoreAnalysisTargetType | "text" | "long_text" | "single_select";
  options?: readonly string[];
}[] = [
  ...CONVERSION_PROMPTS.map((prompt) => ({ ...prompt, group: "conversion" as const })),
  ...CORE_ANALYSIS_TARGETS.map((target) => ({
    ...target,
    group: "analysis" as const,
  })),
];

export type ConversionPromptSlug = (typeof CONVERSION_PROMPTS)[number]["slug"];
export type AiPromptSlug = ConversionPromptSlug | CoreAnalysisSlug;
/** The route-validator view of the one canonical prompt list. */
export const AI_PROMPT_SLUGS = AI_PROMPTS.map((prompt) => prompt.slug) as [
  AiPromptSlug,
  ...AiPromptSlug[],
];

/** Maximum source characters sent to one provider call. */
export const AI_ANALYSIS_CHARACTER_BUDGET = 200_000;

/** A saved value cites either an Analysis run or a Conversion draft. */
export type AiUnverifiedEntry =
  | {
      evidence: string;
      runId: string;
      writtenAt: string;
      draftId?: never;
      sourceContext?: boolean;
      targetTypeId?: never;
      keyDateId?: string;
    }
  | (ConversionProvenance & { evidence?: never; runId?: never });

export type AiUnverifiedMap = Record<string, AiUnverifiedEntry>;

export const CONTRACT_ANALYSIS_RESULT_OUTCOMES = [
  "written",
  "kept",
  "unsupported",
  "invalid",
  "unmatched",
] as const;
export type ContractAnalysisResultOutcome = (typeof CONTRACT_ANALYSIS_RESULT_OUTCOMES)[number];

/** One target exactly as the review card must be able to read it back. */
export interface ContractAnalysisResult {
  slug: string;
  value: unknown;
  evidence: string | null;
  outcome: ContractAnalysisResultOutcome;
}

export interface ContractAnalysisOutcome {
  written: string[];
  kept: string[];
  unsupported: string[];
  invalid: string[];
  unmatched?: string;
  /** Added without a migration: `outcome` is JSON and older runs omit it. */
  results: ContractAnalysisResult[];
}

/** Original Request evidence retained by a post-conversion Analysis run. */
export interface ConversionAnalysisContext {
  requestId: string;
  targetTypeId: string;
  attachmentReads: ConversionAttachmentRead[];
  suggestions: Record<string, ConversionSuggestion>;
  warnings: string[];
}
