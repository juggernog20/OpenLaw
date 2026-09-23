// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { readIntakeContractFacts } from "./intake-default-fields.js";

it.each([
  [{ effective_date: "2026-02-30" }, ["Effective date"]],
  [{ term_type: "evergreen", expiry_date: "2026-12-31" }, ["Term type", "Expiry date"]],
  [{ renewal_period_months: -1 }, ["Renewal period"]],
  [{ value_amount: 100 }, ["Value"]],
] as const)("names invalid native Intake Rows", (answers, names) => {
  expect(() => readIntakeContractFacts(answers)).toThrowError(
    expect.objectContaining({
      statusCode: 400,
      rows: names.map((name) => ({ name, reason: "invalid" })),
    }),
  );
});
