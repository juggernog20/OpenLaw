// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-008: code-owned answer formats shared by extraction and the prompt cards. */

import { MAX_CONTRACT_TITLE_LENGTH, MAX_COUNTERPARTY_NAME_LENGTH } from "@openlaw/shared";
import type { AiExtractionTarget } from "./provider.js";

/** The answer form is fixed by the target schema, independent of its editable prompt. */
export function formatSentence(
  target: Pick<AiExtractionTarget, "slug" | "type" | "options">,
): string {
  switch (target.type) {
    case "term_type":
      return 'Return exactly "fixed" for a fixed term, "auto_renew" for automatic renewal, or "evergreen" for an indefinite term.';
    case "date":
      return "Return a date as YYYY-MM-DD.";
    case "integer":
      if (target.slug === "renewal_period_months") return "Return a whole number of months.";
      if (target.slug === "notice_period_days") return "Return a whole number of days.";
      return "Return a whole number.";
    case "value":
      return 'Return an object with an integer minor-unit amount, an ISO 4217 currency, and cadence "one_time", "monthly", or "annually".';
    case "counterparty":
      // The counterparty link and the conversion draft both refuse a longer name.
      return `Return a short text of at most ${String(MAX_COUNTERPARTY_NAME_LENGTH)} characters.`;
    case "text":
      // The conversion draft's title has no answer style to carry its bound.
      // The draft sends it as `title`; the card row is `conversion.title`.
      if (target.slug === "title" || target.slug === "conversion.title")
        return `Return a short text of at most ${String(MAX_CONTRACT_TITLE_LENGTH)} characters.`;
      return "Return a short text.";
    case "long_text":
      return "Return text up to 10000 characters.";
    case "single_select":
      return target.options?.length
        ? `Return one of the allowed options: ${JSON.stringify(target.options)}.`
        : "Return one text value.";
    case "multi_select":
      return target.options?.length
        ? `Return an array of the allowed options: ${JSON.stringify(target.options)}.`
        : "Return an array of text values.";
    case "number":
      return "Return a number.";
    case "boolean":
      return "Return true or false.";
    case "currency":
      return "Return an ISO 4217 currency code.";
    case "user":
      return "Return a user id.";
    case "entity":
      return "Return an Entity id.";
    case "key_dates":
      return "Return up to 20 milestone objects with kind, date as YYYY-MM-DD, label, note, sourceId, and evidence.";
    case undefined:
      return "Return a text, number, boolean, or array of text values.";
  }
}
