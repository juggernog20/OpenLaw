// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { CORE_ANALYSIS_TARGETS } from "@openlaw/shared";

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
