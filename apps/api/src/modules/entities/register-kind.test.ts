// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, entities, eq, entityTypes, users } from "@openlaw/db";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

import { provisionUser } from "../../auth/instance.js";

let h: TestHarness;
let memberCookies: Record<string, string>;
let cookies: Record<string, string>;
let types: Record<string, string>;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const member = {
    email: "register-member@example.com",
    displayName: "Register Member",
    password: "correct-horse-battery",
  };
  const user = await provisionUser(h.app.auth, member);
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
  memberCookies = await signInCookies(h.app, member.email, member.password);
  types = Object.fromEntries((await h.db.select().from(entityTypes)).map((t) => [t.slug, t.id]));
});
afterAll(async () => h?.stop());
function patch(id: string, payload: Record<string, unknown>) {
  return h.app.inject({
    method: "PATCH",
    url: `/api/v1/entities/${id}`,
    cookies: memberCookies,
    payload,
  });
}
async function create(slug = "corporation") {
  const r = await h.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: { legalName: "Register test", entityTypeId: types[slug] },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().entity.id as string;
}
async function read(id: string) {
  return (await h.app.inject({ url: `/api/v1/entities/${id}`, cookies: memberCookies })).json()
    .entity;
}
async function addClass(id: string) {
  const r = await h.app.inject({
    method: "POST",
    url: `/api/v1/entities/${id}/share-classes`,
    cookies: memberCookies,
    payload: { name: "Ordinary" },
  });
  expect(r.statusCode, r.body).toBe(201);
}
it("seeds type kinds, defaults new types to shares, and reports an inherited kind", async () => {
  const rows = await h.db.select().from(entityTypes);
  expect(Object.fromEntries(rows.map((t) => [t.slug, t.registerKind]))).toMatchObject({
    corporation: "shares",
    llc: "shares",
    partnership: "partnership",
    branch: "none",
    other: "shares",
  });
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/entity-types",
    cookies,
    payload: { displayName: "Custom register type" },
  });
  expect(created.json().entityType.registerKind).toBe("shares");
  expect(await read(await create("partnership"))).toMatchObject({
    registerKind: "partnership",
    registerKindSource: "type",
    registerKindLocked: false,
  });
});
it("sets an override, clears it by choosing the type kind, and narrates it", async () => {
  const id = await create();
  expect((await patch(id, { registerKind: "trust" })).json().entity).toMatchObject({
    registerKind: "trust",
    registerKindSource: "entity",
  });
  expect((await patch(id, { registerKind: "shares" })).json().entity).toMatchObject({
    registerKind: "shares",
    registerKindSource: "type",
  });
  const rows = await h.db.select().from(activityLog).where(eq(activityLog.entityId, id));
  expect(
    rows.some(
      (r) => r.action === "entity.updated" && JSON.stringify(r.payload).includes('"registerKind"'),
    ),
  ).toBe(true);
});
it("refuses kind changes and retyping when a share class exists, but permits pinning", async () => {
  const id = await create();
  await addClass(id);
  expect(await read(id)).toMatchObject({ registerKindLocked: true });
  for (const payload of [{ registerKind: "trust" }, { entityTypeId: types.partnership }]) {
    expect((await patch(id, payload)).statusCode).toBe(409);
  }
  expect(
    (await patch(id, { entityTypeId: types.partnership, registerKind: "shares" })).statusCode,
  ).toBe(200);
  expect(await read(id)).toMatchObject({ registerKind: "shares", registerKindSource: "entity" });
  expect((await patch(id, { registerKind: null })).statusCode).toBe(409);
});
it("refuses a type change with a count, and archive-and-reassign pins populated Entities", async () => {
  const t = (
    await h.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies,
      payload: { displayName: "Pinned type" },
    })
  ).json().entityType;
  types.pinned = t.id;
  const id = await create("pinned");
  await addClass(id);
  const empty = await create("pinned");
  await h.db.update(entities).set({ archivedAt: new Date() }).where(eq(entities.id, id));
  const refused = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/entity-types/${t.id}`,
    cookies,
    payload: { registerKind: "trust" },
  });
  expect(refused.statusCode, refused.body).toBe(409);
  expect(refused.json().detail).toContain("1 Entity");
  const moved = await h.app.inject({
    method: "POST",
    url: `/api/v1/entity-types/${t.id}/archive`,
    cookies,
    payload: { reassignToId: types.partnership },
  });
  expect(moved.statusCode, moved.body).toBe(200);
  expect(await read(id)).toMatchObject({ registerKind: "shares", registerKindSource: "entity" });
  expect(await read(empty)).toMatchObject({
    registerKind: "partnership",
    registerKindSource: "type",
  });
});
it("sets and clears a head office, refuses self, loops, missing targets and other kinds", async () => {
  const a = await create("branch"),
    b = await create("branch"),
    c = await create("branch");
  expect((await patch(a, { headOfficeEntityId: a })).statusCode).toBe(409);
  expect((await patch(a, { headOfficeEntityId: "missing" })).statusCode).toBe(400);
  expect((await patch(a, { headOfficeEntityId: b })).statusCode).toBe(200);
  expect((await patch(b, { headOfficeEntityId: c })).statusCode).toBe(200);
  expect((await patch(c, { headOfficeEntityId: a })).statusCode).toBe(409);
  expect(
    (await patch(a, { headOfficeEntityId: null })).json().entity.headOfficeEntityId,
  ).toBeNull();
  await patch(a, { headOfficeEntityId: b });
  expect((await patch(a, { registerKind: "shares" })).json().entity.headOfficeEntityId).toBeNull();
  expect((await patch(a, { headOfficeEntityId: b })).statusCode).toBe(409);
  expect((await patch(a, { headOfficeEntityId: null })).statusCode).toBe(409);
});
it("refuses every share register route for a non-shares Entity", async () => {
  const id = await create("partnership");
  for (const [method, path, payload] of [
    ["GET", "share-register", undefined],
    ["GET", "share-register/export?kind=members", undefined],
    ["POST", "share-classes", { name: "Ordinary" }],
    ["PATCH", "share-classes/missing", { name: "Renamed" }],
    ["DELETE", "share-classes/missing", undefined],
    [
      "POST",
      "share-entries",
      {
        kind: "allotment",
        effectiveOn: "2026-01-01",
        shareClassId: "missing",
        quantity: 1,
        to: { kind: "individual", name: "A" },
      },
    ],
    [
      "PATCH",
      "share-entries/missing",
      { kind: "allotment", effectiveOn: "2026-01-01", shareClassId: "missing", quantity: 1 },
    ],
    ["DELETE", "share-entries/missing", undefined],
  ] as const) {
    const r = await h.app.inject({
      method,
      url: `/api/v1/entities/${id}/${path}`,
      cookies,
      ...(payload ? { payload } : {}),
    });
    expect(r.statusCode, `${method} ${path}: ${r.body}`).toBe(409);
  }
});
it("keeps overrides on a type edit and clears inherited head offices when leaving none", async () => {
  const type = (
    await h.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies,
      payload: { displayName: "Head office type" },
    })
  ).json().entityType;
  types.office = type.id;
  const update = (registerKind: string) =>
    h.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${type.id}`,
      cookies,
      payload: { registerKind },
    });
  const pinned = await create("office");
  await patch(pinned, { registerKind: "trust" });
  expect((await update("none")).statusCode).toBe(200);
  const branch = await create("office"),
    head = await create();
  await patch(branch, { headOfficeEntityId: head });
  expect((await update("partnership")).statusCode).toBe(200);
  expect(await read(branch)).toMatchObject({
    registerKind: "partnership",
    headOfficeEntityId: null,
  });
  expect(await read(pinned)).toMatchObject({ registerKind: "trust", registerKindSource: "entity" });
  const activity = await h.db.select().from(activityLog).where(eq(activityLog.entityId, branch));
  expect(
    activity.some(
      (r) =>
        r.action === "entity.updated" && JSON.stringify(r.payload).includes('"headOfficeEntityId"'),
    ),
  ).toBe(true);
});
it("refuses invalid kinds, archived edits, and unreachable or archived head offices", async () => {
  const id = await create("branch"),
    head = await create();
  expect((await patch(id, { registerKind: "invalid" })).statusCode).toBe(400);
  await h.db.update(entities).set({ isConfidential: true }).where(eq(entities.id, head));
  // A direct seed without a grant is unreachable even to an Administrator.
  const [hidden] = await h.db
    .insert(entities)
    .values({ legalName: "Hidden head", entityTypeId: types.corporation!, isConfidential: true })
    .returning();
  expect((await patch(id, { headOfficeEntityId: hidden!.id })).statusCode).toBe(400);
  await h.db.update(entities).set({ archivedAt: new Date() }).where(eq(entities.id, head));
  expect((await patch(id, { headOfficeEntityId: head })).statusCode).toBe(400);
  await h.db.update(entities).set({ archivedAt: new Date() }).where(eq(entities.id, id));
  expect((await patch(id, { registerKind: "shares" })).statusCode).toBe(409);
  expect((await patch(id, { headOfficeEntityId: null })).statusCode).toBe(409);
});
it("serializes opposing head-office writes so one refuses the loop", async () => {
  const a = await create("branch"),
    b = await create("branch");
  const results = await Promise.all([
    patch(a, { headOfficeEntityId: b }),
    patch(b, { headOfficeEntityId: a }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
});
it("serializes a type change against creation of share data", async () => {
  const type = (
    await h.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies,
      payload: { displayName: "Concurrent type" },
    })
  ).json().entityType;
  types.concurrent = type.id;
  const id = await create("concurrent");
  const results = await Promise.all([
    h.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${type.id}`,
      cookies,
      payload: { registerKind: "trust" },
    }),
    h.app.inject({
      method: "POST",
      url: `/api/v1/entities/${id}/share-classes`,
      cookies,
      payload: { name: "Ordinary" },
    }),
  ]);
  expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
  expect(results.filter((r) => r.statusCode === 200 || r.statusCode === 201)).toHaveLength(1);
});

it("keeps the kind locked after the last Share class is archived", async () => {
  const id = await create();
  await addClass(id);
  const register = await h.app.inject({
    url: `/api/v1/entities/${id}/share-register`,
    cookies: memberCookies,
  });
  const classId = register.json().classes[0].id;
  const removed = await h.app.inject({
    method: "DELETE",
    url: `/api/v1/entities/${id}/share-classes/${classId}`,
    cookies: memberCookies,
  });
  expect(removed.statusCode).toBe(204);
  expect(await read(id)).toMatchObject({ registerKindLocked: true });
  expect((await patch(id, { registerKind: "trust" })).statusCode).toBe(409);
});
