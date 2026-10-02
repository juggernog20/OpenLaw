// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-015's partnership register at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  eq,
  inArray,
  users,
  entityRegisterParties,
  entityPartnershipEntries,
  individualHoldings,
  entityHoldings,
  ADVISORY_LOCK,
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
  email: "partnership-register-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "partnership-register-outsider@example.com",
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
    url: `/api/v1/entities/${id}/partnership-entries`,
    cookies,
    payload,
  });
const get = (id: string, query = "", cookies = memberCookies) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/entities/${id}/partnership-register${query}`,
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
    url: `/api/v1/entities/${id}/partnership-entries/${entryId}`,
    cookies,
    payload,
  });
const remove = (id: string, entryId: string, cookies = memberCookies) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/entities/${id}/partnership-entries/${entryId}`,
    cookies,
  });
const admission = (party: Record<string, unknown>, extra = {}) => ({
  kind: "admission",
  effectiveOn: "2024-01-01",
  capacity: "general",
  party,
  ...extra,
});

describe("partnership register", () => {
  it("protects every route by Member+, reach, register kind and the frozen Entity", async () => {
    const person = await provisionUser(harness.app.auth, {
      email: "partnership-business@example.com",
      displayName: "Business",
      password: "correct-horse-battery",
    });
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
    const businessCookies = await signInCookies(
      harness.app,
      "partnership-business@example.com",
      "correct-horse-battery",
    );
    const partnership = await newEntity("Private Partnership", {
      registerKind: "partnership",
      isConfidential: true,
    });
    const made = await entry(partnership.id, admission({ kind: "individual", name: "A" }));
    const entryId = made.json().entries[0].id;
    const routes = (id: string, cookies: Record<string, string>) => [
      get(id, "", cookies),
      get(id, "/export?kind=partners", cookies),
      entry(id, admission({ kind: "individual", name: "B" }), cookies),
      patch(id, entryId, admission({ kind: "individual", name: "B" }), cookies),
      remove(id, entryId, cookies),
    ];
    for (const [cookies, status] of [
      [businessCookies, 403],
      [outsiderCookies, 404],
      [adminCookies, 404],
    ] as const) {
      for (const result of await Promise.all(routes(partnership.id, cookies)))
        expect(result.statusCode, result.body).toBe(status);
    }
    for (const registerKind of ["shares", "trust", "none"]) {
      const wrong = await newEntity(`Wrong ${registerKind}`, { registerKind });
      for (const result of await Promise.all(routes(wrong.id, memberCookies)))
        expect(result.statusCode, result.body).toBe(409);
    }
    await harness.db
      .update(entities)
      .set({ archivedAt: new Date() })
      .where(eq(entities.id, partnership.id));
    const frozen = await Promise.all(routes(partnership.id, memberCookies));
    expect(frozen.map((r) => r.statusCode)).toEqual([200, 200, 409, 409, 409]);
    expect((await get(partnership.id, "?asOf=bad")).statusCode).toBe(400);
  });

  it("redacts restricted parties, preserves them on edit, exports CSV, and audits both old and new Entity parties", async () => {
    const partnership = await newEntity("Audit Partnership", { registerKind: "partnership" });
    const hidden = await newEntity("Secret Party Ltd", { isConfidential: true });
    const replacement = await newEntity("Replacement Ltd");
    const made = await entry(partnership.id, admission({ kind: "entity", entityId: hidden.id }));
    const first = made.json().entries[0];
    const party = { kind: "party", partyId: first.party.id };
    const seen = await get(partnership.id, "", outsiderCookies);
    expect(seen.json().entries[0].party).toEqual({ restricted: true, id: first.party.id });
    expect(seen.body).not.toContain(hidden.id);
    expect(seen.body).not.toContain("Secret Party");
    expect(
      (
        await patch(
          partnership.id,
          first.id,
          admission(party, { note: "Correction" }),
          outsiderCookies,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await patch(
          partnership.id,
          first.id,
          admission({ kind: "entity", entityId: replacement.id }),
          outsiderCookies,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await entry(
          partnership.id,
          admission({ kind: "entity", entityId: hidden.id }),
          outsiderCookies,
        )
      ).statusCode,
    ).toBe(400);
    for (const kind of ["partners", "entries"]) {
      const csv = await get(partnership.id, `/export?kind=${kind}`, outsiderCookies);
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body).toContain("Restricted Entity");
      expect(csv.body).not.toContain("Secret Party");
    }
    const updated = await patch(
      partnership.id,
      first.id,
      admission({ kind: "entity", entityId: replacement.id }),
    );
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().entries[0].entryNo).toBe(1);
    const actions = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          inArray(activityLog.entityId, [partnership.id, hidden.id, replacement.id]),
          inArray(activityLog.action, [
            "entity_partnership_entry.created",
            "entity_partnership_entry.updated",
          ]),
        ),
      );
    expect(actions.filter((a) => a.entityId === hidden.id)).toHaveLength(3);
    expect(actions.filter((a) => a.entityId === replacement.id)).toHaveLength(1);
    const feed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=entity&entityId=${partnership.id}`,
      cookies: outsiderCookies,
    });
    expect(feed.body).not.toContain("Secret Party");
    expect((await remove(partnership.id, first.id)).statusCode).toBe(204);
    const deletions = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          inArray(activityLog.entityId, [partnership.id, replacement.id]),
          eq(activityLog.action, "entity_partnership_entry.deleted"),
        ),
      );
    expect(deletions).toHaveLength(2);
    const formula = await entry(
      partnership.id,
      admission({ kind: "individual", name: '=HYPERLINK("x")' }, { note: "@SUM(A1)" }),
    );
    expect(formula.statusCode).toBe(201);
    const csv = await get(partnership.id, "/export?kind=entries");
    expect(csv.body.startsWith("﻿")).toBe(true);
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.body).toContain(`"'@SUM(A1)"`);
    // Header plus one entry, each ending in CRLF and nothing between them.
    expect(csv.body.split("\r\n")).toHaveLength(3);
    expect(csv.body.endsWith("\r\n")).toBe(true);
    expect(
      (await get(partnership.id, "/export?kind=partners&asOf=2023-01-01")).body.split("\r\n"),
    ).toEqual([expect.stringContaining('"Partner"'), ""]);
  });

  it("names the partnership in a party's Activity only while the viewer reaches that partnership", async () => {
    const partnership = await newEntity("Confidential Partnership Name", {
      registerKind: "partnership",
      isConfidential: true,
    });
    const party = await newEntity("Public Partnershipee");
    const made = await entry(
      partnership.id,
      admission({ kind: "entity", entityId: party.id }, { capacity: "limited" }),
    );
    expect(made.statusCode, made.body).toBe(201);
    const feed = async (cookies: Record<string, string>) =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/activity?entityType=entity&entityId=${party.id}`,
        cookies,
      });
    const reached = await feed(memberCookies);
    expect(reached.body).toContain("Confidential Partnership Name");
    const restricted = await feed(outsiderCookies);
    expect(restricted.statusCode).toBe(200);
    expect(restricted.body).not.toContain("Confidential Partnership Name");
    expect(restricted.body).not.toContain(partnership.id);
    expect(restricted.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "entity_partnership_entry.created" }),
      ]),
    );
  });
});

const setBasis = (id: string, partnershipBasis: string, cookies = memberCookies) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/entities/${id}`,
    cookies,
    payload: { partnershipBasis },
  });
const money = (partyId: string, kind: string, amount: number, extra = {}) => ({
  kind,
  effectiveOn: "2024-02-01",
  party: { kind: "party", partyId },
  amount,
  currency: "USD",
  ...extra,
});
const transfer = (fromPartyId: string, toParty: Record<string, unknown>, extra = {}) => ({
  kind: "transfer",
  effectiveOn: "2024-03-01",
  fromParty: { kind: "party", partyId: fromPartyId },
  toParty,
  transfereeStatus: "assignee",
  units: 1,
  ...extra,
});
const owners = async (id: string) =>
  (
    await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${id}/holdings`,
      cookies: memberCookies,
    })
  ).json().owners as { ownershipPercent: number; owner: { name?: string } }[];

it("projects all four bases, including assignees, and matches individuals by party, not name", async () => {
  const partnership = await newEntity("Four bases", { registerKind: "partnership" });
  const first = await entry(
    partnership.id,
    admission({ kind: "individual", name: "Same Name" }, { units: 10, statedPercent: 100 }),
  );
  expect(first.statusCode, first.body).toBe(201);
  const partyId = first.json().entries[0].party.id;
  expect((await entry(partnership.id, money(partyId, "commitment", 2000))).statusCode).toBe(201);
  expect(
    (
      await entry(
        partnership.id,
        money(partyId, "contribution", 1000, { formOfContribution: "Cash" }),
      )
    ).statusCode,
  ).toBe(201);
  expect((await entry(partnership.id, money(partyId, "return", 200))).statusCode).toBe(201);
  const moved = await entry(
    partnership.id,
    transfer(
      partyId,
      { kind: "individual", name: "New Partner" },
      {
        units: 2,
        statedPercent: 30,
        amount: 400,
        currency: "USD",
        consideration: "Purchase price 500 USD",
      },
    ),
  );
  expect(moved.statusCode, moved.body).toBe(201);
  const transfereeId = moved.json().entries.at(-1).toParty.id;
  for (const [basis, percents] of [
    ["capital", [50, 50]],
    ["units", [80, 20]],
    ["stated", [70, 30]],
    ["equal", [100, 0]],
  ] as const) {
    const changed = await setBasis(partnership.id, basis);
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().entity.partnershipBasis).toBe(basis);
    const register = await get(partnership.id);
    expect(register.json().partners.map((p: { percent: number }) => p.percent)).toEqual(percents);
    const rows = await harness.db
      .select()
      .from(individualHoldings)
      .where(eq(individualHoldings.ownedEntityId, partnership.id));
    expect(rows.map((r) => Number(r.ownershipPercent)).sort()).toEqual(
      [...percents].filter((n) => n > 0).sort(),
    );
    expect(rows.every((r) => r.shareholderId === null)).toBe(true);
    expect(rows.map((r) => r.registerPartyId).sort()).toEqual(
      (basis === "equal" ? [partyId] : [partyId, transfereeId]).sort(),
    );
  }
  const past = await get(partnership.id, "?asOf=2024-02-28");
  expect(past.json().partners).toHaveLength(1);
  expect(past.json().totals).toMatchObject({
    committed: 2000,
    contributed: 1000,
    returned: 200,
    unreturned: 800,
    units: 10,
  });
  expect(past.json().partnersToday).toHaveLength(2);
  expect(past.json().entries.at(-1).applied).toBe(false);
  expect((await get(partnership.id, "/export?kind=entries")).body).toContain(
    "Purchase price 500 USD",
  );
  const audit = await harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, partnership.id),
        eq(activityLog.action, "entity_holding.deleted"),
      ),
    );
  expect(audit).toHaveLength(1);
  const basisAudit = await harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, partnership.id), eq(activityLog.action, "entity.updated")));
  expect(basisAudit.some((a) => JSON.stringify(a.payload).includes('"partnershipBasis"'))).toBe(
    true,
  );
});

it("deletes a stale projected row before pruning its party and never reuses entry numbers", async () => {
  const p = await newEntity("Stale projection", {
    registerKind: "partnership",
    partnershipBasis: "equal",
  });
  const made = await entry(p.id, admission({ kind: "individual", name: "Former" }));
  const first = made.json().entries[0];
  expect(await owners(p.id)).toHaveLength(1);
  expect((await remove(p.id, first.id)).statusCode).toBe(204);
  expect(await owners(p.id)).toEqual([]);
  expect(
    await harness.db
      .select()
      .from(entityRegisterParties)
      .where(eq(entityRegisterParties.entityId, p.id)),
  ).toEqual([]);
  const logs = await harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, p.id), eq(activityLog.action, "entity_holding.deleted")));
  expect(logs).toHaveLength(1);
  const again = await entry(p.id, admission({ kind: "individual", name: "New" }));
  expect(again.json().entries[0].entryNo).toBe(2);
});

it("replays create, update and delete through future entries and rolls back rejected parties", async () => {
  const p = await newEntity("Future replay", { registerKind: "partnership" });
  const made = await entry(p.id, admission({ kind: "individual", name: "Ada" }, { units: 10 }));
  const first = made.json().entries[0],
    partyId = first.party.id;
  const moved = await entry(
    p.id,
    transfer(
      partyId,
      { kind: "individual", name: "Future" },
      { units: 10, effectiveOn: "2090-01-01" },
    ),
  );
  expect(moved.statusCode, moved.body).toBe(201);
  expect((await setBasis(p.id, "units")).statusCode).toBe(200);
  expect((await owners(p.id)).map((r) => r.ownershipPercent)).toEqual([100]);
  for (const response of [
    await remove(p.id, first.id),
    await patch(p.id, first.id, admission({ kind: "party", partyId }, { units: 9 })),
    await entry(p.id, transfer(partyId, { kind: "individual", name: "Rollback" })),
  ]) {
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().detail).toMatch(/Entry 2/);
  }
  expect(
    await harness.db
      .select()
      .from(entityRegisterParties)
      .where(eq(entityRegisterParties.entityId, p.id)),
  ).toHaveLength(2);
  const locked = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/entities/${p.id}`,
    cookies: memberCookies,
    payload: { registerKind: "trust" },
  });
  expect(locked.statusCode).toBe(409);
  expect((await get(p.id)).json().partners[0].units).toBe(10);
});

it("answers 409 for every balance, standing and currency violation", async () => {
  const p = await newEntity("Refusals", { registerKind: "partnership" });
  const made = await entry(
    p.id,
    admission({ kind: "individual", name: "Ada" }, { units: 1, statedPercent: 10 }),
  );
  const partyId = made.json().entries[0].party.id,
    party = { kind: "party", partyId };
  expect((await entry(p.id, money(partyId, "commitment", 10))).statusCode).toBe(201);
  const cases = [
    admission(party),
    money(partyId, "return", 1),
    money(partyId, "contribution", 1, { currency: "EUR" }),
    { kind: "withdrawal", effectiveOn: "2025-01-01", party },
    { kind: "capacity_change", effectiveOn: "2023-01-01", party, capacity: "limited" },
    { kind: "withdrawal", effectiveOn: "2023-01-01", party },
    transfer(partyId, { kind: "individual", name: "New" }, { units: 2 }),
    transfer(partyId, { kind: "individual", name: "New" }, { units: null, statedPercent: 11 }),
    transfer(
      partyId,
      { kind: "individual", name: "New" },
      { units: null, amount: 1, currency: "USD" },
    ),
    transfer(partyId, { kind: "individual", name: "New" }, { effectiveOn: "2023-01-01" }),
    transfer(partyId, { kind: "individual", name: "New" }, { transfereeStatus: null }),
    transfer(partyId, party),
  ];
  for (const payload of cases) {
    const r = await entry(p.id, payload);
    expect(r.statusCode, r.body).toBe(409);
  }
  expect(
    (
      await entry(p.id, {
        ...money(partyId, "contribution", 1),
        party: { kind: "individual", name: "Stranger" },
      })
    ).statusCode,
  ).toBe(409);
  expect((await get(p.id)).json().entries).toHaveLength(2);
});

it("records capacity changes, admitted transfers, withdrawal, readmission and the stated warning", async () => {
  const p = await newEntity("Statuses", {
    registerKind: "partnership",
    partnershipBasis: "stated",
  });
  const made = await entry(
    p.id,
    admission({ kind: "individual", name: "Ada" }, { statedPercent: 90 }),
  );
  const id = made.json().entries[0].party.id;
  expect(made.json().warnings).toEqual([{ code: "stated-total", total: 90 }]);
  const moved = await entry(
    p.id,
    transfer(
      id,
      { kind: "individual", name: "Bo" },
      { units: null, statedPercent: 90, transfereeStatus: "admitted", capacity: "limited" },
    ),
  );
  expect(moved.statusCode, moved.body).toBe(201);
  const bo = moved.json().entries.at(-1).toParty.id;
  const change = await entry(p.id, {
    kind: "capacity_change",
    effectiveOn: "2024-04-01",
    party: { kind: "party", partyId: bo },
    capacity: "general",
  });
  expect(change.statusCode).toBe(201);
  const cease = await entry(p.id, {
    kind: "withdrawal",
    effectiveOn: "2024-05-01",
    party: { kind: "party", partyId: id },
  });
  expect(cease.statusCode, cease.body).toBe(201);
  expect(cease.json().partners[0].status).toBe("ceased");
  const back = await entry(
    p.id,
    admission({ kind: "party", partyId: id }, { effectiveOn: "2024-06-01", statedPercent: 10 }),
  );
  expect(back.statusCode, back.body).toBe(201);
  expect(back.json().warnings).toEqual([]);
  expect(back.json().partners[0].since).toBe("2024-06-01");
  expect((await get(p.id, "?asOf=2024-02-01")).json().warnings).toEqual([]);
});

it("checks Entity cycles on admissions and transfers, including zero and future ownership", async () => {
  const a = await newEntity("Cycle A", { registerKind: "partnership", partnershipBasis: "equal" });
  const b = await newEntity("Cycle B", { registerKind: "partnership", partnershipBasis: "equal" });
  expect((await entry(a.id, admission({ kind: "entity", entityId: b.id }))).statusCode).toBe(201);
  for (const extra of [{}, { effectiveOn: "2090-01-01" }]) {
    const r = await entry(b.id, admission({ kind: "entity", entityId: a.id }, extra));
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().detail).toContain("ownership loop");
  }
  const own = await entry(b.id, admission({ kind: "individual", name: "Owner" }, { units: 10 }));
  const r = await entry(
    b.id,
    transfer(own.json().entries[0].party.id, { kind: "entity", entityId: a.id }),
  );
  expect(r.statusCode, r.body).toBe(409);
  expect((await entry(b.id, admission({ kind: "entity", entityId: b.id }))).statusCode).toBe(409);
  expect((await get(b.id)).json().entries).toHaveLength(1);
});

it("audits the partnership and both Entity parties to a transfer", async () => {
  const p = await newEntity("Transfer audit", {
    registerKind: "partnership",
    partnershipBasis: "units",
  });
  const a = await newEntity("Transfer from"),
    b = await newEntity("Transfer to");
  const first = await entry(p.id, admission({ kind: "entity", entityId: a.id }, { units: 10 }));
  const moved = await entry(
    p.id,
    transfer(first.json().entries[0].party.id, { kind: "entity", entityId: b.id }, { units: 10 }),
  );
  expect(moved.statusCode, moved.body).toBe(201);
  const logs = await harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        inArray(activityLog.entityId, [p.id, a.id, b.id]),
        eq(activityLog.action, "entity_partnership_entry.created"),
      ),
    );
  expect(
    logs
      .filter((l) => (l.payload as { kind: string }).kind === "transfer")
      .map((l) => l.entityId)
      .sort(),
  ).toEqual([p.id, a.id, b.id].sort());
  expect(
    await harness.db.select().from(entityHoldings).where(eq(entityHoldings.ownedEntityId, p.id)),
  ).toMatchObject([{ ownerEntityId: b.id, ownershipPercent: "100.00" }]);
  expect((await remove(p.id, moved.json().entries.at(-1).id)).statusCode).toBe(204);
  expect(
    await harness.db.select().from(entityHoldings).where(eq(entityHoldings.ownedEntityId, p.id)),
  ).toMatchObject([{ ownerEntityId: a.id, ownershipPercent: "100.00" }]);
});

it("uses the Holdings advisory lock for entry writes and basis changes", async () => {
  const p = await newEntity("Lock path", { registerKind: "partnership" });
  for (const write of [
    () => entry(p.id, admission({ kind: "individual", name: "Lock" })),
    () => setBasis(p.id, "equal"),
  ]) {
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lock = harness.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
      acquired();
      await wait;
    });
    await held;
    const pending = write().then((r) => r);
    try {
      await expect
        .poll(async () => {
          const result = await harness.db.execute(
            sql`select count(*)::int as count from pg_locks where locktype='advisory' and not granted and objid=${ADVISORY_LOCK.entityHoldings}`,
          );
          return Number(result.rows[0]?.count);
        })
        .toBeGreaterThan(0);
    } finally {
      release();
      await lock;
    }
    const result = await pending;
    expect([200, 201]).toContain(result.statusCode);
  }
  expect((await owners(p.id)).map((r) => r.ownershipPercent)).toEqual([100]);
});

it("validates wire shapes, local party FKs, database checks and the individual identity XOR", async () => {
  const p = await newEntity("Shapes", { registerKind: "partnership", partnershipBasis: "equal" });
  const made = await entry(p.id, admission({ kind: "individual", name: "Ada" }));
  const first = made.json().entries[0];
  for (const extra of [
    { capacity: null },
    { amount: 1, currency: "USD" },
    { statedPercent: 0.001 },
    { units: -1 },
    { formOfContribution: "Cash" },
    { consideration: "No" },
    { transfereeStatus: "assignee" },
  ]) {
    const r = await entry(p.id, admission({ kind: "individual", name: "Bad" }, extra));
    expect(r.statusCode, r.body).toBe(400);
  }
  expect((await entry(p.id, admission({ kind: "class", description: "Class" }))).statusCode).toBe(
    400,
  );
  expect(
    (await entry(p.id, money(first.party.id, "contribution", 1, { currency: null }))).statusCode,
  ).toBe(400);
  const other = await newEntity("Other local", { registerKind: "partnership" });
  expect(
    (await entry(other.id, admission({ kind: "party", partyId: first.party.id }))).statusCode,
  ).toBe(400);
  for (const patch of [
    { kind: "bad" },
    { amount: 1 },
    { capacity: null },
    { transfereeStatus: "assignee" },
  ]) {
    await expect(
      harness.db
        .update(entityPartnershipEntries)
        .set(patch as Partial<typeof entityPartnershipEntries.$inferInsert>)
        .where(eq(entityPartnershipEntries.id, first.id)),
    ).rejects.toThrow();
  }
  await expect(
    harness.db
      .update(individualHoldings)
      .set({ registerPartyId: null })
      .where(eq(individualHoldings.ownedEntityId, p.id)),
  ).rejects.toThrow();
  await expect(
    harness.db
      .update(entityPartnershipEntries)
      .set({ entityId: other.id })
      .where(eq(entityPartnershipEntries.id, first.id)),
  ).rejects.toThrow();
  expect((await setBasis(other.id, "bogus")).statusCode).toBe(400);
  const shares = await newEntity("No basis");
  expect((await setBasis(shares.id, "equal")).statusCode).toBe(409);
  await harness.db.update(entities).set({ archivedAt: new Date() }).where(eq(entities.id, p.id));
  expect((await setBasis(p.id, "units")).statusCode).toBe(409);
});

it("rolls a basis change back when it would create an ownership cycle", async () => {
  const a = await newEntity("Basis cycle A", { registerKind: "partnership" });
  const b = await newEntity("Basis cycle B", {
    registerKind: "partnership",
    partnershipBasis: "equal",
  });
  expect((await entry(a.id, admission({ kind: "entity", entityId: b.id }))).statusCode).toBe(201);
  expect((await entry(b.id, admission({ kind: "entity", entityId: a.id }))).statusCode).toBe(201);
  const changed = await setBasis(a.id, "equal");
  expect(changed.statusCode, changed.body).toBe(409);
  expect((await get(a.id)).json().basis).toBe("capital");
  expect(await owners(a.id)).toEqual([]);
});

it("serializes competing admissions and retains small owners whose percent rounds to zero", async () => {
  const p = await newEntity("Concurrent admissions", {
    registerKind: "partnership",
    partnershipBasis: "units",
  });
  const owner = await newEntity("Concurrent Entity partner");
  const replies = await Promise.all([
    entry(p.id, admission({ kind: "entity", entityId: owner.id }, { units: 1000000 })),
    entry(p.id, admission({ kind: "entity", entityId: owner.id }, { units: 1000000 })),
  ]);
  expect(replies.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  const small = await entry(p.id, admission({ kind: "individual", name: "Small" }, { units: 1 }));
  expect(small.statusCode, small.body).toBe(201);
  expect(
    await harness.db
      .select()
      .from(individualHoldings)
      .where(eq(individualHoldings.ownedEntityId, p.id)),
  ).toMatchObject([{ name: "Small", ownershipPercent: "0.00" }]);
});

it("allows a basis change after an earlier owner ceased and the ownership direction changed", async () => {
  const a = await newEntity("Former owner A", {
    registerKind: "partnership",
    partnershipBasis: "equal",
  });
  const b = await newEntity("Former owner B", {
    registerKind: "partnership",
    partnershipBasis: "equal",
  });
  const first = await entry(a.id, admission({ kind: "entity", entityId: b.id }));
  expect(first.statusCode).toBe(201);
  expect(
    (
      await entry(a.id, {
        kind: "withdrawal",
        effectiveOn: "2024-02-01",
        party: { kind: "party", partyId: first.json().entries[0].party.id },
      })
    ).statusCode,
  ).toBe(201);
  expect((await entry(b.id, admission({ kind: "entity", entityId: a.id }))).statusCode).toBe(201);
  const changed = await setBasis(a.id, "units");
  expect(changed.statusCode, changed.body).toBe(200);
});

it("does not audit a percentage change when only the note changed", async () => {
  const p = await newEntity("Canonical percent", { registerKind: "partnership" });
  const made = await entry(
    p.id,
    admission({ kind: "individual", name: "Ada" }, { statedPercent: 10 }),
  );
  const first = made.json().entries[0];
  const changed = await patch(
    p.id,
    first.id,
    admission(
      { kind: "party", partyId: first.party.id },
      { statedPercent: 10, note: "Correction" },
    ),
  );
  expect(changed.statusCode, changed.body).toBe(200);
  const logs = await harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, p.id),
        eq(activityLog.action, "entity_partnership_entry.updated"),
      ),
    );
  expect(logs).toHaveLength(1);
  expect(logs[0]!.payload).toMatchObject({ changed: { note: { from: null, to: "Correction" } } });
  expect((logs[0]!.payload as { changed: Record<string, unknown> }).changed).not.toHaveProperty(
    "statedPercent",
  );
});

it("links users, reuses their register identity and blocks equivalent duplicate names", async () => {
  const [person] = await harness.db.select().from(users).where(eq(users.email, MEMBER.email));
  if (!person) throw new Error("The test member is missing.");
  const record = await newEntity("Linked partnership individual", { registerKind: "partnership" });
  const first = await entry(record.id, admission({ kind: "user", userId: person.id }));
  expect(first.statusCode, first.body).toBe(201);
  const individual = first.json().entries[0].party;
  expect(individual).toMatchObject({
    kind: "individual",
    name: person.displayName,
    userId: person.id,
  });
  const second = await entry(record.id, {
    kind: "commitment",
    effectiveOn: "2024-01-02",
    party: { kind: "user", userId: person.id },
    amount: 100,
    currency: "USD",
  });
  expect(second.statusCode, second.body).toBe(201);
  expect(second.json().entries[1].party.id).toBe(individual.id);
  const duplicate = await entry(
    record.id,
    admission({
      kind: "individual",
      name: "  " + person.displayName.toUpperCase().replace(/ /g, "   ") + " ",
    }),
  );
  expect(duplicate.statusCode, duplicate.body).toBe(409);
  expect(duplicate.json().detail).toContain("already in the register");
  const missing = await entry(record.id, admission({ kind: "user", userId: "missing-user" }));
  expect(missing.statusCode, missing.body).toBe(400);
});
