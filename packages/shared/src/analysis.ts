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
    defaultPrompt:
      'Extract the Contract term type. Return exactly "fixed" for a fixed term, "auto_renew" for automatic renewal, or "evergreen" for an indefinite term.',
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

/**
 * The shared rules every extraction prompt carries after its fixed
 * output-format lines (CTR-008, 2026-09-19 addendum). Each is one
 * editable paragraph; an override in `ai_field_prompts` replaces the
 * paragraph under its slug, and a reset restores this text. The format
 * lines (JSON shape, source ids, the schema) are not here, because the
 * parser depends on them.
 */
export const AI_RULE_PROMPTS = [
  {
    slug: "rules.evidence",
    defaultPrompt:
      "A later statement overrides an earlier fact only when it explicitly corrects that fact. For unresolved contradictions return conflict: true and cite the conflicting passages; do not choose a value.",
  },
  {
    slug: "rules.justification",
    defaultPrompt:
      'Include a "justification" for each supported value: one or two short sentences explaining why the cited facts support this field, at most 1000 characters. Explain the conclusion, not your internal deliberation. Do not just repeat the value or copy the whole source. Use short, relevant quotes for citations.',
  },
  {
    slug: "rules.unsupported",
    defaultPrompt:
      "Use null when a value is missing, ambiguous, or unsupported by the supplied sources. Never invent facts, assume standard terms, or use outside knowledge to fill gaps. Silence is not evidence of permission, prohibition, zero, or false. Boolean false requires explicit support just as true does. These rules apply to every field. Return no prose.",
  },
  {
    slug: "rules.text_answers",
    defaultPrompt:
      'For text and long text fields, answer in one short sentence that states the position, at most 200 characters. Do not restate, paraphrase, or summarise the provision; the citations carry its wording. Example answers: "Neither party may assign other than to affiliates." and "Yes, on request, expiry or termination." A field whose own instruction asks for more detail or a longer length takes that instruction instead.',
  },
  {
    slug: "rules.scope",
    defaultPrompt:
      "Only the supplied passages were considered. Sources can be omitted or truncated; never claim complete analysis of every attachment or document.",
  },
] as const satisfies readonly { slug: string; defaultPrompt: string }[];

/**
 * The Conversion draft's built-in targets (INT-008): the values every
 * draft proposes beside the target type's own Fields. `{module}` is
 * replaced with "Matter" or "Contract" when the prompt is sent.
 */
export const CONVERSION_PROMPTS = [
  {
    slug: "conversion.title",
    defaultPrompt: "Propose a concise opening {module} title, at most 200 characters.",
  },
  {
    slug: "conversion.description",
    defaultPrompt:
      "Synthesize a useful {module} Overview description from the supported facts, at most 10000 characters. Cite all supporting passages. No legal risk assessment.",
  },
  {
    slug: "conversion.priority",
    defaultPrompt: "Propose priority: low, medium, high, critical. Request urgency is the default.",
  },
  {
    slug: "conversion.needed_by",
    defaultPrompt:
      "Extract the explicitly stated Needed by date as YYYY-MM-DD. Do not guess missing date parts.",
  },
  {
    slug: "conversion.counterparty",
    defaultPrompt:
      "Extract the explicitly named Counterparty legal name, at most 200 characters. Never invent a name.",
  },
] as const satisfies readonly { slug: string; defaultPrompt: string }[];

/** The three sections of the Prompts card, in the order it draws them. */
export const AI_PROMPT_GROUPS = ["rules", "conversion", "analysis"] as const;
export type AiPromptGroup = (typeof AI_PROMPT_GROUPS)[number];

/**
 * Every editable prompt, keyed by slug: the shared rules, the Conversion
 * draft's built-in targets, and CTR-008's seven core analysis targets.
 * `ai_field_prompts` stores an override under any of these slugs; the
 * Prompts card reads and writes them through one route.
 */
export const AI_PROMPTS: readonly {
  slug: AiPromptSlug;
  group: AiPromptGroup;
  defaultPrompt: string;
}[] = [
  ...AI_RULE_PROMPTS.map((rule) => ({ ...rule, group: "rules" as const })),
  ...CONVERSION_PROMPTS.map((prompt) => ({ ...prompt, group: "conversion" as const })),
  ...CORE_ANALYSIS_TARGETS.map(({ slug, defaultPrompt }) => ({
    slug,
    defaultPrompt,
    group: "analysis" as const,
  })),
];

export type AiRulePromptSlug = (typeof AI_RULE_PROMPTS)[number]["slug"];
export type ConversionPromptSlug = (typeof CONVERSION_PROMPTS)[number]["slug"];
export type AiPromptSlug = AiRulePromptSlug | ConversionPromptSlug | CoreAnalysisSlug;
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
