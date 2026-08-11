// SPDX-License-Identifier: AGPL-3.0-only

/**
 * User preferences on /me/preferences: the theme (#44) and the DES-014
 * timezone override (SET-006, #67). Both ride the user record, so they
 * follow the person across browsers. GET /me carries them; PATCH
 * /me/preferences changes them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq } from "@openlaw/db";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

const signInCookies = () => harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);

describe("theme preference (#44)", () => {
  it("defaults to light on GET /me", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user.theme).toBe("light");
  });

  it("PATCH /me/preferences updates the theme and GET /me reflects it", async () => {
    const cookies = await signInCookies();
    const patched = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "warm" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().user.theme).toBe("warm");

    // Persisted on the user record, not the session: a fresh sign-in
    // (fresh cookie jar) still sees it.
    const fresh = await signInCookies();
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: fresh });
    expect(me.json().user.theme).toBe("warm");
  });

  it("rejects a theme outside light/warm/dark", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "solarized" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      payload: { theme: "dark" },
    });
    expect(res.statusCode, res.body).toBe(401);
  });
});

describe("timezone preference (SET-006, #67)", () => {
  it("defaults to null on GET /me — use the browser's timezone (DES-014)", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user.timezone).toBeNull();
  });

  it("PATCH round-trips an IANA zone and null clears it back to the browser default", async () => {
    const cookies = await signInCookies();
    const patched = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { timezone: "Europe/Berlin" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().user.timezone).toBe("Europe/Berlin");

    // Persisted on the user record: a fresh cookie jar still sees it.
    const fresh = await signInCookies();
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: fresh });
    expect(me.json().user.timezone).toBe("Europe/Berlin");

    const cleared = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { timezone: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().user.timezone).toBeNull();
  });

  it("rejects a name outside the IANA zone list", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { timezone: "Mars/Olympus_Mons" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("rejects an empty patch", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("the DD-017 audit trail (#63)", () => {
  const themeRows = () =>
    harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "user.theme_changed"))
      .orderBy(asc(activityLog.createdAt));

  it("appends an entry with the actor when the theme changes", async () => {
    const cookies = await signInCookies();
    const before = (await themeRows()).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "dark" },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = (await themeRows()).slice(before);
    expect(rows).toHaveLength(1);
    const userId = res.json().user.id;
    expect(rows[0]).toMatchObject({
      entityType: "user",
      entityId: userId,
      actorId: userId,
      visibility: "admin_only",
      payload: { field: "theme", old: expect.any(String), new: "dark" },
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("does not log a theme patched to its current value", async () => {
    const cookies = await signInCookies();
    await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "dark" },
    });
    const before = (await themeRows()).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "dark" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await themeRows()).toHaveLength(before);
  });

  it("appends one entry per changed preference — timezone rides its own slug", async () => {
    const timezoneRows = () =>
      harness.db
        .select()
        .from(activityLog)
        .where(eq(activityLog.action, "user.timezone_changed"))
        .orderBy(asc(activityLog.createdAt));
    const cookies = await signInCookies();
    const before = (await timezoneRows()).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { timezone: "Asia/Dubai" },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = (await timezoneRows()).slice(before);
    expect(rows).toHaveLength(1);
    const userId = res.json().user.id;
    expect(rows[0]).toMatchObject({
      entityType: "user",
      entityId: userId,
      actorId: userId,
      visibility: "admin_only",
      payload: { field: "timezone", new: "Asia/Dubai" },
    });

    // Clearing back to the browser default is a change too — old/new
    // record the transition to null.
    const cleared = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { timezone: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    const afterClear = (await timezoneRows()).slice(before);
    expect(afterClear).toHaveLength(2);
    expect(afterClear[1]!.payload).toMatchObject({
      field: "timezone",
      old: "Asia/Dubai",
      new: null,
    });

    // A no-op patch (already null) appends nothing.
    const noop = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { timezone: null },
    });
    expect(noop.statusCode, noop.body).toBe(200);
    expect((await timezoneRows()).slice(before)).toHaveLength(2);
  });
});
