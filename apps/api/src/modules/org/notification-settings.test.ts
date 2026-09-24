// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, orgSettings, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  settingsAuditRows,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
const url = "/api/v1/org/notifications";
beforeAll(async () => {
  h = await startHarness();
  const setup = await h.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => {
  await h?.stop();
});

it("defaults comment words to on", async () => {
  const read = await h.app.inject({ method: "GET", url, cookies });
  expect(read.statusCode, read.body).toBe(200);
  expect(read.json()).toEqual({ commentWordsInEmail: true });
});

it("saves one field with one audit entry and leaves reminder lead times alone", async () => {
  const [before] = await h.db.select().from(orgSettings);
  const count = (await settingsAuditRows(h.db)).length;
  const saved = await h.app.inject({
    method: "PATCH",
    url,
    cookies,
    payload: { commentWordsInEmail: false },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toEqual({ commentWordsInEmail: false });
  expect((await h.app.inject({ method: "GET", url, cookies })).json()).toEqual(saved.json());
  const rows = (await settingsAuditRows(h.db)).slice(count);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    entityType: "system",
    visibility: "admin_only",
    payload: { field: "commentWordsInEmail", old: true, new: false },
  });
  expect(rows[0]!.actorId).not.toBeNull();
  const [after] = await h.db.select().from(orgSettings);
  expect(after!.reminderOffsetDays).toEqual(before!.reminderOffsetDays);
  await h.app.inject({ method: "PATCH", url, cookies, payload: { commentWordsInEmail: false } });
  expect(await settingsAuditRows(h.db)).toHaveLength(count + 1);
  const offsets = await h.app.inject({
    method: "PUT",
    url: "/api/v1/org/reminder-offsets",
    cookies,
    payload: { offsets: [30, 0] },
  });
  expect(offsets.statusCode, offsets.body).toBe(200);
  expect((await h.app.inject({ method: "GET", url, cookies })).json()).toEqual({
    commentWordsInEmail: false,
  });
});

it.each(["legal_team_member", "business_user"] as const)(
  "refuses %s on read and write",
  async (role) => {
    const account = {
      email: `${role}@example.com`,
      displayName: "Reader",
      password: "correct-horse-battery",
    };
    const user = await provisionUser(h.app.auth, account);
    await h.db.update(users).set({ role }).where(eq(users.id, user.id));
    const denied = await signInCookies(h.app, account.email, account.password);
    const count = (await settingsAuditRows(h.db)).length;
    for (const method of ["GET", "PATCH"] as const) {
      const response = await h.app.inject({
        method,
        url,
        cookies: denied,
        ...(method === "PATCH" ? { payload: { commentWordsInEmail: true } } : {}),
      });
      expect(response.statusCode, response.body).toBe(403);
    }
    expect(await settingsAuditRows(h.db)).toHaveLength(count);
    expect((await h.app.inject({ method: "GET", url, cookies })).json()).toEqual({
      commentWordsInEmail: false,
    });
  },
);

it("requires sign-in", async () => {
  for (const method of ["GET", "PATCH"] as const) {
    const response = await h.app.inject({
      method,
      url,
      ...(method === "PATCH" ? { payload: { commentWordsInEmail: true } } : {}),
    });
    expect(response.statusCode).toBe(401);
  }
});

it.each([
  {},
  { commentWordsInEmail: "false" },
  { commentWordsInEmail: null },
  { commentWordsInEmail: true, offsets: [90] },
])("rejects invalid input %j", async (payload) => {
  const response = await h.app.inject({ method: "PATCH", url, cookies, payload });
  expect(response.statusCode, response.body).toBe(400);
});
