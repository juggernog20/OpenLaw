// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { addBusinessDays } from "./calendar.js";

it.each([
  ["2026-09-11", 1, "2026-09-14"],
  ["2026-09-12", 1, "2026-09-14"],
  ["2026-09-13", 1, "2026-09-14"],
  ["2026-09-12", 0, "2026-09-12"],
  ["2026-09-11", 5, "2026-09-18"],
  ["2026-09-12", 5, "2026-09-18"],
  ["2026-09-14", 10, "2026-09-28"],
  ["2026-12-31", 2, "2027-01-04"],
  ["2028-02-28", 1, "2028-02-29"],
  ["2026-09-14", 36500, "2166-08-11"],
])("adds %s + %i business days", (date, days, expected) => {
  expect(addBusinessDays(date, days)).toBe(expected);
});
