// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, and, asc, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
let business: Record<string, string>;
let entityTypeId: string;

beforeAll(async () => {
  h = await startHarness();
  expect(
    (await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const role of ["legal_team_member", "business_user"] as const) {
    const person = {
      email: `${role}@example.com`,
      displayName: role,
      password: "correct-horse-battery",
    };
    const user = await provisionUser(h.app.auth, person);
    await h.db.update(users).set({ role }).where(eq(users.id, user.id));
    const cookies = await signInCookies(h.app, person.email, person.password);
    if (role === "business_user") business = cookies;
    else member = cookies;
  }
  const types = await h.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: admin,
  });
  entityTypeId = types.json().entityTypes[0].id;
});
afterAll(async () => h.stop());

async function create(legalName: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: admin,
    payload: { legalName, entityTypeId },
  });
  expect(res.statusCode, res.body).toBe(201);
  expect(res.json().entity.portalListed).toBe(false);
  return res.json().entity.id as string;
}
const patch = (id: string, payload: Record<string, unknown>, cookies = admin) =>
  h.app.inject({ method: "PATCH", url: `/api/v1/entities/${id}`, cookies, payload });
const list = (cookies = business) =>
  h.app.inject({ method: "GET", url: "/api/v1/portal/entities", cookies });

it("lists only live, non-Confidential, Portal-listed names and preserves the flag through archive and restore", async () => {
  expect((await h.app.inject({ method: "GET", url: "/api/v1/portal/entities" })).statusCode).toBe(
    401,
  );
  expect((await list()).json()).toEqual({ entities: [] });
  const zebra = await create("Zebra Operating Ltd");
  const alpha = await create("alpha Trading Ltd");
  await create("Unlisted Holding Ltd");
  expect((await patch(zebra, { portalListed: true })).statusCode).toBe(200);
  expect((await patch(alpha, { portalListed: true, status: "dormant" })).statusCode).toBe(200);
  expect((await list()).json()).toEqual({
    entities: [
      { id: alpha, name: "alpha Trading Ltd" },
      { id: zebra, name: "Zebra Operating Ltd" },
    ],
  });
  expect(
    (await h.app.inject({ method: "GET", url: `/api/v1/entities/${alpha}`, cookies: business }))
      .statusCode,
  ).toBe(403);
  expect(
    (await h.app.inject({ method: "GET", url: "/api/v1/entities", cookies: business })).statusCode,
  ).toBe(403);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/entities/${alpha}/archive`,
        cookies: admin,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await list()).json()).toEqual({ entities: [{ id: zebra, name: "Zebra Operating Ltd" }] });
  const restored = await h.app.inject({
    method: "POST",
    url: `/api/v1/entities/${alpha}/restore`,
    cookies: admin,
    payload: {},
  });
  expect(restored.statusCode, restored.body).toBe(200);
  expect(restored.json().entity.portalListed).toBe(true);
  expect((await patch(alpha, { isConfidential: true })).statusCode).toBe(200);
  expect((await list()).json()).toEqual({ entities: [{ id: zebra, name: "Zebra Operating Ltd" }] });
  const refused = await patch(alpha, { portalListed: true });
  expect(refused.statusCode).toBe(400);
  expect(refused.json().detail).toContain("Confidential Entity");
  expect((await patch(alpha, { portalListed: false })).statusCode).toBe(200);
  expect((await patch(zebra, { portalListed: false })).statusCode).toBe(200);
});

it("lets only an Administrator change the flag, audits changes once, and refuses a combined Confidential mark", async () => {
  const id = await create("Audit Operating Ltd");
  expect((await patch(id, { portalListed: true }, member)).statusCode).toBe(403);
  expect((await patch(id, { portalListed: false }, member)).statusCode).toBe(403);
  expect((await patch(id, { portalListed: true }, business)).statusCode).toBe(403);
  expect((await patch(id, { portalListed: true, isConfidential: true })).statusCode).toBe(400);
  expect((await patch(id, { portalListed: true })).statusCode).toBe(200);
  expect((await patch(id, { portalListed: true })).statusCode).toBe(200);
  expect((await patch(id, { portalListed: false })).statusCode).toBe(200);
  const rows = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, id), eq(activityLog.action, "entity.portal_listed_set")))
    .orderBy(asc(activityLog.createdAt));
  expect(rows.map((row) => row.payload)).toEqual([
    { legalName: "Audit Operating Ltd", from: false, to: true },
    { legalName: "Audit Operating Ltd", from: true, to: false },
  ]);
  expect(rows.every((row) => row.actorId && row.visibility === "legal_only")).toBe(true);
});

it("accepts a required Entity from the Portal list and refuses hidden, Confidential, archived and stale choices", async () => {
  const types = await h.app.inject({ method: "GET", url: "/api/v1/request-types", cookies: admin });
  const typeId = types
    .json()
    .requestTypes.find((row: { slug: string }) => row.slug === "nda_request").id;
  const field = await h.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: admin,
    payload: {
      displayName: "Signing Entity",
      moduleScope: "global",
      fieldType: "entity",
      fieldTag: "business",
    },
  });
  expect(field.statusCode, field.body).toBe(201);
  const { id: fieldId, slug } = field.json().field;
  const attached = await h.app.inject({
    method: "POST",
    url: `/api/v1/request-types/${typeId}/fields`,
    cookies: admin,
    payload: { fieldId, isRequired: true },
  });
  expect(attached.statusCode, attached.body).toBe(201);
  const submit = (entityId?: string) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/requests",
      cookies: business,
      payload: {
        requestTypeId: typeId,
        title: "NDA",
        description: "For our new supplier",
        urgency: "medium",
        customFields: entityId ? { [slug]: entityId } : {},
      },
    });
  expect((await submit()).statusCode).toBe(400);
  const id = await create("Form Operating Ltd");
  for (const candidate of [id, "unknown"]) {
    const refused = await submit(candidate);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().detail).toContain("Signing Entity");
  }
  expect((await patch(id, { portalListed: true })).statusCode).toBe(200);
  const submitted = await submit(id);
  expect(submitted.statusCode, submitted.body).toBe(201);
  expect(submitted.json().request.customFields).toEqual({ [slug]: id });
  expect((await patch(id, { portalListed: false })).statusCode).toBe(200);
  expect((await submit(id)).statusCode).toBe(400);
  expect((await patch(id, { portalListed: true })).statusCode).toBe(200);
  expect((await patch(id, { isConfidential: true })).statusCode).toBe(200);
  expect((await submit(id)).statusCode).toBe(400);
  const detail = await h.app.inject({
    method: "GET",
    url: `/api/v1/portal/requests/${submitted.json().request.number}`,
    cookies: business,
  });
  expect(detail.statusCode).toBe(200);
  expect(detail.json().customFieldRefs.entities).toEqual([]);
  expect((await patch(id, { isConfidential: false })).statusCode).toBe(200);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/entities/${id}/archive`,
        cookies: admin,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await submit(id)).statusCode).toBe(400);
});
