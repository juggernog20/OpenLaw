// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { relativeDateRange } from "./relative-dates.js";

describe("relative search dates", () => {
  it.each([
    ["in_last_days", 90, "2025-10-03", "2026-01-01"],
    ["in_next_days", 90, "2026-01-01", "2026-04-01"],
    ["today", null, "2026-01-01", "2026-01-01"],
    ["this_week", null, "2025-12-29", "2026-01-04"],
    ["this_month", null, "2026-01-01", "2026-01-31"],
    ["this_quarter", null, "2026-01-01", "2026-03-31"],
    ["this_year", null, "2026-01-01", "2026-12-31"],
  ])("resolves %s across the local new year", (operator, value, from, to) => {
    expect(
      relativeDateRange(operator, value, new Date("2025-12-31T23:30:00Z"), "Asia/Dubai"),
    ).toEqual([from, to]);
  });

  it.each([
    ["this_week", "2026-01-04", "2025-12-29", "2026-01-04"],
    ["this_week", "2026-01-05", "2026-01-05", "2026-01-11"],
    ["this_month", "2024-02-29", "2024-02-01", "2024-02-29"],
    ["this_month", "2024-03-01", "2024-03-01", "2024-03-31"],
    ["this_quarter", "2026-03-31", "2026-01-01", "2026-03-31"],
    ["this_quarter", "2026-04-01", "2026-04-01", "2026-06-30"],
    ["this_quarter", "2026-07-01", "2026-07-01", "2026-09-30"],
    ["this_quarter", "2026-12-31", "2026-10-01", "2026-12-31"],
    ["this_year", "2024-12-31", "2024-01-01", "2024-12-31"],
  ])("resolves %s on %s", (operator, today, from, to) => {
    expect(relativeDateRange(operator, null, new Date(`${today}T12:00:00Z`), "UTC")).toEqual([
      from,
      to,
    ]);
  });

  it.each(["2026-03-08T07:30:00Z", "2026-11-01T06:30:00Z"])(
    "counts calendar days across a daylight saving change at %s",
    (instant) => {
      const now = new Date(instant);
      const day = instant.slice(0, 10);
      const next = day === "2026-03-08" ? "2026-03-09" : "2026-11-02";
      const previous = day === "2026-03-08" ? "2026-03-07" : "2026-10-31";
      expect(relativeDateRange("in_next_days", 1, now, "America/New_York")).toEqual([day, next]);
      expect(relativeDateRange("in_last_days", 1, now, "America/New_York")).toEqual([
        previous,
        day,
      ]);
    },
  );

  it("uses the requested calendar and leaves absolute operators alone", () => {
    const now = new Date("2025-12-31T23:30:00Z");
    expect(relativeDateRange("today", null, now, "America/Los_Angeles")).toEqual([
      "2025-12-31",
      "2025-12-31",
    ]);
    expect(relativeDateRange("on", "2025-12-31", now, "UTC")).toBeNull();
  });
});
