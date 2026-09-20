// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { AI_PROMPTS, CORE_ANALYSIS_TARGETS } from "@openlaw/shared";

describe("the core contract analysis targets", () => {
  it("exports the seven core slugs with defaults and writer types", () => {
    expect(CORE_ANALYSIS_TARGETS.map(({ slug }) => slug)).toEqual([
      "term_type",
      "effective_date",
      "expiry_date",
      "renewal_period_months",
      "notice_period_days",
      "value",
      "counterparty",
    ]);
    expect(CORE_ANALYSIS_TARGETS.map(({ type }) => type)).toEqual([
      "term_type",
      "date",
      "date",
      "integer",
      "integer",
      "value",
      "counterparty",
    ]);
    expect(
      CORE_ANALYSIS_TARGETS.every(({ defaultPrompt }) => defaultPrompt.trim().length > 0),
    ).toBe(true);
  });
});

it("keeps all twelve defaults about meaning only", () => {
  expect(AI_PROMPTS.map(({ defaultPrompt }) => defaultPrompt)).toEqual([
    "Propose a concise opening {module} title.",
    "Synthesize a useful {module} Overview description from the supported facts. Cite all supporting passages. No legal risk assessment.",
    "Propose priority. Request urgency is the default.",
    "Extract the explicitly stated Needed by date. Do not guess missing date parts.",
    "Extract the explicitly named Counterparty legal name. Never invent a name.",
    "Extract the Contract term type.",
    "Extract the Contract's effective date.",
    "Extract the Contract's expiry or end date.",
    "Extract the length of each automatic renewal period.",
    "Extract the notice period for non-renewal or termination.",
    "Extract the Contract value.",
    "Extract the full legal name of the primary Counterparty.",
  ]);
});
