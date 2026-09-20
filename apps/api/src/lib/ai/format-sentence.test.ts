// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { formatSentence } from "./format-sentence.js";
import type { AiExtractionTarget } from "./provider.js";

const cases: [Pick<AiExtractionTarget, "slug" | "type" | "options">, string][] = [
  [
    { slug: "term_type", type: "term_type" },
    'Return exactly "fixed" for a fixed term, "auto_renew" for automatic renewal, or "evergreen" for an indefinite term.',
  ],
  [{ slug: "effective_date", type: "date" }, "Return a date as YYYY-MM-DD."],
  [{ slug: "renewal_period_months", type: "integer" }, "Return a whole number of months."],
  [{ slug: "notice_period_days", type: "integer" }, "Return a whole number of days."],
  [{ slug: "count", type: "integer" }, "Return a whole number."],
  [
    { slug: "value", type: "value" },
    'Return an object with an integer minor-unit amount, an ISO 4217 currency, and cadence "one_time", "monthly", or "annually".',
  ],
  [
    { slug: "counterparty", type: "counterparty" },
    "Return a short text of at most 200 characters.",
  ],
  [{ slug: "title", type: "text" }, "Return a short text of at most 200 characters."],
  [{ slug: "conversion.title", type: "text" }, "Return a short text of at most 200 characters."],
  [{ slug: "short", type: "text" }, "Return a short text."],
  [{ slug: "long", type: "long_text" }, "Return text up to 10000 characters."],
  [
    { slug: "one", type: "single_select", options: ["A", 'B "quoted"'] },
    String.raw`Return one of the allowed options: ["A","B \"quoted\""].`,
  ],
  [
    { slug: "many", type: "multi_select", options: ["A", "B"] },
    'Return an array of the allowed options: ["A","B"].',
  ],
  [{ slug: "one", type: "single_select", options: null }, "Return one text value."],
  [{ slug: "many", type: "multi_select", options: [] }, "Return an array of text values."],
  [{ slug: "number", type: "number" }, "Return a number."],
  [{ slug: "boolean", type: "boolean" }, "Return true or false."],
  [{ slug: "currency", type: "currency" }, "Return an ISO 4217 currency code."],
  [{ slug: "user", type: "user" }, "Return a user id."],
  [{ slug: "entity", type: "entity" }, "Return an Entity id."],
  [
    { slug: "dates", type: "key_dates" },
    "Return up to 20 milestone objects with kind, date as YYYY-MM-DD, label, note, sourceId, and evidence.",
  ],
  [{ slug: "untyped" }, "Return a text, number, boolean, or array of text values."],
];

it.each(cases)("derives the format for %j", (target, expected) => {
  expect(formatSentence(target)).toBe(expected);
});
