// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseIntakeContractFacts } from "./intake-default-fields.js";

describe("native intake answers", () => {
  it("maps term labels, currency units and counterparties to native facts", () => {
    expect(
      parseIntakeContractFacts({
        termType: "Auto-renewing",
        renewalPeriodMonths: 12,
        effectiveDate: "2026-09-17",
        expiryDate: "2027-09-17",
        noticePeriodDays: 0,
        valueAmount: 1500.5,
        valueCurrency: "USD",
        valueCadence: "Monthly",
        counterparties: "Acme Ltd\nBeta LLC\nAcme Ltd",
      }),
    ).toEqual({
      facts: {
        termType: "auto_renew",
        renewalPeriodMonths: 12,
        effectiveDate: "2026-09-17",
        expiryDate: "2027-09-17",
        noticePeriodDays: 0,
        valueAmount: 150050,
        valueCurrency: "USD",
        valueCadence: "monthly",
      },
      counterparties: ["Acme Ltd", "Beta LLC"],
    });
  });
  it.each([
    [{ effectiveDate: "2026-02-30" }, /valid calendar/],
    [{ noticePeriodDays: -1 }, /whole number/],
    [{ renewalPeriodMonths: 1.5 }, /whole number/],
    [{ termType: "Evergreen", expiryDate: "2026-12-01" }, /no expiry/],
    [{ termType: "Fixed term", renewalPeriodMonths: 12 }, /auto-renewing/],
    [{ valueAmount: -1 }, /non-negative/],
    [{ valueAmount: 1.001, valueCurrency: "USD", valueCadence: "Monthly" }, /precision/],
  ])("refuses invalid native facts %j", (values, error) => {
    expect(() => parseIntakeContractFacts(values)).toThrow(error);
  });
  it("does not invent missing parts of a value", () => {
    expect(parseIntakeContractFacts({ valueAmount: 123 })).toEqual({
      facts: {},
      counterparties: [],
    });
  });
  it.each([
    ["JPY", 123, 123],
    ["KWD", 1.234, 1234],
  ])("respects %s currency precision", (currency, amount, minor) => {
    expect(
      parseIntakeContractFacts({
        valueCurrency: currency,
        valueAmount: amount,
        valueCadence: "One-time",
      }).facts.valueAmount,
    ).toBe(minor);
  });
});
