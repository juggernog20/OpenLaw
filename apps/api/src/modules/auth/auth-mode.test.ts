// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auth-mode switching and its TECH-008 semantics: `oidc` closes password
 * sign-in for everyone but Administrators (break-glass), switching never
 * touches live sessions, and archived users are refused a session on
 * every path (the SSO path is covered in sso.test.ts, where the mock IdP
 * lives).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, orgSettings, sql, users } from "@openlaw/db";
import {
  settingsAuditRows,
  signIn,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;

const STAFF = {
  email: "louis@example.com",
  displayName: "Louis Braithwaite",
  password: "louis-sets-his-own",
} as const;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  await harness.db.update(orgSettings).set({ allowedEmailDomains: ["acme.example"] });
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  // An activated non-admin staffer: the break-glass tests need someone
  // with a password who is not an Administrator.
  const invited = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: adminCookies,
    payload: { email: STAFF.email, displayName: STAFF.displayName, role: "legal_team_member" },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const token = tokenFrom(harness.mailer.messagesTo(STAFF.email)[0]!.text);
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: STAFF.password, token },
  });
  expect(reset.statusCode, reset.body).toBe(200);
});

afterAll(async () => {
  await harness.stop();
});

async function getMode(cookies?: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/auth/mode", cookies });
}

async function setMode(mode: string, cookies: Record<string, string> = adminCookies) {
  return harness.app.inject({
    method: "PATCH",
    url: "/api/v1/auth/mode",
    cookies,
    payload: { mode },
  });
}

/** Switches mode as test setup — asserts the switch actually landed. */
async function enterMode(mode: "built_in" | "oidc") {
  const res = await setMode(mode);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toEqual({ mode });
}

function hasSessionCookie(res: { cookies: { name: string; value: string }[] }): boolean {
  return res.cookies.some((c) => c.name.includes("session_token") && c.value);
}

describe("auth mode (GET/PATCH /api/v1/auth/mode)", () => {
  it("is an Administrator-only surface", async () => {
    expect((await getMode()).statusCode).toBe(401);

    const staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
    const read = await getMode(staffCookies);
    expect(read.statusCode).toBe(403);
    expect(read.headers["content-type"]).toContain("application/problem+json");
    expect((await setMode("oidc", staffCookies)).statusCode).toBe(403);

    const admin = await getMode(adminCookies);
    expect(admin.statusCode, admin.body).toBe(200);
    expect(admin.json()).toEqual({ mode: "built_in" });
  });

  it("switches modes and reads back the new value", async () => {
    try {
      const switched = await setMode("oidc");
      expect(switched.statusCode, switched.body).toBe(200);
      expect(switched.json()).toEqual({ mode: "oidc" });
      expect((await getMode(adminCookies)).json()).toEqual({ mode: "oidc" });
    } finally {
      expect((await setMode("built_in")).statusCode).toBe(200);
    }
  });

  it("rejects a value outside the mode vocabulary", async () => {
    const res = await setMode("ldap");
    expect(res.statusCode).toBe(400);
    expect((await getMode(adminCookies)).json()).toEqual({ mode: "built_in" });
  });
});

describe("login method discovery (GET /api/v1/auth/methods)", () => {
  it("tells an anonymous visitor what the login screen may offer", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      mode: "built_in",
      magicLinkEnabled: true,
      emailConfigured: true,
      ssoProviderId: null,
    });
  });

  it("reports a deployment that cannot send email, so the screen can hide the affordance", async () => {
    harness.mailer.configured = false;
    try {
      const res = await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" });
      expect(res.statusCode, res.body).toBe(200);
      // The toggle stays on: the org still wants the portal floor, the
      // deployment just cannot deliver. The two are reported separately.
      expect(res.json()).toMatchObject({ magicLinkEnabled: true, emailConfigured: false });
    } finally {
      harness.mailer.configured = true;
    }
  });

  it("tracks the auth mode and the magic-link toggle live", async () => {
    await enterMode("oidc");
    await harness.db.update(orgSettings).set({ magicLinkEnabled: false });
    try {
      const res = await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ mode: "oidc", magicLinkEnabled: false });
    } finally {
      await harness.db.update(orgSettings).set({ magicLinkEnabled: true });
      await enterMode("built_in");
    }
  });
});

describe("oidc-mode semantics (break-glass)", () => {
  it("closes password sign-in for non-administrators without revealing accounts", async () => {
    await enterMode("oidc");
    try {
      const staff = await signIn(harness.app, STAFF.email, STAFF.password);
      const unknown = await signIn(harness.app, "nobody@example.com", "whatever-password");
      expect(staff.statusCode).toBe(403);
      // Identical refusals — the response never says whether the account
      // exists or what the password was.
      expect(unknown.statusCode).toBe(403);
      expect(unknown.body).toBe(staff.body);
      expect(hasSessionCookie(staff)).toBe(false);
    } finally {
      await enterMode("built_in");
    }
  });

  it("keeps password sign-in open for Administrators (break-glass is never disabled)", async () => {
    await enterMode("oidc");
    try {
      const res = await signIn(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
      expect(res.statusCode, res.body).toBe(200);
      expect(hasSessionCookie(res)).toBe(true);
    } finally {
      await enterMode("built_in");
    }
  });

  it("never invalidates live sessions when the mode switches", async () => {
    const staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
    await enterMode("oidc");
    try {
      // The staffer could not sign in NOW, but the session they already
      // hold keeps working in both directions of the switch.
      const during = await harness.app.inject({
        method: "GET",
        url: "/api/v1/me",
        cookies: staffCookies,
      });
      expect(during.statusCode, during.body).toBe(200);
    } finally {
      await enterMode("built_in");
    }
    const after = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: staffCookies,
    });
    expect(after.statusCode, after.body).toBe(200);
  });

  it("keeps the magic-link portal floor open in oidc mode", async () => {
    await enterMode("oidc");
    try {
      const email = "requester@acme.example";
      const issue = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/magic-link",
        payload: { email },
      });
      expect(issue.statusCode, issue.body).toBe(202);
      const link = /(https?:\/\/\S*\/api\/auth\/magic-link\/verify\?\S+)/.exec(
        harness.mailer.messagesTo(email).at(-1)!.text,
      )![1]!;
      const url = new URL(link);
      const redeemed = await harness.app.inject({ method: "GET", url: url.pathname + url.search });
      expect(hasSessionCookie(redeemed), "portal magic link must survive oidc mode").toBe(true);
    } finally {
      await enterMode("built_in");
    }
  });
});

describe("the DD-017 audit trail (#64)", () => {
  const settingsRows = () => settingsAuditRows(harness.db);

  it("logs a mode switch as an admin_only org_settings entry with the actor", async () => {
    const before = (await settingsRows()).length;
    await enterMode("oidc");
    try {
      const rows = (await settingsRows()).slice(before);
      expect(rows).toHaveLength(1);
      const me = await harness.app.inject({
        method: "GET",
        url: "/api/v1/me",
        cookies: adminCookies,
      });
      expect(rows[0]).toMatchObject({
        entityType: "system",
        entityId: null,
        actorId: me.json().user.id,
        visibility: "admin_only",
        payload: { field: "authMode", old: "built_in", new: "oidc" },
      });
    } finally {
      await enterMode("built_in");
    }
  });

  it("does not log a switch to the mode already in force", async () => {
    const before = (await settingsRows()).length;
    await enterMode("built_in");
    expect(await settingsRows()).toHaveLength(before);
  });
});

describe("archived users are refused at session creation", () => {
  async function archive(email: string, archived: boolean) {
    await harness.db
      .update(users)
      .set({ archivedAt: archived ? sql`now()` : null })
      .where(eq(users.email, email));
  }

  it("rejects password sign-in for an archived user", async () => {
    await archive(STAFF.email, true);
    try {
      const res = await signIn(harness.app, STAFF.email, STAFF.password);
      expect(res.statusCode).toBe(403);
      expect(hasSessionCookie(res)).toBe(false);
    } finally {
      await archive(STAFF.email, false);
    }
  });

  it("rejects magic-link redemption for an archived user", async () => {
    // Born via the portal: a JIT Business User, then archived.
    const email = "former@acme.example";
    const issueFor = async () => {
      const issue = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/magic-link",
        payload: { email },
      });
      expect(issue.statusCode, issue.body).toBe(202);
      const link = /(https?:\/\/\S*\/api\/auth\/magic-link\/verify\?\S+)/.exec(
        harness.mailer.messagesTo(email).at(-1)!.text,
      )![1]!;
      const url = new URL(link);
      return harness.app.inject({ method: "GET", url: url.pathname + url.search });
    };

    expect(hasSessionCookie(await issueFor()), "first redemption provisions and signs in").toBe(
      true,
    );

    await archive(email, true);
    try {
      const redeemed = await issueFor();
      expect(redeemed.statusCode, redeemed.body).toBe(403);
      expect(hasSessionCookie(redeemed), "archived user must not get a session").toBe(false);
    } finally {
      await archive(email, false);
    }
  });
});
