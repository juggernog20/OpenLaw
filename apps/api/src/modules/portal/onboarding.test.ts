// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, and, departments, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
let sequence = 0;
beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const person = await businessUser();
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, person.id));
  member = person.cookies;
});
afterAll(async () => harness?.stop());

async function businessUser() {
  const credentials = {
    email: `first-run-${++sequence}@example.com`,
    displayName: "Business colleague",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(harness.app.auth, credentials);
  return {
    id: person.id,
    credentials,
    cookies: await signInCookies(harness.app, credentials.email, credentials.password),
  };
}
const state = (cookies: Record<string, string>) =>
  harness.app.inject({ method: "GET", url: "/api/v1/portal/onboarding", cookies });
const finish = (cookies: Record<string, string>) =>
  harness.app.inject({ method: "POST", url: "/api/v1/portal/onboarding/complete", cookies });
const choose = (cookies: Record<string, string>, departmentId: string) =>
  harness.app.inject({
    method: "PATCH",
    url: "/api/v1/portal/onboarding/department",
    cookies,
    payload: { departmentId },
  });

it("refuses staff and signed-out callers on every first-run route", async () => {
  for (const cookies of [{}, admin, member]) {
    for (const response of [
      await state(cookies),
      await finish(cookies),
      await choose(cookies, "missing"),
    ]) {
      expect(response.statusCode, response.body).toBe(Object.keys(cookies).length ? 403 : 401);
    }
  }
});

it("offers an existing Business User the first run and stamps completion once with an empty list", async () => {
  const person = await businessUser();
  await harness.db
    .update(users)
    .set({ createdAt: new Date("2025-01-01T00:00:00Z") })
    .where(eq(users.id, person.id));
  const initial = await state(person.cookies);
  expect(initial.statusCode, initial.body).toBe(200);
  expect(initial.json()).toMatchObject({ completedAt: null, departments: [], departmentId: null });
  const me = await harness.app.inject({
    method: "GET",
    url: "/api/v1/me",
    cookies: person.cookies,
  });
  expect(me.json().user.portalOnboardingCompletedAt).toBeNull();
  const [completed, concurrent] = await Promise.all([
    finish(person.cookies),
    finish(person.cookies),
  ]);
  expect(completed.statusCode, completed.body).toBe(200);
  const stamp = completed.json().completedAt;
  expect(concurrent.statusCode, concurrent.body).toBe(200);
  expect(concurrent.json().completedAt).toBe(stamp);
  expect(stamp).toEqual(expect.any(String));
  expect((await finish(person.cookies)).json().completedAt).toBe(stamp);
  const again = await signInCookies(
    harness.app,
    person.credentials.email,
    person.credentials.password,
  );
  expect((await state(again)).json().completedAt).toBe(stamp);
  const meAgain = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: again });
  expect(meAgain.json().user.portalOnboardingCompletedAt).toBe(stamp);
  expect((await choose(again, "missing")).statusCode).toBe(409);
});

it("requires a live Department, audits the self-write, and prevents self-changes after completion", async () => {
  const person = await businessUser();
  const [sales] = await harness.db
    .insert(departments)
    .values({ slug: "onboarding-sales", displayName: "Sales", displayOrder: 1 })
    .returning();
  const [archived] = await harness.db
    .insert(departments)
    .values({
      slug: "onboarding-retired",
      displayName: "Retired",
      displayOrder: 2,
      archivedAt: new Date(),
    })
    .returning();
  expect((await state(person.cookies)).json().departments).toEqual([
    { id: sales!.id, displayName: "Sales" },
  ]);
  expect((await finish(person.cookies)).statusCode).toBe(400);
  for (const id of ["missing", archived!.id])
    expect((await choose(person.cookies, id)).statusCode).toBe(400);
  const assigned = await choose(person.cookies, sales!.id);
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.json().departmentId).toBe(sales!.id);
  const entries = await harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, person.id), eq(activityLog.action, "user.department_set")));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorId: person.id,
    visibility: "admin_only",
    payload: { from: null, to: "Sales", fromId: null, toId: sales!.id },
  });
  await harness.db
    .update(departments)
    .set({ archivedAt: new Date() })
    .where(eq(departments.id, sales!.id));
  await harness.db
    .update(departments)
    .set({ archivedAt: null })
    .where(eq(departments.id, archived!.id));
  expect((await finish(person.cookies)).statusCode).toBe(400);
  expect((await choose(person.cookies, archived!.id)).statusCode).toBe(200);
  expect((await finish(person.cookies)).statusCode).toBe(200);
  expect((await choose(person.cookies, archived!.id)).statusCode).toBe(409);
  const override = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/users/${person.id}/department`,
    cookies: admin,
    payload: { departmentId: null },
  });
  expect(override.statusCode, override.body).toBe(200);
  expect((await finish(person.cookies)).statusCode).toBe(200);
});
