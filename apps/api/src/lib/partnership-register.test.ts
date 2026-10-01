// SPDX-License-Identifier: AGPL-3.0-only
import { PARTNERSHIP_BASES, type PartnershipBasis } from "@openlaw/db";
import { describe, expect, it } from "vitest";
import { replayPartnershipRegister, type PartnershipEntry } from "./partnership-register.js";
const parties = [
  { id: "a", kind: "individual" },
  { id: "b", kind: "entity" },
] as const;
const entry = (entryNo: number, patch: Partial<PartnershipEntry> = {}): PartnershipEntry => ({
  id: String(entryNo),
  entryNo,
  kind: "admission",
  effectiveOn: "2024-01-01",
  partyId: "a",
  fromPartyId: null,
  toPartyId: null,
  capacity: "general",
  transfereeStatus: null,
  units: null,
  statedPercent: null,
  amount: null,
  currency: null,
  ...patch,
});
const money = (
  n: number,
  kind: "commitment" | "contribution" | "return",
  amount: number,
  patch = {},
) => entry(n, { kind, capacity: null, amount, currency: "USD", ...patch });
const transfer = (n: number, patch = {}) =>
  entry(n, {
    kind: "transfer",
    partyId: null,
    fromPartyId: "a",
    toPartyId: "b",
    capacity: null,
    transfereeStatus: "assignee",
    units: 1,
    ...patch,
  });
const replay = (
  entries: PartnershipEntry[],
  basis: PartnershipBasis = "capital",
  asOf = "9999-12-31",
) => replayPartnershipRegister({ parties, entries }, asOf, basis);
describe("partnership replay", () => {
  it("orders by date and entry number, totals money, and leaves inputs untouched", () => {
    const entries = [
      money(4, "return", 20),
      entry(1, { units: 10, statedPercent: "100.00" }),
      money(3, "contribution", 100),
      money(2, "commitment", 150),
    ];
    const before = structuredClone(entries);
    expect(replay(entries).partners[0]).toMatchObject({
      status: "admitted",
      capacity: "general",
      since: "2024-01-01",
      units: 10,
      statedPercent: 100,
      committed: 150,
      contributed: 100,
      returned: 20,
      unreturned: 80,
      percent: 100,
    });
    expect(replay(entries).totals).toMatchObject({
      units: 10,
      statedPercent: 100,
      committed: 150,
      contributed: 100,
      returned: 20,
      unreturned: 80,
    });
    expect(replay(entries, "capital", "2023-12-31").partners).toEqual([]);
    expect(entries).toEqual(before);
  });
  it.each(PARTNERSHIP_BASES)("includes an assignee by %s basis", (basis) => {
    const result = replay(
      [
        entry(1, { units: 4, statedPercent: "100" }),
        money(2, "contribution", 100),
        transfer(3, { units: 1, statedPercent: "25", amount: 25, currency: "USD" }),
      ],
      basis,
    );
    expect(result.violation).toBeNull();
    expect(result.partners.map((p) => p.percent)).toEqual(basis === "equal" ? [100, 0] : [75, 25]);
    expect(result.totals.unreturned).toBe(100);
    expect(result.partners[1]).toMatchObject({
      status: "assignee",
      capacity: null,
      since: null,
      unreturned: 25,
    });
  });
  it("admits assignees, changes capacity, withdraws and readmits without erasing money history", () => {
    const entries = [
      entry(1, { units: 1 }),
      transfer(2),
      entry(3, { partyId: "b", capacity: "limited" }),
      entry(4, { partyId: "b", kind: "capacity_change", capacity: "general" }),
      transfer(5, { fromPartyId: "b", toPartyId: "a", transfereeStatus: null }),
      entry(6, { partyId: "b", kind: "withdrawal", capacity: null }),
    ];
    expect(replay(entries).partners[1]).toMatchObject({
      status: "ceased",
      capacity: "general",
      units: 0,
    });
    expect(
      replay([...entries, entry(7, { partyId: "b", capacity: "limited" })]).partners[1],
    ).toMatchObject({ status: "admitted", capacity: "limited" });
    expect(
      replay([
        entry(1),
        transfer(2, {
          units: null,
          amount: 1,
          currency: "USD",
          transfereeStatus: "admitted",
          capacity: "limited",
        }),
      ]).violation?.code,
    ).toBe("negative-balance");
    expect(
      replay([
        entry(1, { units: 1 }),
        transfer(2, { transfereeStatus: "admitted", capacity: "limited" }),
      ]).partners[1]?.status,
    ).toBe("admitted");
    expect(
      replay([
        entry(1, { units: 1 }),
        transfer(2),
        entry(3, { partyId: "b", kind: "capacity_change", capacity: "limited" }),
      ]).partners[1],
    ).toMatchObject({ status: "admitted", capacity: "limited" });
  });
  it.each([
    ["duplicate-admission", [entry(1), entry(2)]],
    ["not-standing", [money(1, "contribution", 1)]],
    ["not-standing", [entry(1, { kind: "capacity_change" })]],
    ["not-standing", [entry(1, { kind: "withdrawal", capacity: null })]],
    ["not-standing", [transfer(1)]],
    ["transferee-status", [entry(1, { units: 1 }), transfer(2, { transfereeStatus: null })]],
    ["same-party", [entry(1, { units: 1 }), transfer(2, { toPartyId: "a" })]],
    ["negative-balance", [entry(1, { units: 1 }), transfer(2, { units: 2 })]],
    [
      "negative-balance",
      [entry(1, { statedPercent: "10" }), transfer(2, { units: null, statedPercent: "11" })],
    ],
    ["negative-balance", [entry(1), money(2, "return", 1)]],
    [
      "withdrawal-balance",
      [entry(1, { units: 1 }), entry(2, { kind: "withdrawal", capacity: null })],
    ],
    [
      "withdrawal-balance",
      [entry(1, { statedPercent: "1" }), entry(2, { kind: "withdrawal", capacity: null })],
    ],
    [
      "withdrawal-balance",
      [entry(1), money(2, "contribution", 1), entry(3, { kind: "withdrawal", capacity: null })],
    ],
    [
      "currency-mismatch",
      [entry(1), money(2, "commitment", 1), money(3, "contribution", 1, { currency: "EUR" })],
    ],
    [
      "number-range",
      [entry(1), money(2, "contribution", Number.MAX_SAFE_INTEGER), money(3, "contribution", 1)],
    ],
  ] as const)("refuses %s at the offending entry", (code, entries) => {
    const violation = replay([...entries]).violation;
    expect(violation).toMatchObject({ code, entryId: entries.at(-1)!.id });
    expect(violation?.detail).toContain(`Entry ${entries.at(-1)!.entryNo}`);
  });
  it("refuses classes, unknown parties, percent overflow and unsafe register totals", () => {
    expect(
      replayPartnershipRegister(
        { parties: [{ id: "a", kind: "class" }], entries: [entry(1)] },
        "9999-12-31",
      ).violation?.code,
    ).toBe("invalid-party");
    expect(replay([entry(1, { partyId: "missing" })]).violation?.code).toBe("invalid-party");
    expect(
      replay([
        entry(1, { statedPercent: "100" }),
        entry(2, { partyId: "b", statedPercent: "1" }),
        transfer(3, {
          fromPartyId: "b",
          toPartyId: "a",
          transfereeStatus: null,
          units: null,
          statedPercent: "1",
        }),
      ]).violation?.code,
    ).toBe("percent-range");
    expect(
      replay([entry(1, { units: Number.MAX_SAFE_INTEGER }), entry(2, { partyId: "b", units: 1 })])
        .violation?.code,
    ).toBe("number-range");
  });
  it("checks future negative balances and warns only for the stated basis", () => {
    const entries = [entry(1), money(2, "return", 1, { effectiveOn: "2090-01-01" })];
    expect(replay(entries, "capital", "2025-01-01").violation).toBeNull();
    expect(replay(entries).violation?.code).toBe("negative-balance");
    expect(replay([entry(1, { statedPercent: "99.99" })], "stated").warnings).toEqual([
      { code: "stated-total", total: 99.99 },
    ]);
    expect(replay([entry(1, { statedPercent: "100" })], "stated").warnings).toEqual([]);
    expect(replay([entry(1)]).warnings).toEqual([]);
  });
  it("keeps hundredths exact and admits a ceased transferee only with an explicit status", () => {
    const entries = [
      entry(1, { statedPercent: "0.30" }),
      transfer(2, { units: null, statedPercent: "0.10" }),
      transfer(3, { units: null, statedPercent: "0.20", transfereeStatus: null }),
    ];
    expect(replay(entries).partners[0]?.statedPercent).toBe(0);
    expect(
      replay([
        entry(1),
        entry(2, { kind: "withdrawal", capacity: null }),
        entry(3, { kind: "capacity_change" }),
      ]).violation?.code,
    ).toBe("not-standing");
  });
});

it("ceases an emptied assignee, then explicitly readmits or assigns it on transfer", () => {
  const initial = [
    entry(1, { units: 1 }),
    transfer(2),
    transfer(3, { fromPartyId: "b", toPartyId: "a", transfereeStatus: null }),
    entry(4, { kind: "withdrawal", partyId: "b", capacity: null }),
  ];
  expect(replay(initial).partners[1]).toMatchObject({
    status: "ceased",
    capacity: null,
    since: null,
  });
  expect(replay([...initial, transfer(5, { transfereeStatus: null })]).violation?.code).toBe(
    "transferee-status",
  );
  expect(replay([...initial, transfer(5)]).partners[1]).toMatchObject({
    status: "assignee",
    capacity: null,
    since: null,
  });
  expect(
    replay([...initial, transfer(5, { transfereeStatus: "admitted", capacity: "general" })])
      .partners[1],
  ).toMatchObject({ status: "admitted", capacity: "general", since: "2024-01-01" });
});
