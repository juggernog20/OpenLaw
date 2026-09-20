// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, sessions, sql, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let staff: Record<string, string>;
let portal: Record<string, string>;
let portalId: string;
const subscription = (name: string) => ({
  endpoint: `https://push.example.com/${name}`,
  keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
});

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  staff = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const person = {
    email: "push-portal@example.com",
    displayName: "Portal Reader",
    password: TEST_ADMIN.password,
  };
  portalId = (await provisionUser(harness.app.auth, person)).id;
  portal = await signInCookies(harness.app, person.email, person.password);
});
afterAll(async () => harness?.stop());

for (const mount of ["/notifications", "/portal/notifications"]) {
  describe(mount, () => {
    it("lists, registers, refreshes and revokes this person's browsers, with audit entries", async () => {
      const cookies = mount === "/notifications" ? staff : portal;
      const path = `/api/v1${mount}/subscriptions`;
      const post = () =>
        harness.app.inject({
          method: "POST",
          url: path,
          cookies,
          headers: { "user-agent": "Test browser" },
          payload: subscription(mount.slice(1)),
        });
      const created = await post();
      expect(created.statusCode, created.body).toBe(200);
      const saved = created.json().subscription;
      expect(saved.userAgent).toBe("Test browser");
      expect(saved.currentSession).toBe(true);
      const again = await post();
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().subscription.id).toBe(saved.id);
      const list = await harness.app.inject({ url: path, cookies });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().subscriptions).toHaveLength(1);
      expect(list.body).not.toContain('"keys"');
      const removed = await harness.app.inject({
        method: "DELETE",
        url: `${path}/${saved.id}`,
        cookies,
      });
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await harness.app.inject({ url: path, cookies })).json().subscriptions).toEqual([]);
      const audit = await harness.db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.action, "user.notification_preference_changed"),
            sql`${activityLog.payload}->>'subscriptionId' = ${saved.id}`,
          ),
        );
      expect(audit.map((row) => row.payload.enabled)).toEqual([true, true, false]);
    });
  });
}

it("moves an existing browser to the user's new session", async () => {
  const path = "/api/v1/notifications/subscriptions";
  const payload = subscription("new-sign-in");
  const first = await harness.app.inject({ method: "POST", url: path, cookies: staff, payload });
  expect(first.statusCode, first.body).toBe(200);
  const [old] = (
    await harness.db.execute<{ session_id: string }>(
      sql`select session_id from push_subscriptions where endpoint = ${payload.endpoint}`,
    )
  ).rows;
  const next = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const second = await harness.app.inject({ method: "POST", url: path, cookies: next, payload });
  expect(second.statusCode, second.body).toBe(200);
  expect(second.json().subscription.id).toBe(first.json().subscription.id);
  const [current] = (
    await harness.db.execute<{ session_id: string }>(
      sql`select session_id from push_subscriptions where endpoint = ${payload.endpoint}`,
    )
  ).rows;
  expect(current!.session_id).not.toBe(old!.session_id);
  await harness.db.delete(sessions).where(eq(sessions.id, old!.session_id));
  staff = next;
  expect(
    (await harness.app.inject({ url: path, cookies: staff })).json().subscriptions,
  ).toHaveLength(1);
  expect(
    (
      await harness.app.inject({
        method: "DELETE",
        url: `${path}/${first.json().subscription.id}`,
        cookies: staff,
      })
    ).statusCode,
  ).toBe(204);
});

it("rebinds an endpoint to a second person and session, then cascades on session deletion", async () => {
  const path = "/api/v1/portal/notifications/subscriptions";
  const payload = subscription("shared-browser");
  const first = await harness.app.inject({ method: "POST", url: path, cookies: staff, payload });
  expect(first.statusCode, first.body).toBe(200);
  const second = await harness.app.inject({ method: "POST", url: path, cookies: portal, payload });
  expect(second.statusCode, second.body).toBe(200);
  expect(second.json().subscription.id).toBe(first.json().subscription.id);
  expect((await harness.app.inject({ url: path, cookies: staff })).json().subscriptions).toEqual(
    [],
  );
  const forbidden = await harness.app.inject({
    method: "DELETE",
    url: `${path}/${first.json().subscription.id}`,
    cookies: staff,
  });
  expect(forbidden.statusCode, forbidden.body).toBe(404);
  const rows = await harness.db.execute<{ user_id: string; session_id: string }>(
    sql`select user_id, session_id from push_subscriptions where endpoint = ${payload.endpoint}`,
  );
  expect(rows.rows[0]!.user_id).toBe(portalId);
  const [session] = await harness.db
    .select()
    .from(sessions)
    .where(eq(sessions.id, rows.rows[0]!.session_id));
  expect(session!.userId).toBe(portalId);
  await harness.db.delete(sessions).where(eq(sessions.id, session!.id));
  expect(
    (
      await harness.db.execute(
        sql`select id from push_subscriptions where endpoint = ${payload.endpoint}`,
      )
    ).rows,
  ).toEqual([]);
});

it("caps concurrent registrations at ten while allowing an existing endpoint to refresh", async () => {
  const path = "/api/v1/notifications/subscriptions";
  const results = await Promise.all(
    Array.from({ length: 11 }, (_, i) =>
      harness.app.inject({
        method: "POST",
        url: path,
        cookies: staff,
        payload: subscription(`cap-${i}`),
      }),
    ),
  );
  expect(results.filter((res) => res.statusCode === 200)).toHaveLength(10);
  expect(results.filter((res) => res.statusCode === 409)).toHaveLength(1);
  const list = (await harness.app.inject({ url: path, cookies: staff })).json().subscriptions;
  expect(list).toHaveLength(10);
  const refresh = await harness.app.inject({
    method: "POST",
    url: path,
    cookies: staff,
    payload: { ...subscription("unused"), endpoint: list[0].endpoint },
  });
  expect(refresh.statusCode, refresh.body).toBe(200);
});

it("rejects unauthenticated and malformed subscriptions", async () => {
  const path = "/api/v1/notifications/subscriptions";
  expect(
    (await harness.app.inject({ method: "POST", url: path, payload: subscription("anonymous") }))
      .statusCode,
  ).toBe(401);
  for (const payload of [
    { ...subscription("bad"), endpoint: "http://push.example.com/plain" },
    { ...subscription("bad"), keys: { p256dh: "", auth: "" } },
  ]) {
    expect(
      (await harness.app.inject({ method: "POST", url: path, cookies: staff, payload })).statusCode,
    ).toBe(400);
  }
});

it("reads and audits the record-names switch", async () => {
  const path = "/api/v1/me/notification-preferences";
  expect(
    (await harness.app.inject({ url: path, cookies: staff })).json().showRecordNamesOnDevices,
  ).toBe(true);
  const saved = await harness.app.inject({
    method: "PATCH",
    url: path,
    cookies: staff,
    payload: { showRecordNamesOnDevices: false },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().showRecordNamesOnDevices).toBe(false);
  expect(
    (await harness.app.inject({ url: path, cookies: staff })).json().showRecordNamesOnDevices,
  ).toBe(false);
  const [user] = await harness.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  const audit = await harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, user!.id),
        eq(activityLog.action, "user.notification_preference_changed"),
        sql`${activityLog.payload}->>'showRecordNamesOnDevices' = 'false'`,
      ),
    );
  expect(audit).toHaveLength(1);
});
