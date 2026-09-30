// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-015's trust register at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  eq,
  inArray,
  users,
  entityRegisterParties,
  entityTrustEntries,
  entities,
  sql,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "trust-register-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "trust-register-outsider@example.com",
  displayName: "Omar Outsider",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let corporationId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  for (const fixture of [MEMBER, OUTSIDER]) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({ role: "legal_team_member" })
      .where(eq(users.id, person.id));
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  corporationId = types
    .json()
    .entityTypes.find((row: { slug: string }) => row.slug === "corporation").id;
});

afterAll(async () => harness.stop());

/** Creates as the member; `extra` is patched on afterwards, because the
 * create route takes the identity card only. */
async function newEntity(legalName: string, extra: Record<string, unknown> = {}) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: { legalName, entityTypeId: corporationId, status: "active" },
  });
  expect(response.statusCode, response.body).toBe(201);
  const entity = response.json().entity as { id: string; legalName: string };
  if (Object.keys(extra).length > 0) {
    const patched = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}`,
      cookies: memberCookies,
      payload: extra,
    });
    expect(patched.statusCode, patched.body).toBe(200);
  }
  return entity;
}

const entry = (id: string, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${id}/trust-entries`,
    cookies,
    payload,
  });
const get = (id: string, query = "", cookies = memberCookies) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/entities/${id}/trust-register${query}`,
    cookies,
  });
const patch = (
  id: string,
  entryId: string,
  payload: Record<string, unknown>,
  cookies = memberCookies,
) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/entities/${id}/trust-entries/${entryId}`,
    cookies,
    payload,
  });
const remove = (id: string, entryId: string, cookies = memberCookies) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/entities/${id}/trust-entries/${entryId}`,
    cookies,
  });
const appointment = (party: Record<string, unknown>, extra = {}) => ({
  kind: "appointment",
  effectiveOn: "2024-01-01",
  role: "beneficiary",
  party,
  ...extra,
});

describe("trust register", () => {
  it("reads dated roles and the fund; writes no owner Holdings or percentage edges into a trust", async () => {
    const trust = await newEntity("Family Trust", { registerKind: "trust" });
    const settlor = await newEntity("Settlor Ltd");
    const settled = await entry(trust.id, {
      kind: "settlement",
      effectiveOn: "2024-01-01",
      party: { kind: "entity", entityId: settlor.id },
      amount: 10000,
      currency: "USD",
      reference: "Deed",
    });
    expect(settled.statusCode, settled.body).toBe(201);
    const appointed = await entry(
      trust.id,
      appointment(
        { kind: "class", description: "Children of the Settlor" },
        { interest: "Discretionary" },
      ),
    );
    expect(appointed.statusCode, appointed.body).toBe(201);
    const partyId = appointed.json().entries[1].party.id;
    const paid = await entry(trust.id, {
      kind: "distribution",
      effectiveOn: "2025-01-01",
      party: { kind: "party", partyId },
      amount: 12000,
      currency: "USD",
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json().fund).toEqual([
      { currency: "USD", settled: 10000, distributed: 12000, balance: -2000 },
    ]);
    expect(paid.json().warnings).toEqual([
      { code: "fund-negative", currency: "USD", balance: -2000 },
    ]);
    const ceased = await entry(trust.id, {
      kind: "cessation",
      effectiveOn: "2025-02-01",
      party: { kind: "party", partyId },
      role: "beneficiary",
    });
    expect(ceased.statusCode, ceased.body).toBe(201);
    const past = await get(trust.id, "?asOf=2024-12-31");
    expect(past.json().parties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "beneficiary",
          since: "2024-01-01",
          open: true,
          openToday: false,
          interest: "Discretionary",
        }),
      ]),
    );
    expect(past.json().entries.map((e: { applied: boolean }) => e.applied)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(past.json().fund[0].balance).toBe(10000);
    expect(
      ceased.json().parties.find((p: { role: string }) => p.role === "beneficiary"),
    ).toMatchObject({ until: "2025-02-01", open: false });
    expect((await get(trust.id, "?asOf=2023-12-31")).json().parties).toEqual([]);
    const holdings = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${trust.id}/holdings`,
      cookies: memberCookies,
    });
    expect(holdings.json().owners).toEqual([]);
    const chart = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/chart",
      cookies: memberCookies,
    });
    expect(
      chart.json().edges.filter((e: { ownedEntityId: string }) => e.ownedEntityId === trust.id),
    ).toEqual([]);
    const changeKind = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${trust.id}`,
      cookies: memberCookies,
      payload: { registerKind: "shares" },
    });
    expect(changeKind.statusCode).toBe(409);
  });

  it("replays through future entries before accepting create, update or delete; rolls back parties too", async () => {
    const trust = await newEntity("Replay Trust", { registerKind: "trust" });
    const made = await entry(trust.id, appointment({ kind: "individual", name: "Ada" }));
    expect(made.statusCode, made.body).toBe(201);
    const first = made.json().entries[0];
    const party = { kind: "party", partyId: first.party.id };
    const paid = await entry(trust.id, {
      kind: "distribution",
      effectiveOn: "2090-01-01",
      party,
      property: "House",
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const duplicate = await entry(trust.id, appointment(party));
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().detail).toMatch(/Entry 3.*already holds/);
    const badCessation = await entry(trust.id, {
      kind: "cessation",
      effectiveOn: "2023-01-01",
      role: "beneficiary",
      party,
    });
    expect(badCessation.statusCode).toBe(409);
    const ceaseEarly = await entry(trust.id, {
      kind: "cessation",
      effectiveOn: "2025-01-01",
      role: "beneficiary",
      party,
    });
    expect(ceaseEarly.statusCode).toBe(409);
    expect(ceaseEarly.json().detail).toMatch(/Entry 2.*not a beneficiary/);
    for (const response of [
      await remove(trust.id, first.id),
      await patch(trust.id, first.id, appointment({ kind: "individual", name: "Replacement" })),
    ]) {
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().detail).toMatch(/Entry 2/);
    }
    const parties = await harness.db
      .select()
      .from(entityRegisterParties)
      .where(eq(entityRegisterParties.entityId, trust.id));
    expect(parties).toHaveLength(1);
    expect(parties[0]?.name).toBe("Ada");
    const last = paid.json().entries[1];
    expect((await remove(trust.id, last.id)).statusCode).toBe(204);
    expect((await remove(trust.id, first.id)).statusCode).toBe(204);
    expect(
      await harness.db
        .select()
        .from(entityRegisterParties)
        .where(eq(entityRegisterParties.entityId, trust.id)),
    ).toEqual([]);
    const again = await entry(trust.id, appointment({ kind: "individual", name: "New" }));
    expect(again.json().entries[0].entryNo).toBe(3);
  });

  it("enforces per-kind shapes, class roles, and register-local parties", async () => {
    const trust = await newEntity("Shape Trust", { registerKind: "trust" });
    const other = await newEntity("Other Trust", { registerKind: "trust" });
    const made = await entry(other.id, appointment({ kind: "individual", name: "Other" }));
    for (const payload of [
      appointment({ kind: "party", partyId: made.json().entries[0].party.id }),
      appointment({ kind: "entity", entityId: trust.id }),
      appointment({ kind: "individual", name: "A" }, { role: "other" }),
      appointment({ kind: "individual", name: "A" }, { roleLabel: "Wrong" }),
      appointment({ kind: "individual", name: "A" }, { amount: 10, currency: "USD" }),
      {
        kind: "settlement",
        effectiveOn: "2024-01-01",
        party: { kind: "individual", name: "A" },
        amount: 1,
      },
      {
        kind: "settlement",
        effectiveOn: "2024-01-01",
        party: { kind: "individual", name: "A" },
        amount: 1,
        currency: "USD",
        property: "House",
      },
      {
        kind: "settlement",
        effectiveOn: "2024-01-01",
        party: { kind: "individual", name: "A" },
        amount: 0,
        currency: "USD",
      },
    ])
      expect((await entry(trust.id, payload)).statusCode).toBe(400);
    for (const payload of [
      appointment({ kind: "class", description: "Children" }, { role: "trustee" }),
      {
        kind: "settlement",
        effectiveOn: "2024-01-01",
        party: { kind: "class", description: "Children" },
        property: "House",
      },
      {
        kind: "distribution",
        effectiveOn: "2024-01-01",
        party: { kind: "individual", name: "Stranger" },
        property: "House",
      },
    ]) {
      const result = await entry(trust.id, payload);
      expect(result.statusCode, result.body).toBe(409);
      expect(result.json().detail).toMatch(/Entry 1/);
    }
    expect((await get(trust.id)).json().entries).toEqual([]);
  });

  it("protects every route by Member+, reach, register kind and the frozen Entity", async () => {
    const person = await provisionUser(harness.app.auth, {
      email: "trust-business@example.com",
      displayName: "Business",
      password: "correct-horse-battery",
    });
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
    const businessCookies = await signInCookies(
      harness.app,
      "trust-business@example.com",
      "correct-horse-battery",
    );
    const trust = await newEntity("Private Trust", { registerKind: "trust", isConfidential: true });
    const made = await entry(trust.id, appointment({ kind: "individual", name: "A" }));
    const entryId = made.json().entries[0].id;
    const routes = (id: string, cookies: Record<string, string>) => [
      get(id, "", cookies),
      get(id, "/export?kind=parties", cookies),
      entry(id, appointment({ kind: "individual", name: "B" }), cookies),
      patch(id, entryId, appointment({ kind: "individual", name: "B" }), cookies),
      remove(id, entryId, cookies),
    ];
    for (const [cookies, status] of [
      [businessCookies, 403],
      [outsiderCookies, 404],
      [adminCookies, 404],
    ] as const) {
      for (const result of await Promise.all(routes(trust.id, cookies)))
        expect(result.statusCode, result.body).toBe(status);
    }
    for (const registerKind of ["shares", "partnership", "none"]) {
      const wrong = await newEntity(`Wrong ${registerKind}`, { registerKind });
      for (const result of await Promise.all(routes(wrong.id, memberCookies)))
        expect(result.statusCode, result.body).toBe(409);
    }
    await harness.db
      .update(entities)
      .set({ archivedAt: new Date() })
      .where(eq(entities.id, trust.id));
    const frozen = await Promise.all(routes(trust.id, memberCookies));
    expect(frozen.map((r) => r.statusCode)).toEqual([200, 200, 409, 409, 409]);
    expect((await get(trust.id, "?asOf=bad")).statusCode).toBe(400);
  });

  it("redacts restricted parties, preserves them on edit, exports CSV, and audits both old and new Entity parties", async () => {
    const trust = await newEntity("Audit Trust", { registerKind: "trust" });
    const hidden = await newEntity("Secret Party Ltd", { isConfidential: true });
    const replacement = await newEntity("Replacement Ltd");
    const made = await entry(trust.id, appointment({ kind: "entity", entityId: hidden.id }));
    const first = made.json().entries[0];
    const party = { kind: "party", partyId: first.party.id };
    const seen = await get(trust.id, "", outsiderCookies);
    expect(seen.json().entries[0].party).toEqual({ restricted: true, id: first.party.id });
    expect(seen.body).not.toContain(hidden.id);
    expect(seen.body).not.toContain("Secret Party");
    expect(
      (await patch(trust.id, first.id, appointment(party, { note: "Correction" }), outsiderCookies))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await patch(
          trust.id,
          first.id,
          appointment({ kind: "entity", entityId: replacement.id }),
          outsiderCookies,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await entry(trust.id, appointment({ kind: "entity", entityId: hidden.id }), outsiderCookies))
        .statusCode,
    ).toBe(400);
    for (const kind of ["parties", "entries"]) {
      const csv = await get(trust.id, `/export?kind=${kind}`, outsiderCookies);
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body).toContain("Restricted Entity");
      expect(csv.body).not.toContain("Secret Party");
    }
    const updated = await patch(
      trust.id,
      first.id,
      appointment({ kind: "entity", entityId: replacement.id }),
    );
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().entries[0].entryNo).toBe(1);
    const actions = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          inArray(activityLog.entityId, [trust.id, hidden.id, replacement.id]),
          inArray(activityLog.action, ["entity_trust_entry.created", "entity_trust_entry.updated"]),
        ),
      );
    expect(actions.filter((a) => a.entityId === hidden.id)).toHaveLength(3);
    expect(actions.filter((a) => a.entityId === replacement.id)).toHaveLength(1);
    const feed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=entity&entityId=${trust.id}`,
      cookies: outsiderCookies,
    });
    expect(feed.body).not.toContain("Secret Party");
    expect((await remove(trust.id, first.id)).statusCode).toBe(204);
    const deletions = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          inArray(activityLog.entityId, [trust.id, replacement.id]),
          eq(activityLog.action, "entity_trust_entry.deleted"),
        ),
      );
    expect(deletions).toHaveLength(2);
    const formula = await entry(
      trust.id,
      appointment({ kind: "individual", name: '=HYPERLINK("x")' }, { note: "@SUM(A1)" }),
    );
    expect(formula.statusCode).toBe(201);
    const csv = await get(trust.id, "/export?kind=entries");
    expect(csv.body.startsWith("﻿")).toBe(true);
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.body).toContain(`"'@SUM(A1)"`);
    // Header plus one entry, each ending in CRLF and nothing between them.
    expect(csv.body.split("\r\n")).toHaveLength(3);
    expect(csv.body.endsWith("\r\n")).toBe(true);
    expect(
      (await get(trust.id, "/export?kind=parties&asOf=2023-01-01")).body.split("\r\n"),
    ).toEqual([expect.stringContaining('"Party"'), ""]);
  });

  it("serializes concurrent appointments and preserves the database checks", async () => {
    const trust = await newEntity("Concurrent Trust", { registerKind: "trust" });
    const person = await newEntity("Concurrent Party");
    const results = await Promise.all([
      entry(trust.id, appointment({ kind: "entity", entityId: person.id })),
      entry(trust.id, appointment({ kind: "entity", entityId: person.id })),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const saved = results.find((r) => r.statusCode === 201)!.json().entries[0];
    await expect(
      harness.db
        .update(entityTrustEntries)
        .set({ amount: 1 })
        .where(eq(entityTrustEntries.id, saved.id)),
    ).rejects.toThrow();
    await expect(
      harness.db.execute(
        sql`update entity_trust_entries set role = 'other', role_label = null where id = ${saved.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      harness.db.execute(
        sql`update entity_trust_entries set kind = 'invalid' where id = ${saved.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      harness.db.execute(
        sql`update entity_register_parties set kind = 'invalid' where id = ${saved.party.id}`,
      ),
    ).rejects.toThrow();
  });
  it("keeps multiple roles, labelled other roles, and repeated settlements independent", async () => {
    const trust = await newEntity("Roles Trust", { registerKind: "trust" });
    const first = await entry(trust.id, {
      kind: "settlement",
      effectiveOn: "2024-01-01",
      party: { kind: "individual", name: "Sam" },
      property: "House",
    });
    expect(first.statusCode, first.body).toBe(201);
    const party = { kind: "party", partyId: first.json().entries[0].party.id };
    const settled = await entry(trust.id, {
      kind: "settlement",
      effectiveOn: "2024-02-01",
      party,
      amount: 100,
      currency: "EUR",
    });
    expect(settled.statusCode, settled.body).toBe(201);
    expect(settled.json().parties).toHaveLength(1);
    expect(settled.json().parties[0]).toMatchObject({ role: "settlor", since: "2024-01-01" });
    for (const role of ["trustee", "protector", "enforcer", "beneficiary", "other"]) {
      const made = await entry(
        trust.id,
        appointment(party, { role, ...(role === "other" ? { roleLabel: "Adviser" } : {}) }),
      );
      expect(made.statusCode, made.body).toBe(201);
    }
    const guardian = await entry(
      trust.id,
      appointment(party, { role: "other", roleLabel: "Guardian" }),
    );
    expect(guardian.statusCode, guardian.body).toBe(201);
    expect(guardian.json().parties.map((p: { role: string }) => p.role)).toEqual([
      "settlor",
      "trustee",
      "protector",
      "enforcer",
      "beneficiary",
      "other",
      "other",
    ]);
    const cease = await entry(trust.id, {
      kind: "cessation",
      effectiveOn: "2024-03-01",
      role: "other",
      roleLabel: "Adviser",
      party,
    });
    expect(cease.statusCode, cease.body).toBe(201);
    const rows = cease.json().parties as {
      role: string;
      roleLabel: string | null;
      open: boolean;
    }[];
    expect(rows.find((p) => p.roleLabel === "Adviser")?.open).toBe(false);
    expect(rows.find((p) => p.roleLabel === "Guardian")?.open).toBe(true);
    const money = await entry(trust.id, {
      kind: "distribution",
      effectiveOn: "2024-04-01",
      party,
      amount: 5,
      currency: "USD",
    });
    expect(money.statusCode, money.body).toBe(201);
    expect(money.json().fund).toEqual([
      { currency: "EUR", settled: 100, distributed: 0, balance: 100 },
      { currency: "USD", settled: 0, distributed: 5, balance: -5 },
    ]);
    const duplicate = await entry(
      trust.id,
      appointment(party, { role: "settlor", effectiveOn: "2024-02-01" }),
    );
    expect(duplicate.statusCode).toBe(409);
  });

  it("refuses unsafe aggregate money totals and keeps a party after deleting only one of its entries", async () => {
    const trust = await newEntity("Exact Fund Trust", { registerKind: "trust" });
    const first = await entry(trust.id, {
      kind: "settlement",
      effectiveOn: "2024-01-01",
      party: { kind: "individual", name: "Settlor" },
      amount: Number.MAX_SAFE_INTEGER,
      currency: "USD",
    });
    expect(first.statusCode, first.body).toBe(201);
    const party = { kind: "party", partyId: first.json().entries[0].party.id };
    const overflow = await entry(trust.id, {
      kind: "settlement",
      effectiveOn: "2024-02-01",
      party,
      amount: 1,
      currency: "USD",
    });
    expect(overflow.statusCode, overflow.body).toBe(409);
    expect(overflow.json().detail).toMatch(/Entry 2.*range/);
    const another = await entry(trust.id, appointment(party));
    expect(another.statusCode).toBe(201);
    expect((await remove(trust.id, first.json().entries[0].id)).statusCode).toBe(204);
    expect(
      await harness.db
        .select()
        .from(entityRegisterParties)
        .where(eq(entityRegisterParties.entityId, trust.id)),
    ).toHaveLength(1);
  });
  it("names the trust in a party's Activity only while the viewer reaches that trust", async () => {
    const trust = await newEntity("Confidential Trust Name", {
      registerKind: "trust",
      isConfidential: true,
    });
    const party = await newEntity("Public Trustee");
    const made = await entry(
      trust.id,
      appointment({ kind: "entity", entityId: party.id }, { role: "trustee" }),
    );
    expect(made.statusCode, made.body).toBe(201);
    const feed = async (cookies: Record<string, string>) =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/activity?entityType=entity&entityId=${party.id}`,
        cookies,
      });
    const reached = await feed(memberCookies);
    expect(reached.body).toContain("Confidential Trust Name");
    const restricted = await feed(outsiderCookies);
    expect(restricted.statusCode).toBe(200);
    expect(restricted.body).not.toContain("Confidential Trust Name");
    expect(restricted.body).not.toContain(trust.id);
    expect(restricted.json().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "entity_trust_entry.created" })]),
    );
  });
});
