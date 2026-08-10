// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Locks the DES-014 conventions as literal output strings (#43) across
 * en-US, en-GB, and de-DE, with a fixed reference instant and explicit
 * timezone so the strings are deterministic. A change in any expected
 * string here is a change to the formatting contract — deliberate or a
 * regression, never noise.
 */

import { describe, expect, it } from "vitest";
import {
  configureFormatting,
  formatCount,
  formatCurrency,
  formatDeadline,
  formatFileSize,
  formatLongDateTime,
  formatPercent,
  formatRelativeOrShort,
  formatShortDate,
} from "./format";

// 2026-05-03 2:34 PM PDT — the DES-014 worked example.
const NOW = new Date("2026-05-03T21:34:00Z");
const base = { now: NOW, timeZone: "UTC" } as const;
const enUS = { ...base, locale: "en-US" } as const;
const enGB = { ...base, locale: "en-GB" } as const;
const deDE = { ...base, locale: "de-DE" } as const;

function minus(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeOrShort (activity-feed rule)", () => {
  it("renders relative time inside the 7-day window", () => {
    expect(formatRelativeOrShort(minus(12 * MINUTE), enUS)).toBe("12 minutes ago");
    expect(formatRelativeOrShort(minus(3 * HOUR), enUS)).toBe("3 hours ago");
    expect(formatRelativeOrShort(minus(26 * HOUR), enUS)).toBe("yesterday");
    expect(formatRelativeOrShort(minus(30_000), enUS)).toBe("this minute");
    expect(formatRelativeOrShort(minus(7 * DAY), enUS)).toBe("7 days ago");
    expect(formatRelativeOrShort(minus(12 * MINUTE), deDE)).toBe("vor 12 Minuten");
    expect(formatRelativeOrShort(minus(26 * HOUR), deDE)).toBe("gestern");
  });

  it("cuts over to the short absolute date beyond 7 days", () => {
    expect(formatRelativeOrShort(minus(8 * DAY), enUS)).toBe("Apr 25");
    expect(formatRelativeOrShort(minus(8 * DAY), enGB)).toBe("25 Apr");
    expect(formatRelativeOrShort(minus(8 * DAY), deDE)).toBe("25. Apr.");
    expect(formatRelativeOrShort("2025-12-20T12:00:00Z", enUS)).toBe("Dec 20, 2025");
  });
});

describe("formatShortDate (upload-column rule)", () => {
  it("omits the year in the current year", () => {
    expect(formatShortDate("2026-05-03T12:00:00Z", enUS)).toBe("May 3");
    expect(formatShortDate("2026-05-03T12:00:00Z", enGB)).toBe("3 May");
    expect(formatShortDate("2026-05-03T12:00:00Z", deDE)).toBe("3. Mai");
  });

  it("shows the year when not current", () => {
    expect(formatShortDate("2025-12-20T12:00:00Z", enUS)).toBe("Dec 20, 2025");
    expect(formatShortDate("2025-12-20T12:00:00Z", enGB)).toBe("20 Dec 2025");
    expect(formatShortDate("2025-12-20T12:00:00Z", deDE)).toBe("20. Dez. 2025");
  });

  it("decides the year on the display timezone's calendar", () => {
    // 2025-12-31 23:30 UTC is already 2026-01-01 in Tokyo: no year there.
    const instant = "2025-12-31T23:30:00Z";
    expect(formatShortDate(instant, { ...enUS, timeZone: "Asia/Tokyo" })).toBe("Jan 1");
    expect(formatShortDate(instant, enUS)).toBe("Dec 31, 2025");
  });
});

describe("formatLongDateTime (audit-log and tooltip rule)", () => {
  it("renders the DES-014 worked example, no seconds, with zone label", () => {
    const la = { now: NOW, timeZone: "America/Los_Angeles" } as const;
    expect(formatLongDateTime(NOW, { ...la, locale: "en-US" })).toBe("May 3, 2026, 2:34 PM PDT");
    expect(formatLongDateTime(NOW, { ...la, locale: "en-GB" })).toBe("3 May 2026, 14:34 GMT-7");
    expect(formatLongDateTime(NOW, { ...la, locale: "de-DE" })).toBe("3. Mai 2026, 14:34 GMT-7");
    expect(formatLongDateTime(NOW, enUS)).toBe("May 3, 2026, 9:34 PM UTC");
  });
});

describe("formatDeadline (due-date rule)", () => {
  it("appends the relative qualifier within 30 days", () => {
    expect(formatDeadline("2026-05-10", enUS)).toBe("May 10 (in 7 days)");
    expect(formatDeadline("2026-05-04", enUS)).toBe("May 4 (tomorrow)");
    expect(formatDeadline("2026-05-03", enUS)).toBe("May 3 (today)");
    expect(formatDeadline("2026-05-10", deDE)).toBe("10. Mai (in 7 Tagen)");
  });

  it("marks overdue deadlines", () => {
    expect(formatDeadline("2026-04-30", enUS)).toBe("Apr 30 (3 days overdue)");
    expect(formatDeadline("2026-05-02", enUS)).toBe("May 2 (1 day overdue)");
  });

  it("drops the qualifier beyond 30 days", () => {
    expect(formatDeadline("2026-06-17", enUS)).toBe("Jun 17");
    expect(formatDeadline("2026-12-24", enUS)).toBe("Dec 24");
  });
});

describe("formatCount / formatPercent (number rules)", () => {
  it("formats counts with locale grouping, never compacted", () => {
    expect(formatCount(1234, enUS)).toBe("1,234");
    expect(formatCount(1234, deDE)).toBe("1.234");
    expect(formatCount(1234567, enUS)).toBe("1,234,567");
  });

  it("formats percentages with one fraction digit by default", () => {
    expect(formatPercent(0.425, enUS)).toBe("42.5%");
    expect(formatPercent(0.425, deDE)).toBe("42,5 %");
    expect(formatPercent(0.42567, { ...enUS, maximumFractionDigits: 2 })).toBe("42.57%");
  });
});

describe("formatFileSize", () => {
  it("steps through SI units with the Intl unit style", () => {
    expect(formatFileSize(512, enUS)).toBe("512 byte");
    expect(formatFileSize(1500, enUS)).toBe("1.5 kB");
    expect(formatFileSize(2_250_000_000, enUS)).toBe("2.3 GB");
    expect(formatFileSize(1500, deDE)).toBe("1,5 kB");
  });
});

describe("formatCurrency", () => {
  it("renders smallest-unit amounts with ISO-code precision", () => {
    expect(formatCurrency({ amount: 1_000_000, currency: "USD" }, enUS)).toBe("$10,000.00");
    expect(formatCurrency({ amount: 1_000_000, currency: "USD" }, enGB)).toBe("US$10,000.00");
    expect(formatCurrency({ amount: 1_000_000, currency: "EUR" }, deDE)).toBe("10.000,00 €");
    // Zero-decimal and three-decimal currencies divide by their own unit.
    expect(formatCurrency({ amount: 5000, currency: "JPY" }, enUS)).toBe("¥5,000");
    // The gap after the code is ICU's non-breaking space (U+00A0).
    expect(formatCurrency({ amount: 12_345, currency: "BHD" }, enUS)).toBe("BHD 12.345");
  });

  it("appends the ISO code only when asked (multi-currency surfaces)", () => {
    expect(
      formatCurrency({ amount: 1_000_000, currency: "USD" }, { ...enUS, showCode: true }),
    ).toBe("$10,000.00 USD");
  });
});

describe("timezone resolution (stored override → detected → UTC)", () => {
  it("uses the configured session timezone when no per-call override", () => {
    configureFormatting({ timeZone: "Asia/Tokyo" });
    try {
      expect(formatLongDateTime(NOW, { now: NOW, locale: "en-US" })).toBe(
        "May 4, 2026, 6:34 AM GMT+9",
      );
    } finally {
      configureFormatting({});
    }
  });
});
