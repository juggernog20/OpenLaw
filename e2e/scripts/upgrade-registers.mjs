// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";

// Read at a fixed date so midnight cannot change a preserved register's fingerprint.
const DATE = "2024-01-01";
const path = (id) => `/api/v1/entities/${id}`;
export function registerFacts(register) {
  const keys = register.partners
    ? ["basis", "currency", "partners", "entries", "totals"]
    : ["parties", "entries", "fund"];
  return Object.fromEntries(keys.map((key) => [key, register[key]]));
}
export function assertRegisterFacts(expected, actual) {
  assert.deepEqual(registerFacts(actual), expected, "register facts changed across the upgrade");
}

async function fillRegisters(api, fixture) {
  const { post, patch } = api;
  await patch(path(fixture.trust), { registerKind: "trust" });
  await patch(path(fixture.partnership), { partnershipBasis: "units" });
  let partnership;
  for (const entry of [
    {
      kind: "admission",
      party: { kind: "entity", entityId: fixture.owner },
      capacity: "general",
      units: 60,
    },
    {
      kind: "admission",
      party: { kind: "individual", name: "Upgrade Partner" },
      capacity: "limited",
      units: 40,
    },
  ]) {
    partnership = await post(`${path(fixture.partnership)}/partnership-entries`, {
      effectiveOn: DATE,
      ...entry,
    });
  }
  const party = partnership.partners.find((p) => p.party.kind === "individual").party;
  for (const [kind, amount] of [
    ["commitment", 100000],
    ["contribution", 75000],
    ["return", 25000],
  ]) {
    await post(`${path(fixture.partnership)}/partnership-entries`, {
      kind,
      amount,
      currency: "USD",
      effectiveOn: DATE,
      party: { kind: "party", partyId: party.id },
    });
  }
  await post(`${path(fixture.trust)}/trust-entries`, {
    kind: "settlement",
    effectiveOn: DATE,
    party: { kind: "entity", entityId: fixture.owner },
    amount: 100000,
    currency: "USD",
  });
  const appointed = await post(`${path(fixture.trust)}/trust-entries`, {
    kind: "appointment",
    effectiveOn: DATE,
    party: { kind: "class", description: "Upgrade Settlor's descendants" },
    role: "beneficiary",
    interest: "Discretionary interest",
  });
  const beneficiary = appointed.parties.find((p) => p.role === "beneficiary").party;
  await post(`${path(fixture.trust)}/trust-entries`, {
    kind: "distribution",
    effectiveOn: DATE,
    party: { kind: "party", partyId: beneficiary.id },
    amount: 25000,
    currency: "USD",
  });
}

export async function seedRegisters(api) {
  const { get, post, patch } = api;
  const types = (await get("/api/v1/entities/types")).entityTypes;
  const partnershipType = types.find((t) => t.slug === "partnership");
  const corporation = types.find((t) => t.slug === "corporation");
  const create = async (legalName, type) =>
    (
      await post("/api/v1/entities", {
        legalName,
        entityTypeId: type.id,
        jurisdiction: "Jersey",
      })
    ).entity;
  const owner = (await create("Upgrade Register Holdings Ltd", corporation)).id;
  const legacy = await create("Upgrade old partnership share register", partnershipType);
  // Old APIs omit registerKind. Never call a new route against a pre-M45 baseline.
  const supported = (await get(path(legacy.id))).entity.registerKind !== undefined;
  if (supported) await patch(path(legacy.id), { registerKind: "shares" });
  const classes = await post(`${path(legacy.id)}/share-classes`, { name: "Ordinary" });
  const shareClass = classes.classes.find((c) => c.name === "Ordinary");
  const shares = await post(`${path(legacy.id)}/share-entries`, {
    kind: "allotment",
    effectiveOn: DATE,
    shareClassId: shareClass.id,
    quantity: 100,
    to: { kind: "entity", entityId: owner },
  });
  const fixture = {
    owner,
    legacy: legacy.id,
    shareClassId: shareClass.id,
    shareEntryId: shares.entries[0].id,
    partnership: (await create("Upgrade Partnership", partnershipType)).id,
    trust: (await create("Upgrade Trust", corporation)).id,
    supported,
  };
  if (supported) {
    await fillRegisters(api, fixture);
    fixture.partnershipFacts = registerFacts(
      await get(`${path(fixture.partnership)}/partnership-register?asOf=${DATE}`),
    );
    fixture.trustFacts = registerFacts(
      await get(`${path(fixture.trust)}/trust-register?asOf=${DATE}`),
    );
  }
  return fixture;
}

export async function verifyRegisters(api, fixture) {
  const { get, post } = api;
  const legacy = (await get(path(fixture.legacy))).entity;
  assert.equal(legacy.registerKind, "shares", "old partnership must keep its share register");
  assert.equal(legacy.registerKindSource, "entity", "old partnership must have an Entity pin");
  assert.equal(legacy.registerKindLocked, true);
  const shares = await get(`${path(fixture.legacy)}/share-register`);
  assert.ok(shares.classes.some((c) => c.id === fixture.shareClassId));
  assert.ok(shares.entries.some((e) => e.id === fixture.shareEntryId && e.quantity === 100));
  const partnership = (await get(path(fixture.partnership))).entity;
  assert.equal(partnership.registerKind, "partnership");
  assert.equal(partnership.registerKindSource, "type");
  if (!fixture.supported) {
    assert.equal(
      (await get(`${path(fixture.partnership)}/partnership-register`)).entries.length,
      0,
    );
    await fillRegisters(api, fixture);
  }
  const partners = await get(`${path(fixture.partnership)}/partnership-register?asOf=${DATE}`);
  const trust = await get(`${path(fixture.trust)}/trust-register?asOf=${DATE}`);
  if (fixture.supported) {
    assertRegisterFacts(fixture.partnershipFacts, partners);
    assertRegisterFacts(fixture.trustFacts, trust);
  }
  assert.equal(partners.entries.length, 5);
  assert.equal(partners.basis, "units");
  assert.equal(partners.totals.unreturned, 50000);
  assert.equal(partners.partners.find((p) => p.party.entityId === fixture.owner).percent, 60);
  assert.equal(partners.partners.find((p) => p.party.kind === "individual").percent, 40);
  assert.deepEqual(trust.fund, [
    { currency: "USD", settled: 100000, distributed: 25000, balance: 75000 },
  ]);
  assert.equal(trust.parties.find((p) => p.party.kind === "class").role, "beneficiary");
  assert.equal(trust.parties.find((p) => p.party.entityId === fixture.owner).role, "settlor");
  const holdings = await get(`${path(fixture.partnership)}/holdings`);
  assert.ok(holdings.owners.some((h) => h.owner.id === fixture.owner && h.ownershipPercent === 60));
  assert.equal((await get(`${path(fixture.trust)}/holdings`)).owners.length, 0);
  // A new entry must continue each register's stored counter after migration.
  const nextPartner = await post(`${path(fixture.partnership)}/partnership-entries`, {
    kind: "commitment",
    effectiveOn: DATE,
    party: { kind: "entity", entityId: fixture.owner },
    amount: 10000,
    currency: "USD",
  });
  assert.ok(nextPartner.entries.some((e) => e.entryNo === 6 && e.amount === 10000));
  const nextTrust = await post(`${path(fixture.trust)}/trust-entries`, {
    kind: "appointment",
    effectiveOn: DATE,
    party: { kind: "individual", name: "Upgrade Trustee" },
    role: "trustee",
  });
  assert.ok(nextTrust.entries.some((e) => e.entryNo === 4 && e.role === "trustee"));
}
