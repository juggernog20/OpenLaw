// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The names the Contract record gives CTR-008's seven core targets,
 * keyed by slug. The review card, the Field prompts card, and the
 * activity feed all say "Effective date" for `effective_date` from
 * this one table.
 */

import { defineMessage, type MessageDescriptor } from "react-intl";
import type { CoreAnalysisSlug } from "@openlaw/shared";

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

/** The label for a slug that may be a core target's or a catalog Field's. */
export function coreAnalysisLabel(slug: string): MessageDescriptor | undefined {
  return Object.hasOwn(CORE_ANALYSIS_LABELS, slug)
    ? CORE_ANALYSIS_LABELS[slug as CoreAnalysisSlug]
    : undefined;
}
