// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · General (#63): org identity on the single org_settings
 * row, behind SET-002's one role gate, with every change appending to
 * the activity log (SET-003 / DD-017). Asserted at the HTTP seam plus
 * direct activity_log reads — the log has no read routes until M9.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

const signInCookies = (email: string, password: string) =>
  harnessSignInCookies(harness.app, email, password);

const generalRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "org_settings.updated"))
    .orderBy(asc(activityLog.createdAt));

/** A tiny valid PNG (1×1 transparent pixel) as a data: URI. */
const PNG_LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
  "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/org/general" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and write", async () => {
    const cookies = await signInCookies(MEMBER.email, MEMBER.password);
    const read = await harness.app.inject({ method: "GET", url: "/api/v1/org/general", cookies });
    const write = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { name: "Not Allowed Inc" },
    });
    expect(read.statusCode).toBe(403);
    expect(write.statusCode).toBe(403);
    expect(write.headers["content-type"]).toContain("application/problem+json");
    // The refused write must not have landed.
    const admin = await signInCookies(ADMIN.email, ADMIN.password);
    const after = await harness.app.inject({
      method: "GET",
      url: "/api/v1/org/general",
      cookies: admin,
    });
    expect(after.json().general.name).not.toBe("Not Allowed Inc");
  });
});

describe("GET /org/general", () => {
  it("returns the seeded defaults on a fresh instance", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/org/general", cookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().general).toEqual({
      name: "",
      logo: null,
      defaultLocale: "en-US",
      defaultTimezone: "UTC",
    });
  });
});

describe("PATCH /org/general", () => {
  it("persists each field and a re-read reflects it", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const patched = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: {
        name: "Acme Inc",
        logo: PNG_LOGO,
        defaultTimezone: "America/Los_Angeles",
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    const res = await harness.app.inject({ method: "GET", url: "/api/v1/org/general", cookies });
    expect(res.json().general).toEqual({
      name: "Acme Inc",
      logo: PNG_LOGO,
      defaultLocale: "en-US",
      defaultTimezone: "America/Los_Angeles",
    });
  });

  it("clears the logo with null", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { logo: null },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().general.logo).toBeNull();
  });

  it("rejects a timezone that is not an IANA zone name", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { defaultTimezone: "Mars/Olympus_Mons" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("rejects a locale outside the shipped set", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { defaultLocale: "fr-FR" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("rejects a logo that is not an image data: URI", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { logo: "https://example.com/logo.png" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("rejects a blank name", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { name: "   " },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("the DD-017 audit trail", () => {
  it("appends one admin_only entry per changed field, with the actor", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const before = (await generalRows()).length;

    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { name: "Acme Holdings", defaultTimezone: "Europe/Berlin" },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = (await generalRows()).slice(before);
    expect(rows).toHaveLength(2);
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    for (const row of rows) {
      expect(row.entityType).toBe("system");
      expect(row.entityId).toBeNull();
      expect(row.visibility).toBe("admin_only");
      expect(row.actorId).toBe(me.json().user.id);
      expect(row.createdAt).toBeInstanceOf(Date);
    }
    expect(rows.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        { field: "name", old: "Acme Inc", new: "Acme Holdings" },
        { field: "defaultTimezone", old: "America/Los_Angeles", new: "Europe/Berlin" },
      ]),
    );
  });

  it("does not log a field patched to its current value", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const before = (await generalRows()).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { name: "Acme Holdings" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await generalRows()).toHaveLength(before);
  });

  it("records a logo change without embedding the image in the payload", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const before = (await generalRows()).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies,
      payload: { logo: PNG_LOGO },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = (await generalRows()).slice(before);
    expect(rows).toHaveLength(1);
    // Presence only: a data: URI in the payload would bloat every later
    // audit query with the encoded image.
    expect(rows[0]!.payload).toEqual({ field: "logo", old: null, new: "[image]" });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("base64");
  });
});
