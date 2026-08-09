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
  signIn,
  signInCookies,
  startHarness,
  TEST_ADMIN,
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
  const token = /\/auth\/set-password\?token=([A-Za-z0-9._~-]+)/.exec(
    harness.mailer.messagesTo(STAFF.email)[0]!.text,
  )![1]!;
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: STAFF.password, token },
  });
  expect(reset.statusCode, reset.body).toBe(200);
}, 120_000);

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

describe("oidc-mode semantics (break-glass)", () => {
  it("closes password sign-in for non-administrators without revealing accounts", async () => {
    await setMode("oidc");
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
      await setMode("built_in");
    }
  });

  it("keeps password sign-in open for Administrators (break-glass is never disabled)", async () => {
    await setMode("oidc");
    try {
      const res = await signIn(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
      expect(res.statusCode, res.body).toBe(200);
      expect(hasSessionCookie(res)).toBe(true);
    } finally {
      await setMode("built_in");
    }
  });

  it("never invalidates live sessions when the mode switches", async () => {
    const staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
    await setMode("oidc");
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
      await setMode("built_in");
    }
    const after = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: staffCookies,
    });
    expect(after.statusCode, after.body).toBe(200);
  });

  it("keeps the magic-link portal floor open in oidc mode", async () => {
    await setMode("oidc");
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
      await setMode("built_in");
    }
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
      expect(hasSessionCookie(redeemed), "archived user must not get a session").toBe(false);
    } finally {
      await archive(email, false);
    }
  });
});
