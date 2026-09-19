// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The names the Contract record gives CTR-008's seven core targets,
 * keyed by slug. The review card, the Field prompts card, and the
 * activity feed all say "Effective date" for `effective_date` from
 * this one table.
 */

import { defineMessage, type MessageDescriptor } from "react-intl";
import type {
  AiPromptGroup,
  AiPromptSlug,
  AiRulePromptSlug,
  ConversionPromptSlug,
  CoreAnalysisSlug,
} from "@openlaw/shared";

// `defineMessage` calls so `i18n:extract` sees them; a bare object
// literal spread into <FormattedMessage> never reaches the catalog.
export const CORE_ANALYSIS_LABELS: Readonly<Record<CoreAnalysisSlug, MessageDescriptor>> = {
  term_type: defineMessage({ id: "contracts.form.termType", defaultMessage: "Term type" }),
  effective_date: defineMessage({
    id: "contracts.form.effectiveDate",
    defaultMessage: "Effective date",
  }),
  expiry_date: defineMessage({ id: "contracts.form.expiryDate", defaultMessage: "Expiry date" }),
  renewal_period_months: defineMessage({
    id: "contracts.form.renewalPeriod",
    defaultMessage: "Renewal period (months)",
  }),
  notice_period_days: defineMessage({
    id: "contracts.form.noticePeriod",
    defaultMessage: "Notice period (days)",
  }),
  value: defineMessage({ id: "contracts.form.value", defaultMessage: "Value" }),
  counterparty: defineMessage({
    id: "contracts.analysis.counterparty",
    defaultMessage: "Counterparty",
  }),
};

/** The names of the shared rule paragraphs on the Prompts card. */
export const AI_RULE_LABELS: Readonly<Record<AiRulePromptSlug, MessageDescriptor>> = {
  "rules.evidence": defineMessage({
    id: "settings.aiAnalysis.prompts.rules.evidence",
    defaultMessage: "Corrections and conflicts",
  }),
  "rules.justification": defineMessage({
    id: "settings.aiAnalysis.prompts.rules.justification",
    defaultMessage: "Justification",
  }),
  "rules.unsupported": defineMessage({
    id: "settings.aiAnalysis.prompts.rules.unsupported",
    defaultMessage: "Missing and unsupported values",
  }),
  "rules.text_answers": defineMessage({
    id: "settings.aiAnalysis.prompts.rules.textAnswers",
    defaultMessage: "Text answers",
  }),
  "rules.scope": defineMessage({
    id: "settings.aiAnalysis.prompts.rules.scope",
    defaultMessage: "Scope of the sources",
  }),
};

/** The names of the Conversion draft's built-in targets on the Prompts card. */
export const CONVERSION_PROMPT_LABELS: Readonly<Record<ConversionPromptSlug, MessageDescriptor>> = {
  "conversion.title": defineMessage({
    id: "settings.aiAnalysis.prompts.conversion.title",
    defaultMessage: "Title",
  }),
  "conversion.description": defineMessage({
    id: "settings.aiAnalysis.prompts.conversion.description",
    defaultMessage: "Description",
  }),
  "conversion.priority": defineMessage({
    id: "settings.aiAnalysis.prompts.conversion.priority",
    defaultMessage: "Priority",
  }),
  "conversion.needed_by": defineMessage({
    id: "settings.aiAnalysis.prompts.conversion.neededBy",
    defaultMessage: "Needed by",
  }),
  "conversion.counterparty": defineMessage({
    id: "settings.aiAnalysis.prompts.conversion.counterparty",
    defaultMessage: "Counterparty",
  }),
};

/** Every editable prompt's name, keyed by slug. */
export const AI_PROMPT_LABELS: Readonly<Record<AiPromptSlug, MessageDescriptor>> = {
  ...AI_RULE_LABELS,
  ...CONVERSION_PROMPT_LABELS,
  ...CORE_ANALYSIS_LABELS,
};

/** The three sections of the Prompts card. */
export const AI_PROMPT_GROUP_LABELS: Readonly<Record<AiPromptGroup, MessageDescriptor>> = {
  rules: defineMessage({
    id: "settings.aiAnalysis.prompts.group.rules",
    defaultMessage: "System prompts",
  }),
  conversion: defineMessage({
    id: "settings.aiAnalysis.prompts.group.conversion",
    defaultMessage: "Matter and Contract conversion prompts",
  }),
  analysis: defineMessage({
    id: "settings.aiAnalysis.prompts.group.analysis",
    defaultMessage: "Contract analysis prompts",
  }),
};

/** The label for a slug that may be a core target's or a catalog Field's. */
export function coreAnalysisLabel(slug: string): MessageDescriptor | undefined {
  return Object.hasOwn(CORE_ANALYSIS_LABELS, slug)
    ? CORE_ANALYSIS_LABELS[slug as CoreAnalysisSlug]
    : undefined;
}

/** The label for any editable prompt's slug, or none for a catalog Field's. */
export function aiPromptLabel(slug: string): MessageDescriptor | undefined {
  return Object.hasOwn(AI_PROMPT_LABELS, slug) ? AI_PROMPT_LABELS[slug as AiPromptSlug] : undefined;
}
