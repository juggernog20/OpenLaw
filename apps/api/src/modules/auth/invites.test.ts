// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql, users, verifications } from "@openlaw/db";
import {
  signIn,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

const INVITEE = {
  email: "casey@example.com",
  displayName: "Casey Reyes",
  role: "legal_team_member",
};

let harness: TestHarness;
let adminCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

async function invite(cookies: Record<string, string>, payload: Record<string, string>) {
  return harness.app.inject({ method: "POST", url: "/api/v1/auth/invites", cookies, payload });
}

async function setPassword(token: string, newPassword: string) {
  return harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword, token },
  });
}

describe("invites (POST /api/v1/auth/invites)", () => {
  it("creates the user with the invited role and emails a set-password link", async () => {
    const res = await invite(adminCookies, INVITEE);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().user).toMatchObject(INVITEE);

    const mail = harness.mailer.messagesTo(INVITEE.email);
    expect(mail).toHaveLength(1);
    expect(tokenFrom(mail[0]!.text)).toBeTruthy();
  });

  it("refuses sign-in before activation — no credential exists yet", async () => {
    const res = await signIn(harness.app, INVITEE.email, "anything-at-all-1");
    expect(res.statusCode).toBe(401);
  });

  it("activates via the emailed token; the invitee signs in and /me shows the invited role", async () => {
    const token = tokenFrom(harness.mailer.messagesTo(INVITEE.email)[0]!.text);
    const password = "casey-sets-her-own";

    const reset = await setPassword(token, password);
    expect(reset.statusCode, reset.body).toBe(200);

    const cookies = await signInCookies(harness.app, INVITEE.email, password);
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().user).toMatchObject(INVITEE);
  });

  it("rejects invites from a non-Administrator as 403 problem+json", async () => {
    const cookies = await signInCookies(harness.app, INVITEE.email, "casey-sets-her-own");
    const res = await invite(cookies, {
      email: "sam@example.com",
      displayName: "Sam Field",
      role: "contributor",
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 403 });
  });

  it("re-sends the invite for an unactivated user; the fresh token activates", async () => {
    const second = { email: "sam@example.com", displayName: "Sam Field", role: "contributor" };
    const first = await invite(adminCookies, second);
    expect(first.statusCode, first.body).toBe(201);

    const resend = await invite(adminCookies, second);
    expect(resend.statusCode, resend.body).toBe(200);
    expect(resend.json().user).toMatchObject(second);

    const mail = harness.mailer.messagesTo(second.email);
    expect(mail).toHaveLength(2);

    const reset = await setPassword(tokenFrom(mail[1]!.text), "sam-sets-his-own-1");
    expect(reset.statusCode, reset.body).toBe(200);
    await signInCookies(harness.app, second.email, "sam-sets-his-own-1");
  });

  it("refuses to re-invite an activated user as 409", async () => {
    const res = await invite(adminCookies, INVITEE);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ status: 409 });
  });

  it("stores the set-password token hashed at rest", async () => {
    const third = { email: "noa@example.com", displayName: "Noa Lund", role: "contributor" };
    const res = await invite(adminCookies, third);
    expect(res.statusCode, res.body).toBe(201);

    const token = tokenFrom(harness.mailer.messagesTo(third.email)[0]!.text);
    const rows = await harness.db.select().from(verifications);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.identifier.includes(token) || row.value.includes(token))).toBe(
      false,
    );
  });

  it("rejects a replay of an already-used set-password token", async () => {
    const usedToken = tokenFrom(harness.mailer.messagesTo(INVITEE.email)[0]!.text);
    const res = await setPassword(usedToken, "attacker-chosen-pw-1");
    // A client error, never a server fault masquerading as a rejection.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    // The replay must not have changed the password set at activation.
    await signInCookies(harness.app, INVITEE.email, "casey-sets-her-own");
  });

  it("rejects an expired set-password token", async () => {
    // Age every outstanding token past its expiry — time travel via the
    // database, since the HTTP seam offers no clock.
    const token = tokenFrom(harness.mailer.messagesTo("noa@example.com")[0]!.text);
    await harness.db.update(verifications).set({ expiresAt: sql`now() - interval '1 minute'` });

    const res = await setPassword(token, "too-late-password-1");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    const signInRes = await signIn(harness.app, "noa@example.com", "too-late-password-1");
    expect(signInRes.statusCode).toBe(401);
  });

  it("rejects a re-invite that tries to change the role", async () => {
    // Noa is still unactivated (her token expired above) with role
    // contributor; a re-send is fine, a role edit is not an invite.
    const res = await invite(adminCookies, {
      email: "noa@example.com",
      displayName: "Noa Lund",
      role: "legal_team_member",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ status: 409 });
  });

  it("keeps better-auth's admin management endpoints closed ahead of their surface", async () => {
    // The plugin ships /api/auth/admin/* routes; no role carries the
    // permissions they check until the Settings management surface ships.
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/admin/create-user",
      cookies: adminCookies,
      payload: {
        email: "direct@example.com",
        name: "Direct Creation",
        password: "should-not-work-1",
        role: "administrator",
      },
    });
    // Denial must be a client error (401/403), never a server fault.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "direct@example.com"));
    expect(rows).toHaveLength(0);
  });
});
