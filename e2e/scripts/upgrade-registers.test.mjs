// SPDX-License-Identifier: AGPL-3.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { registerFacts, assertRegisterFacts } from "./upgrade-registers.mjs";

const partnership = {
  basis: "units",
  currency: "USD",
  partners: [{ party: { id: "partner" }, units: 60, percent: 100 }],
  entries: [{ id: "admission", entryNo: 1, kind: "admission", effectiveOn: "2024-01-01" }],
  totals: { units: 60, unreturned: 75000 },
};
const trust = {
  parties: [{ party: { id: "settlor" }, role: "settlor", since: "2024-01-01" }],
  entries: [{ id: "settlement", entryNo: 1, kind: "settlement", amount: 100000, currency: "USD" }],
  fund: [{ currency: "USD", settled: 100000, distributed: 0, balance: 100000 }],
};

test("register fingerprints ignore read dates and added envelope fields", () => {
  for (const register of [partnership, trust]) {
    const before = registerFacts(register);
    assertRegisterFacts(before, {
      ...register,
      asOf: "2026-10-01",
      today: "2026-10-01",
      futureField: true,
    });
  }
});

test("register fingerprints detect lost parties, entry numbers, basis and money", () => {
  for (const [register, key, value] of [
    [partnership, "partners", []],
    [partnership, "entries", []],
    [partnership, "basis", "capital"],
    [partnership, "totals", { units: 60, unreturned: 0 }],
    [trust, "parties", []],
    [trust, "entries", [{ ...trust.entries[0], entryNo: 2 }]],
    [trust, "fund", [{ ...trust.fund[0], balance: 0 }]],
  ]) {
    assert.throws(
      () => assertRegisterFacts(registerFacts(register), { ...register, [key]: value }),
      /register/,
    );
  }
});

test("unlinked user fields preserve old register facts while user link changes fail", () => {
  for (const [register, rows] of [
    [partnership, "partners"],
    [trust, "parties"],
  ]) {
    const withUser = (userId) => ({
      ...register,
      [rows]: register[rows].map((row) => ({ ...row, party: { ...row.party, userId } })),
      entries: register.entries.map((entry) => ({
        ...entry,
        party: { id: "entry-party", userId },
      })),
    });
    const unlinked = withUser(null);
    const legacy = {
      ...register,
      entries: register.entries.map((entry) => ({ ...entry, party: { id: "entry-party" } })),
    };
    assertRegisterFacts(registerFacts(legacy), unlinked);
    assertRegisterFacts(registerFacts(unlinked), legacy);
    const linked = withUser("user-1");
    assert.throws(() => assertRegisterFacts(registerFacts(legacy), linked), /register/);
    assert.throws(() => assertRegisterFacts(registerFacts(linked), unlinked), /register/);
    assert.throws(() => assertRegisterFacts(registerFacts(linked), withUser("user-2")), /register/);
  }
});
