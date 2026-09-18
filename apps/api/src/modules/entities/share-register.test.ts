// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-011's share register at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "share-register-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "share-register-outsider@example.com",
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

async function newClass(entityId: string, body: Record<string, unknown>) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${entityId}/share-classes`,
    cookies: memberCookies,
    payload: body,
  });
  expect(response.statusCode, response.body).toBe(201);
  const classes = response.json().classes as { id: string; name: string }[];
  return classes.find((row) => row.name === body.name)!;
}

function entry(entityId: string, body: Record<string, unknown>, cookies = memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${entityId}/share-entries`,
    cookies,
    payload: body,
  });
}

function register(entityId: string, asOf?: string, cookies = memberCookies) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/entities/${entityId}/share-register${asOf ? `?asOf=${asOf}` : ""}`,
    cookies,
  });
}

type Row = {
  holder: { restricted: boolean; name?: string; kind?: string; id: string };
  shareClassId: string;
  balance: number;
  percentOfClass: number;
  percentOfVotes: number;
  certificates: string[];
  memberSince: string | null;
  balanceToday: number;
};

const holderNamed = (rows: Row[], name: string, classId?: string) =>
  rows.find(
    (row) =>
      !row.holder.restricted &&
      row.holder.name === name &&
      (classId ? row.shareClassId === classId : true),
  );

describe("the share register", () => {
  it("derives the Register of members from entries and reads it as of a date", async () => {
    const issuer = await newEntity("Wentworth Capital Partners Ltd", { sharesIssued: 750_000 });
    const parent = await newEntity("Wentworth Family Office Holdings Ltd", {
      jurisdiction: "Jersey",
    });
    const ordinary = await newClass(issuer.id, {
      name: "Ordinary",
      authorized: 1_000_000,
      parValue: 100,
      parValueCurrency: "usd",
      votesPerShare: 1,
      rights: "One vote per share",
    });
    const preference = await newClass(issuer.id, {
      name: "Class A Preference",
      authorized: 250_000,
      votesPerShare: 1,
    });

    const first = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2019-03-12",
      shareClassId: ordinary.id,
      quantity: 550_000,
      to: { kind: "entity", entityId: parent.id },
      pricePerShare: 100,
      priceCurrency: "USD",
      consideration: "$550,000 cash",
      resolutionRef: "BR-2019-01",
      certificatesIssued: [
        { number: "001", holder: "to", quantity: 550_000, distinctiveNumbers: "1–550,000" },
      ],
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().entries[0].entryNo).toBe(1);

    const second = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2019-03-12",
      shareClassId: ordinary.id,
      quantity: 200_000,
      to: { kind: "individual", name: "Blair Wentworth" },
      certificatesIssued: [{ number: "002", holder: "to", quantity: 200_000 }],
    });
    expect(second.statusCode, second.body).toBe(201);
    const blairHolderId = (second.json().holders as Row[]).find(
      (row) => row.holder.name === "Blair Wentworth",
    )!.holder.id;

    const buyback = await entry(issuer.id, {
      kind: "buyback",
      effectiveOn: "2020-12-10",
      shareClassId: ordinary.id,
      quantity: 50_000,
      from: { kind: "entity", entityId: parent.id },
      certificatesCancelled: ["001"],
      certificatesIssued: [{ number: "003", holder: "from", quantity: 500_000 }],
    });
    expect(buyback.statusCode, buyback.body).toBe(201);

    const transfer = await entry(issuer.id, {
      kind: "transfer",
      effectiveOn: "2023-02-01",
      shareClassId: ordinary.id,
      quantity: 40_000,
      from: { kind: "holder", holderId: blairHolderId },
      to: { kind: "individual", name: "Harbour Nominees Ltd" },
      certificatesCancelled: ["002"],
      certificatesIssued: [
        { number: "005", holder: "from", quantity: 160_000 },
        { number: "006", holder: "to", quantity: 40_000 },
      ],
    });
    expect(transfer.statusCode, transfer.body).toBe(201);

    const series = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2022-11-15",
      shareClassId: preference.id,
      quantity: 120_000,
      to: { kind: "individual", name: "Meridian Growth Fund II LP" },
    });
    expect(series.statusCode, series.body).toBe(201);

    const today = await register(issuer.id);
    expect(today.statusCode, today.body).toBe(200);
    const now = today.json();
    const rows = now.holders as Row[];
    expect(holderNamed(rows, "Wentworth Family Office Holdings Ltd")).toMatchObject({
      balance: 500_000,
      certificates: ["003"],
      memberSince: "2019-03-12",
    });
    expect(holderNamed(rows, "Wentworth Family Office Holdings Ltd")?.holder).toMatchObject({
      kind: "entity",
      jurisdiction: "Jersey",
    });
    expect(holderNamed(rows, "Blair Wentworth")).toMatchObject({
      balance: 160_000,
      certificates: ["005"],
    });
    expect(holderNamed(rows, "Harbour Nominees Ltd")).toMatchObject({
      balance: 40_000,
      certificates: ["006"],
      memberSince: "2023-02-01",
    });
    expect(holderNamed(rows, "Meridian Growth Fund II LP", preference.id)).toMatchObject({
      balance: 120_000,
      percentOfClass: 100,
    });
    // Votes: 500,000 + 160,000 + 40,000 + 120,000 = 820,000 outstanding.
    expect(holderNamed(rows, "Wentworth Family Office Holdings Ltd")?.percentOfVotes).toBe(60.98);
    expect(now.treasury).toEqual([{ shareClassId: ordinary.id, balance: 50_000 }]);
    expect(now.totals).toEqual([
      expect.objectContaining({
        shareClassId: ordinary.id,
        issued: 750_000,
        treasury: 50_000,
        outstanding: 700_000,
      }),
      expect.objectContaining({
        shareClassId: preference.id,
        issued: 120_000,
        outstanding: 120_000,
      }),
    ]);
    // Entry numbers follow insertion; the register orders by date first.
    expect(
      (now.entries as { entryNo: number; effectiveOn: string }[]).map((row) => row.entryNo),
    ).toEqual([1, 2, 3, 5, 4]);
    expect(now.dates).toEqual(["2019-03-12", "2020-12-10", "2022-11-15", "2023-02-01"]);
    expect(now.reconciliation).toEqual({ declaredIssued: 750_000, registerIssued: 870_000 });
    expect(now.warnings).toEqual([]);

    const yearEnd = await register(issuer.id, "2022-12-31");
    expect(yearEnd.statusCode, yearEnd.body).toBe(200);
    const then = yearEnd.json();
    expect(then.asOf).toBe("2022-12-31");
    expect(holderNamed(then.holders, "Blair Wentworth")).toMatchObject({
      balance: 200_000,
      balanceToday: 160_000,
      certificates: ["002"],
    });
    expect(holderNamed(then.holders, "Harbour Nominees Ltd")).toBeUndefined();
    expect(
      (then.entries as { entryNo: number; applied: boolean }[]).map((row) => [
        row.entryNo,
        row.applied,
      ]),
    ).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [5, true],
      [4, false],
    ]);
  });

  it("refuses an entry that would overdraw a holder, and one that cancels a certificate that is not live", async () => {
    const issuer = await newEntity("Overdraw Ltd");
    const ordinary = await newClass(issuer.id, { name: "Ordinary", authorized: 100 });
    const allot = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 100,
      to: { kind: "individual", name: "Ada" },
      certificatesIssued: [{ number: "A1", holder: "to", quantity: 100 }],
    });
    expect(allot.statusCode, allot.body).toBe(201);
    const ada = (allot.json().holders as Row[])[0]!.holder.id;

    const overdrawn = await entry(issuer.id, {
      kind: "transfer",
      effectiveOn: "2024-02-01",
      shareClassId: ordinary.id,
      quantity: 101,
      from: { kind: "holder", holderId: ada },
      to: { kind: "individual", name: "Bea" },
    });
    expect(overdrawn.statusCode, overdrawn.body).toBe(409);
    expect(overdrawn.json().detail).toMatch(/below zero/);

    // A transfer dated before the allotment is the same refusal: the
    // register is replayed in date order, not insertion order.
    const early = await entry(issuer.id, {
      kind: "transfer",
      effectiveOn: "2023-12-31",
      shareClassId: ordinary.id,
      quantity: 1,
      from: { kind: "holder", holderId: ada },
      to: { kind: "individual", name: "Bea" },
    });
    expect(early.statusCode, early.body).toBe(409);

    const staleCertificate = await entry(issuer.id, {
      kind: "transfer",
      effectiveOn: "2024-02-01",
      shareClassId: ordinary.id,
      quantity: 10,
      from: { kind: "holder", holderId: ada },
      to: { kind: "individual", name: "Bea" },
      certificatesCancelled: ["A9"],
    });
    expect(staleCertificate.statusCode, staleCertificate.body).toBe(400);
    expect(staleCertificate.json().detail).toMatch(/No certificate A9/);

    const overCertified = await entry(issuer.id, {
      kind: "transfer",
      effectiveOn: "2024-02-01",
      shareClassId: ordinary.id,
      quantity: 10,
      from: { kind: "holder", holderId: ada },
      to: { kind: "individual", name: "Bea" },
      certificatesIssued: [{ number: "B1", holder: "to", quantity: 11 }],
    });
    expect(overCertified.statusCode, overCertified.body).toBe(409);
    expect(overCertified.json().detail).toMatch(/more shares than they hold/);

    // Nothing above landed: Ada still holds 100 under A1, and the
    // refused transfers left no holder rows or entries behind.
    const now = await register(issuer.id);
    expect(now.json().holders).toHaveLength(1);
    expect(now.json().entries).toHaveLength(1);

    // Past the authorized count is a warning, not a refusal.
    const overAuthorized = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-03-01",
      shareClassId: ordinary.id,
      quantity: 50,
      to: { kind: "holder", holderId: ada },
    });
    expect(overAuthorized.statusCode, overAuthorized.body).toBe(201);
    expect(overAuthorized.json().warnings).toEqual([
      expect.objectContaining({
        code: "authorized-exceeded",
        className: "Ordinary",
        issued: 150,
        authorized: 100,
      }),
    ]);
  });

  it("refuses the shapes a kind cannot take, and a holder that is the issuer itself", async () => {
    const issuer = await newEntity("Shapes Ltd");
    const ordinary = await newClass(issuer.id, { name: "Ordinary" });
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ kind: "allotment", to: null }, /needs a holder the shares go to/],
      [
        {
          kind: "allotment",
          from: { kind: "individual", name: "X" },
          to: { kind: "individual", name: "Y" },
        },
        /comes from the company/,
      ],
      [
        {
          kind: "buyback",
          from: { kind: "individual", name: "X" },
          to: { kind: "individual", name: "Y" },
        },
        /goes to the company/,
      ],
      [{ kind: "conversion", from: { kind: "individual", name: "X" } }, /class the shares become/],
      [
        { kind: "allotment", to: { kind: "entity", entityId: issuer.id } },
        /cannot hold its own shares/,
      ],
      [
        { kind: "allotment", to: { kind: "individual", name: "X" }, pricePerShare: 5 },
        /price needs its currency/,
      ],
    ];
    for (const [body, detail] of cases) {
      const response = await entry(issuer.id, {
        effectiveOn: "2024-01-01",
        shareClassId: ordinary.id,
        quantity: 1,
        ...body,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().detail).toMatch(detail);
    }
    const strict = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 1,
      to: { kind: "individual", name: "X" },
      surprise: true,
    });
    expect(strict.statusCode).toBe(400);
    expect((await register(issuer.id)).json().holders).toEqual([]);
  });

  it("refuses an entry that would loop the ownership graph, naming a Restricted Entity", async () => {
    const parent = await newEntity("Loop Parent Ltd");
    const child = await newEntity("Loop Child Ltd");
    const walled = await newEntity("Loop Walled Ltd", { isConfidential: true });
    for (const [owner, owned] of [
      [parent, walled],
      [walled, child],
    ] as const) {
      const holding = await harness.app.inject({
        method: "POST",
        url: `/api/v1/entities/${owner.id}/holdings`,
        cookies: memberCookies,
        payload: { direction: "owned", relatedEntityId: owned.id, ownershipPercent: 100 },
      });
      expect(holding.statusCode, holding.body).toBe(201);
    }
    const ordinary = await newClass(parent.id, { name: "Ordinary" });
    // The child holding shares of the parent closes parent → walled → child → parent.
    const loop = await entry(
      parent.id,
      {
        kind: "allotment",
        effectiveOn: "2024-01-01",
        shareClassId: ordinary.id,
        quantity: 10,
        to: { kind: "entity", entityId: child.id },
      },
      outsiderCookies,
    );
    expect(loop.statusCode, loop.body).toBe(409);
    expect(loop.json().detail).toContain("Restricted Entity");
    expect(loop.json().detail).toContain("Loop Child Ltd");
  });

  it("forgets a holder whose entries are gone, so a later reverse holding is not a loop", async () => {
    const a = await newEntity("Edge A Ltd");
    const h = await newEntity("Edge H Ltd");
    const aClass = await newClass(a.id, { name: "Ordinary" });
    const hClass = await newClass(h.id, { name: "Ordinary" });
    const first = await entry(a.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: aClass.id,
      quantity: 10,
      to: { kind: "entity", entityId: h.id },
    });
    expect(first.statusCode, first.body).toBe(201);
    // H owns A, so A holding H would loop.
    const loop = await entry(h.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: hClass.id,
      quantity: 10,
      to: { kind: "entity", entityId: a.id },
    });
    expect(loop.statusCode, loop.body).toBe(409);
    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${a.id}/share-entries/${first.json().entries[0].id}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await register(a.id)).json().holders).toEqual([]);
    const fine = await entry(h.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: hClass.id,
      quantity: 10,
      to: { kind: "entity", entityId: a.id },
    });
    expect(fine.statusCode, fine.body).toBe(201);
  });

  it("shows a walled holder Entity as Restricted, and keeps entries editable and removable", async () => {
    const issuer = await newEntity("Register Ltd");
    const walled = await newEntity("Secret Investor Ltd", { isConfidential: true });
    const ordinary = await newClass(issuer.id, { name: "Ordinary" });
    const allot = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 10,
      to: { kind: "entity", entityId: walled.id },
      certificatesIssued: [{ number: "S1", holder: "to", quantity: 10 }],
    });
    expect(allot.statusCode, allot.body).toBe(201);
    const entryId = allot.json().entries[0].id as string;

    const outsider = await register(issuer.id, undefined, outsiderCookies);
    expect(outsider.statusCode, outsider.body).toBe(200);
    expect(outsider.json().holders[0].holder).toEqual({ restricted: true, id: expect.any(String) });
    expect(outsider.json().entries[0].to).toEqual({ restricted: true, id: expect.any(String) });
    expect(outsider.body).not.toContain("Secret Investor");

    const edited = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${issuer.id}/share-entries/${entryId}`,
      cookies: memberCookies,
      payload: {
        kind: "allotment",
        effectiveOn: "2024-01-02",
        shareClassId: ordinary.id,
        quantity: 12,
        to: { kind: "entity", entityId: walled.id },
        note: "Corrected count",
        certificatesIssued: [{ number: "S1", holder: "to", quantity: 12 }],
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().entries[0]).toMatchObject({
      entryNo: 1,
      quantity: 12,
      effectiveOn: "2024-01-02",
      note: "Corrected count",
      certificatesIssued: [expect.objectContaining({ number: "S1", quantity: 12 })],
    });

    // A later entry that cancels S1 pins the first entry until it is changed.
    const later = await entry(issuer.id, {
      kind: "buyback",
      effectiveOn: "2024-02-01",
      shareClassId: ordinary.id,
      quantity: 12,
      from: { kind: "entity", entityId: walled.id },
      certificatesCancelled: ["S1"],
    });
    expect(later.statusCode, later.body).toBe(201);
    const pinned = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${issuer.id}/share-entries/${entryId}`,
      cookies: memberCookies,
    });
    expect(pinned.statusCode, pinned.body).toBe(409);
    expect(pinned.json().detail).toMatch(/cancelled by a later entry/);

    // Removing the buyback first frees the allotment; removing the
    // allotment then empties the register, and the number is not reused.
    const laterId = later.json().entries.find((row: { entryNo: number }) => row.entryNo === 2).id;
    for (const id of [laterId, entryId]) {
      const removed = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/entities/${issuer.id}/share-entries/${id}`,
        cookies: memberCookies,
      });
      expect(removed.statusCode, removed.body).toBe(204);
    }
    const again = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 1,
      to: { kind: "entity", entityId: walled.id },
    });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().entries[0].entryNo).toBe(3);

    const actions = await harness.db
      .select({ action: activityLog.action, entityId: activityLog.entityId })
      .from(activityLog)
      .where(
        and(
          inArray(activityLog.entityId, [issuer.id, walled.id]),
          inArray(activityLog.action, [
            "entity_share_entry.created",
            "entity_share_entry.updated",
            "entity_share_entry.deleted",
            "entity_share_class.created",
          ]),
        ),
      );
    const onIssuer = actions.filter((row) => row.entityId === issuer.id).map((row) => row.action);
    expect(onIssuer.filter((action) => action === "entity_share_entry.created")).toHaveLength(3);
    expect(onIssuer.filter((action) => action === "entity_share_entry.updated")).toHaveLength(1);
    expect(onIssuer.filter((action) => action === "entity_share_entry.deleted")).toHaveLength(2);
    expect(onIssuer.filter((action) => action === "entity_share_class.created")).toHaveLength(1);
    // The holder Entity carries the same entries: the act names it too.
    expect(actions.filter((row) => row.entityId === walled.id)).toHaveLength(6);
  });

  it("manages share classes: unique live names, no archive while entries reference it", async () => {
    const issuer = await newEntity("Classes Ltd");
    const ordinary = await newClass(issuer.id, { name: "Ordinary" });
    const duplicate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${issuer.id}/share-classes`,
      cookies: memberCookies,
      payload: { name: "ordinary" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);

    const renamed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${issuer.id}/share-classes/${ordinary.id}`,
      cookies: memberCookies,
      payload: { name: "Ordinary A", authorized: 500, votesPerShare: 10 },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().classes[0]).toMatchObject({
      name: "Ordinary A",
      authorized: 500,
      votesPerShare: 10,
      entryCount: 0,
    });

    const allot = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 1,
      to: { kind: "individual", name: "Ada" },
    });
    expect(allot.statusCode, allot.body).toBe(201);
    expect(allot.json().classes[0].entryCount).toBe(1);
    const inUse = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${issuer.id}/share-classes/${ordinary.id}`,
      cookies: memberCookies,
    });
    expect(inUse.statusCode, inUse.body).toBe(409);

    const spare = await newClass(issuer.id, { name: "Spare" });
    const archived = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${issuer.id}/share-classes/${spare.id}`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(204);
    const now = await register(issuer.id);
    expect(
      now.json().classes.find((row: { id: string }) => row.id === spare.id).archivedAt,
    ).toEqual(expect.any(String));
    const onArchived = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: spare.id,
      quantity: 1,
      to: { kind: "individual", name: "Ada" },
    });
    expect(onArchived.statusCode, onArchived.body).toBe(409);
  });

  it("projects Holdings from the register and keeps them read-only on the Holdings routes", async () => {
    const issuer = await newEntity("Projected Ltd");
    const parent = await newEntity("Projected Parent Ltd");
    const other = await newEntity("Projected Other Ltd");
    const ordinary = await newClass(issuer.id, { name: "Ordinary" });
    const holdingsOf = (id: string) =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/entities/${id}/holdings`,
        cookies: memberCookies,
      });

    // A hand-typed Holding predates the register.
    const manual = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${issuer.id}/holdings`,
      cookies: memberCookies,
      payload: { direction: "owner", relatedEntityId: parent.id, ownershipPercent: 40 },
    });
    expect(manual.statusCode, manual.body).toBe(201);
    expect(manual.json().holding.source).toBe("manual");

    const allot = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 600,
      to: { kind: "entity", entityId: parent.id },
    });
    expect(allot.statusCode, allot.body).toBe(201);
    const ada = await entry(issuer.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: ordinary.id,
      quantity: 400,
      to: { kind: "individual", name: "Ada" },
    });
    expect(ada.statusCode, ada.body).toBe(201);
    const owners = holdingsOf(issuer.id);
    expect((await owners).statusCode).toBe(200);
    let rows = (await owners).json().owners as {
      owner: { id: string; legalName: string; kind?: string };
      ownershipPercent: number;
      source: string;
    }[];
    // The manual 40% is replaced by the register's 60%; Ada is projected as an individual.
    expect(rows.map((row) => [row.owner.legalName, row.ownershipPercent, row.source])).toEqual([
      ["Ada", 40, "register"],
      ["Projected Parent Ltd", 60, "register"],
    ]);
    const parentRow = rows.find((row) => row.owner.legalName === "Projected Parent Ltd")!;
    const adaRow = rows.find((row) => row.owner.legalName === "Ada")!;

    for (const relatedId of [parent.id, adaRow.owner.id]) {
      const patched = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/entities/${issuer.id}/holdings/${relatedId}`,
        cookies: memberCookies,
        payload: { ownershipPercent: 10 },
      });
      expect(patched.statusCode, patched.body).toBe(409);
      expect(patched.json().detail).toMatch(/derived from the share register/);
      const removed = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/entities/${issuer.id}/holdings/${relatedId}`,
        cookies: memberCookies,
      });
      expect(removed.statusCode, removed.body).toBe(409);
    }

    // A transfer moves the percentages; the chart edge says where they came from.
    const moved = await entry(issuer.id, {
      kind: "transfer",
      effectiveOn: "2024-02-01",
      shareClassId: ordinary.id,
      quantity: 100,
      from: { kind: "entity", entityId: parent.id },
      to: { kind: "entity", entityId: other.id },
    });
    expect(moved.statusCode, moved.body).toBe(201);
    rows = (await holdingsOf(issuer.id)).json().owners;
    expect(rows.map((row) => [row.owner.legalName, row.ownershipPercent])).toEqual([
      ["Ada", 40],
      ["Projected Other Ltd", 10],
      ["Projected Parent Ltd", 50],
    ]);
    const chart = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/chart",
      cookies: memberCookies,
    });
    const edge = (
      chart.json().edges as { ownerEntityId: string; ownedEntityId: string; source: string }[]
    ).find((row) => row.ownerEntityId === other.id && row.ownedEntityId === issuer.id);
    expect(edge?.source).toBe("register");

    // Removing the register's entries removes what it projected, and nothing else.
    const ids = (moved.json().entries as { id: string; entryNo: number }[])
      .sort((a, b) => b.entryNo - a.entryNo)
      .map((row) => row.id);
    for (const id of ids) {
      const gone = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/entities/${issuer.id}/share-entries/${id}`,
        cookies: memberCookies,
      });
      expect(gone.statusCode, gone.body).toBe(204);
    }
    expect((await holdingsOf(issuer.id)).json().owners).toEqual([]);
    expect(parentRow.source).toBe("register");
  });

  it("refuses to delete an entry when the holder it restores would close a loop", async () => {
    const a = await newEntity("Restore A Ltd");
    const h = await newEntity("Restore H Ltd");
    const aClass = await newClass(a.id, { name: "Ordinary" });
    // H holds A, then sells out to an individual: H no longer owns A.
    const allot = await entry(a.id, {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId: aClass.id,
      quantity: 10,
      to: { kind: "entity", entityId: h.id },
    });
    expect(allot.statusCode, allot.body).toBe(201);
    const sale = await entry(a.id, {
      kind: "transfer",
      effectiveOn: "2024-02-01",
      shareClassId: aClass.id,
      quantity: 10,
      from: { kind: "entity", entityId: h.id },
      to: { kind: "individual", name: "Buyer" },
    });
    expect(sale.statusCode, sale.body).toBe(201);
    // Now A may own H.
    const reverse = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${a.id}/holdings`,
      cookies: memberCookies,
      payload: { direction: "owned", relatedEntityId: h.id, ownershipPercent: 100 },
    });
    expect(reverse.statusCode, reverse.body).toBe(201);
    // Deleting the sale would hand A back to H: A → H → A.
    const saleId = sale.json().entries.find((row: { entryNo: number }) => row.entryNo === 2).id;
    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${a.id}/share-entries/${saleId}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(409);
    expect(removed.json().detail).toMatch(/ownership loop/);
    // Rolled back: the sale is still on the register.
    expect((await register(a.id)).json().entries).toHaveLength(2);
  });

  it("keeps the register behind Member+ and the Entity's reach", async () => {
    const business = {
      email: "share-register-business@example.com",
      displayName: "Bea Business",
      password: "correct-horse-battery",
    } as const;
    const person = await provisionUser(harness.app.auth, business);
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
    const businessCookies = await signInCookies(harness.app, business.email, business.password);
    const issuer = await newEntity("Walled Issuer Ltd", { isConfidential: true });
    expect((await register(issuer.id, undefined, businessCookies)).statusCode).toBe(403);
    expect((await register(issuer.id, undefined, outsiderCookies)).statusCode).toBe(404);
    expect((await register(issuer.id, undefined, adminCookies)).statusCode).toBe(404);
    expect((await register(issuer.id)).statusCode).toBe(200);
    expect((await register(issuer.id, "not-a-date")).statusCode).toBe(400);
  });
});
