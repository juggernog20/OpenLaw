// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { requireRole } from "../../auth/guards.js";
import { startHarness, TEST_AUTH_CONFIG, type TestHarness } from "../../testing/harness.js";

const ADMIN = {
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  password: "correct-horse-battery",
};

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

async function signIn(email: string, password: string) {
  return harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email, password },
  });
}

/** Signs in and returns the session cookie as a request `cookies` map. */
async function signInCookies(email: string, password: string) {
  const res = await signIn(email, password);
  expect(res.statusCode, res.body).toBe(200);
  const cookies: Record<string, string> = {};
  for (const c of res.cookies) cookies[c.name] = c.value;
  return cookies;
}

describe("password sign-in (mounted better-auth handler)", () => {
  it("signs in with correct credentials and sets a session cookie", async () => {
    const res = await signIn(ADMIN.email, ADMIN.password);
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c) => c.name.includes("session_token"));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
  });
});

describe("sign-in failure", () => {
  it("rejects a wrong password without revealing whether the account exists", async () => {
    const wrongPassword = await signIn(ADMIN.email, "not-the-password-123");
    const unknownAccount = await signIn("nobody@example.com", "not-the-password-123");

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    // Identical body and status — a caller cannot probe which emails have
    // accounts by comparing failure responses.
    expect(wrongPassword.json()).toEqual(unknownAccount.json());
    expect(wrongPassword.cookies.find((c) => c.name.includes("session_token"))).toBeUndefined();
  });
});

describe("GET /api/v1/me (requireAuth reference consumer)", () => {
  it("returns the signed-in user with their live role and session", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({
      email: ADMIN.email,
      displayName: ADMIN.displayName,
      role: "administrator",
    });
    expect(body.session.id).toEqual(expect.any(String));
    expect(new Date(body.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects requests without a session as problem+json", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 401 });
  });
});

describe("requireRole", () => {
  // Guard verified through test-only routes (same pattern as the echo
  // route in app.test.ts); its first production consumer is invites.
  let guarded: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    guarded = await buildApp({ db: harness.db, config: TEST_AUTH_CONFIG });
    guarded.get(
      "/api/v1/admin-only",
      { schema: { hide: true }, preHandler: requireRole("administrator") },
      async () => ({ ok: true }),
    );
    guarded.get(
      "/api/v1/legal-only",
      { schema: { hide: true }, preHandler: requireRole("legal_team_member") },
      async () => ({ ok: true }),
    );
    await guarded.ready();
  });

  afterAll(async () => {
    await guarded.close();
  });

  it("admits a user whose live role is allowed", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await guarded.inject({ method: "GET", url: "/api/v1/admin-only", cookies });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("rejects an authenticated user with the wrong role as 403 problem+json", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);
    const res = await guarded.inject({ method: "GET", url: "/api/v1/legal-only", cookies });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 403 });
  });

  it("rejects an unauthenticated request as 401", async () => {
    const res = await guarded.inject({ method: "GET", url: "/api/v1/admin-only" });
    expect(res.statusCode).toBe(401);
  });
});

describe("sign-out", () => {
  it("revokes the session server-side — a replayed cookie is dead", async () => {
    const cookies = await signInCookies(ADMIN.email, ADMIN.password);

    const before = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(before.statusCode).toBe(200);

    const signOut = await harness.app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      cookies,
      payload: {},
    });
    expect(signOut.statusCode, signOut.body).toBe(200);

    // Replaying the pre-sign-out cookie must fail: the session row is gone,
    // not merely the browser cookie cleared.
    const after = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(after.statusCode).toBe(401);
  });
});
