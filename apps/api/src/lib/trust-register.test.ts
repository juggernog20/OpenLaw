// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { replayTrustRegister, type TrustEntry } from "./trust-register.js";

const parties = [
  { id: "a", kind: "individual" as const },
  { id: "b", kind: "class" as const },
];
function entry(entryNo: number, patch: Partial<TrustEntry> = {}): TrustEntry {
  return {
    id: `e${entryNo}`,
    entryNo,
    kind: "appointment",
    effectiveOn: "2024-01-01",
    partyId: "a",
    role: "trustee",
    roleLabel: null,
    interest: "Manage the fund",
    amount: null,
    currency: null,
    property: null,
    ...patch,
  };
}
const replay = (entries: TrustEntry[], asOf = "9999-12-31") =>
  replayTrustRegister({ parties, entries }, asOf);

describe("trust register replay", () => {
  it("orders dates then entry numbers without mutating inputs; retains since, until and interest", () => {
    const entries = [entry(2, { kind: "cessation", effectiveOn: "2025-01-01" }), entry(1)];
    const before = structuredClone(entries);
    expect(replay(entries, "2023-12-31").roles).toEqual([]);
    expect(replay(entries, "2024-06-01").roles).toEqual([
      expect.objectContaining({
        partyId: "a",
        role: "trustee",
        since: "2024-01-01",
        until: null,
        interest: "Manage the fund",
        open: true,
      }),
    ]);
    expect(replay(entries).roles[0]).toMatchObject({
      since: "2024-01-01",
      until: "2025-01-01",
      open: false,
    });
    expect(entries).toEqual(before);
    expect(replay([entry(3, { effectiveOn: "2025-02-01" }), ...entries]).roles).toHaveLength(2);
  });
  it("supports every role and distinct other labels", () => {
    const roles = ["settlor", "trustee", "protector", "enforcer", "beneficiary", "other"] as const;
    const entries = roles.map((role, i) =>
      entry(i + 1, { role, roleLabel: role === "other" ? "Adviser" : null }),
    );
    entries.push(entry(7, { role: "other", roleLabel: "Guardian" }));
    expect(replay(entries).violation).toBeNull();
    expect(replay(entries).roles.map((r) => r.role)).toEqual([...roles, "other"]);
    expect(
      replay([
        ...entries,
        entry(8, { kind: "cessation", role: "other", roleLabel: "Adviser" }),
      ]).roles.filter((r) => r.open),
    ).toHaveLength(6);
  });
  it("derives a settlor only when not already held, and reopens after cessation", () => {
    const settlement = entry(1, { kind: "settlement", role: null, property: "House" });
    const entries = [
      settlement,
      { ...settlement, id: "e2", entryNo: 2 },
      entry(3, { kind: "cessation", role: "settlor", effectiveOn: "2024-02-01" }),
      { ...settlement, id: "e4", entryNo: 4, effectiveOn: "2024-03-01" },
    ];
    expect(replay(entries).roles).toEqual([
      expect.objectContaining({ since: "2024-01-01", until: "2024-02-01", open: false }),
      expect.objectContaining({ since: "2024-03-01", until: null, open: true }),
    ]);
    expect(
      replay([entry(1, { role: "settlor" }), { ...settlement, entryNo: 2 }]).roles,
    ).toHaveLength(1);
  });
  it.each([
    { entries: [entry(1), entry(2)], code: "duplicate-appointment", no: 2 },
    { entries: [entry(1, { kind: "cessation" })], code: "role-not-held", no: 1 },
    {
      entries: [entry(1, { kind: "distribution", role: null, property: "House" })],
      code: "not-beneficiary",
      no: 1,
    },
    { entries: [entry(1, { partyId: "b" })], code: "class-role", no: 1 },
    {
      entries: [entry(1, { partyId: "b", kind: "settlement", role: null, property: "House" })],
      code: "class-role",
      no: 1,
    },
  ])("names the offending entry for $code", ({ entries, code, no }) => {
    expect(replay(entries).violation).toMatchObject({ code, entryId: `e${no}`, entryNo: no });
    expect(replay(entries).violation?.detail).toContain(`Entry ${no}`);
  });
  it("allows a class beneficiary and money or property distributions while the role is held", () => {
    const entries = [
      entry(1, { partyId: "b", role: "beneficiary" }),
      entry(2, { partyId: "b", kind: "distribution", role: null, property: "House" }),
      entry(3, { partyId: "b", role: "beneficiary", kind: "cessation", effectiveOn: "2025-01-01" }),
    ];
    expect(replay(entries).violation).toBeNull();
    expect(
      replay([
        ...entries,
        entry(4, {
          partyId: "b",
          kind: "distribution",
          role: null,
          amount: 1,
          currency: "USD",
          effectiveOn: "2025-01-01",
        }),
      ]).violation?.code,
    ).toBe("not-beneficiary");
  });
  it("totals money per currency at the date, excludes property, and warns without refusing", () => {
    const entries = [
      entry(1, { role: "beneficiary" }),
      entry(2, { kind: "settlement", role: null, amount: 100, currency: "USD" }),
      entry(3, { kind: "settlement", role: null, amount: 200, currency: "EUR" }),
      entry(4, {
        kind: "distribution",
        role: null,
        amount: 150,
        currency: "USD",
        effectiveOn: "2025-01-01",
      }),
      entry(5, { kind: "settlement", role: null, property: "House" }),
    ];
    expect(replay(entries, "2024-12-31").warnings).toEqual([]);
    expect(replay(entries).fund).toEqual([
      { currency: "EUR", settled: 200, distributed: 0, balance: 200 },
      { currency: "USD", settled: 100, distributed: 150, balance: -50 },
    ]);
    expect(replay(entries).warnings).toEqual([
      { code: "fund-negative", currency: "USD", balance: -50 },
    ]);
    expect(replay(entries).violation).toBeNull();
  });
  it("refuses a fund total that cannot be represented exactly", () => {
    const entries = [
      entry(1, {
        kind: "settlement",
        role: null,
        amount: Number.MAX_SAFE_INTEGER,
        currency: "USD",
      }),
      entry(2, { kind: "settlement", role: null, amount: 1, currency: "USD" }),
    ];
    expect(replay(entries).violation).toMatchObject({ code: "fund-overflow", entryNo: 2 });
  });
});
