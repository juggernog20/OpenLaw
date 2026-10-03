// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, activityLog, asc, desc, eq, sql, users, verifications } from "@openlaw/db";
import { storedVerificationIdentifier } from "../../auth/instance.js";
import {
  linkFrom,
  signIn,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  TEST_SMTP_ENV,
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
});

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
      role: "legal_team_member",
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 403 });
  });

  it("re-sends the invite for an unactivated user; the fresh token activates", async () => {
    const second = {
      email: "sam@example.com",
      displayName: "Sam Field",
      role: "legal_team_member",
    };
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
    const third = { email: "noa@example.com", displayName: "Noa Lund", role: "legal_team_member" };
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
    // legal_team_member; a re-send is fine, a role edit is not an invite.
    const res = await invite(adminCookies, {
      email: "noa@example.com",
      displayName: "Noa Lund",
      role: "administrator",
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

/** Invites the address as a Contributor and returns the created user's id. */
async function invitePending(email: string, displayName: string): Promise<string> {
  const res = await invite(adminCookies, { email, displayName, role: "legal_team_member" });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { user: { id: string } }).user.id;
}

describe("invite resend (POST /api/v1/auth/invites/:userId/resend, #65)", () => {
  it("re-emails the set-password link for a pending invite; the fresh token activates", async () => {
    const userId = await invitePending("riley@example.com", "Riley Novak");

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/auth/invites/${userId}/resend`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { user: { email: string } }).user.email).toBe("riley@example.com");

    const mail = harness.mailer.messagesTo("riley@example.com");
    expect(mail).toHaveLength(2);
    const reset = await setPassword(tokenFrom(mail[1]!.text), "riley-sets-her-own-1");
    expect(reset.statusCode, reset.body).toBe(200);
    await signInCookies(harness.app, "riley@example.com", "riley-sets-her-own-1");
  });

  it("keeps one live link when two resends race", async () => {
    const userId = await invitePending("sol@example.com", "Sol Adeyemi");
    const resend = () =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/auth/invites/${userId}/resend`,
        cookies: adminCookies,
      });
    const results = await Promise.all([resend(), resend()]);
    for (const res of results) expect(res.statusCode, res.body).toBe(200);

    const rows = await harness.db
      .select()
      .from(verifications)
      .where(eq(verifications.value, userId));
    expect(rows).toHaveLength(1);
    const mail = harness.mailer.messagesTo("sol@example.com");
    expect(mail).toHaveLength(3);
    // Whichever resend committed last owns the one row. Its link
    // activates; the other resend's link is dead.
    const tokens = [tokenFrom(mail[1]!.text), tokenFrom(mail[2]!.text)];
    const live = tokens.filter(
      (token) => rows[0]!.identifier === storedVerificationIdentifier(`reset-password:${token}`),
    );
    expect(live).toHaveLength(1);
    const dead = tokens.find((token) => token !== live[0])!;
    expect((await setPassword(dead, "sol-sets-his-own-1")).statusCode).not.toBe(200);
    const reset = await setPassword(live[0]!, "sol-sets-his-own-1");
    expect(reset.statusCode, reset.body).toBe(200);
    const [stored] = await harness.db
      .select({ inviteExpiresAt: users.inviteExpiresAt })
      .from(users)
      .where(eq(users.id, userId));
    expect(stored?.inviteExpiresAt).toBeInstanceOf(Date);
  });

  it("answers 404 for an unknown user id", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites/00000000-0000-7000-8000-000000000000/resend",
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to resend for an activated user as 409", async () => {
    const [riley] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "riley@example.com"));
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/auth/invites/${riley!.id}/resend`,
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(409);
  });

  it("is Administrator-only", async () => {
    const rileyCookies = await signInCookies(
      harness.app,
      "riley@example.com",
      "riley-sets-her-own-1",
    );
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites/00000000-0000-7000-8000-000000000000/resend",
      cookies: rileyCookies,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("invite revoke (DELETE /api/v1/auth/invites/:userId, #65)", () => {
  it("removes the pending invite and its emailed link stops working", async () => {
    const userId = await invitePending("quinn@example.com", "Quinn Baptiste");
    const token = tokenFrom(harness.mailer.messagesTo("quinn@example.com")[0]!.text);

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/auth/invites/${userId}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);

    const rows = await harness.db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    expect(rows).toHaveLength(0);

    // The revoked link is dead: setting a password through it fails as a
    // client error, and the address cannot sign in.
    const reset = await setPassword(token, "quinn-too-late-1");
    expect(reset.statusCode).toBeGreaterThanOrEqual(400);
    expect(reset.statusCode).toBeLessThan(500);
    const attempt = await signIn(harness.app, "quinn@example.com", "quinn-too-late-1");
    expect(attempt.statusCode).toBe(401);
  });

  it("answers 404 for an unknown user id", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/auth/invites/00000000-0000-7000-8000-000000000000",
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it("is Administrator-only: a Member's revoke bounces as 403 and the invite stays", async () => {
    const userId = await invitePending("tao@example.com", "Tao Lin");
    const rileyCookies = await signInCookies(
      harness.app,
      "riley@example.com",
      "riley-sets-her-own-1",
    );
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/auth/invites/${userId}`,
      cookies: rileyCookies,
    });
    expect(res.statusCode).toBe(403);
    const rows = await harness.db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    expect(rows).toHaveLength(1);
  });

  it("refuses to revoke an activated user as 409 — that would be deletion, not revocation", async () => {
    const [riley] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "riley@example.com"));
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/auth/invites/${riley!.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(409);
    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "riley@example.com"));
    expect(rows).toHaveLength(1);
  });
});

describe("the DD-017 audit trail (#65)", () => {
  async function entriesFor(action: string) {
    return harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, action))
      .orderBy(asc(activityLog.createdAt));
  }

  it("logs an invite as user.invited with the actor, email, and role", async () => {
    const before = (await entriesFor("user.invited")).length;
    const userId = await invitePending("ash@example.com", "Ash Moreau");

    const entries = await entriesFor("user.invited");
    expect(entries.length).toBe(before + 1);
    const entry = entries.at(-1)!;
    expect(entry).toMatchObject({
      entityType: "user",
      entityId: userId,
      visibility: "admin_only",
      payload: { email: "ash@example.com", role: "legal_team_member" },
    });
    expect(entry.actorId).toBeTruthy();
  });

  it("logs a resend as user.invite_resent — through the resend route and the invite route alike", async () => {
    const [ash] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "ash@example.com"));
    const before = (await entriesFor("user.invite_resent")).length;

    const viaResend = await harness.app.inject({
      method: "POST",
      url: `/api/v1/auth/invites/${ash!.id}/resend`,
      cookies: adminCookies,
    });
    expect(viaResend.statusCode, viaResend.body).toBe(200);

    const viaInvite = await invite(adminCookies, {
      email: "ash@example.com",
      displayName: "Ash Moreau",
      role: "legal_team_member",
    });
    expect(viaInvite.statusCode, viaInvite.body).toBe(200);

    const entries = await entriesFor("user.invite_resent");
    expect(entries.length).toBe(before + 2);
    expect(entries.at(-1)).toMatchObject({
      entityType: "user",
      entityId: ash!.id,
      visibility: "admin_only",
      payload: { email: "ash@example.com" },
    });
  });

  it("logs a revoke as user.invite_revoked", async () => {
    const [ash] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "ash@example.com"));
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/auth/invites/${ash!.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);

    const entries = await entriesFor("user.invite_revoked");
    expect(entries.at(-1)).toMatchObject({
      entityType: "user",
      entityId: ash!.id,
      visibility: "admin_only",
      payload: { email: "ash@example.com", role: "legal_team_member" },
    });
  });
});

it("activates magic-link-only staff and refuses every invite mutation after sign-out", async () => {
  const invitee = {
    email: "magic-staff@example.com",
    displayName: "Magic Staff",
    role: "legal_team_member",
  };
  const invited = await invite(adminCookies, invitee);
  expect(invited.statusCode, invited.body).toBe(201);
  const id = invited.json().user.id as string;
  const enabled = await harness.app.inject({
    method: "PATCH",
    url: "/api/v1/auth/policy/legal",
    cookies: adminCookies,
    payload: { password: true, magicLink: true, sso: false, requireTwoFactor: false },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const issued = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/magic-link",
    payload: { email: invitee.email, group: "legal" },
  });
  expect(issued.statusCode, issued.body).toBe(202);
  const link = new URL(linkFrom(harness.mailer.messagesTo(invitee.email).at(-1)!.text));
  const redeemed = await harness.app.inject({ method: "GET", url: link.pathname + link.search });
  expect(redeemed.statusCode, redeemed.body).toBe(302);
  expect(redeemed.headers.location).not.toContain("error");
  expect(await harness.db.select().from(accounts).where(eq(accounts.userId, id))).toEqual([]);
  const cookies = Object.fromEntries(redeemed.cookies.map((cookie) => [cookie.name, cookie.value]));
  const signedOut = await harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    cookies,
    payload: {},
  });
  expect(signedOut.statusCode, signedOut.body).toBe(200);
  const listed = await harness.app.inject({
    method: "GET",
    url: "/api/v1/users",
    cookies: adminCookies,
  });
  expect(listed.json().users).toContainEqual(
    expect.objectContaining({ id, status: "active", lastActiveAt: expect.any(String) }),
  );
  expect((await invite(adminCookies, invitee)).statusCode).toBe(409);
  for (const method of ["POST", "DELETE"] as const) {
    const response = await harness.app.inject({
      method,
      url: `/api/v1/auth/invites/${id}${method === "POST" ? "/resend" : ""}`,
      cookies: adminCookies,
    });
    expect(response.statusCode, response.body).toBe(409);
  }
  expect(await harness.db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
});

describe("invites while the instance cannot send email (#889)", () => {
  const PENDING = {
    email: "marlowe@example.com",
    displayName: "Marlowe Ito",
    role: "legal_team_member",
  };
  let pendingId: string;

  beforeAll(async () => {
    // A pending invite created while email worked, for the resend arms.
    const res = await invite(adminCookies, PENDING);
    expect(res.statusCode, res.body).toBe(201);
    pendingId = res.json().user.id;
  });

  /** `SMTP_URL` set with `SMTP_FROM` unset: the environment pins the
   * instance, and the effective mailer is the unconfigured one. */
  async function withoutFrom(run: () => Promise<void>) {
    const sent = harness.mailer.messages.length;
    harness.smtpEnv = { url: TEST_SMTP_ENV.url, from: null };
    try {
      await run();
    } finally {
      harness.smtpEnv = TEST_SMTP_ENV;
    }
    expect(harness.mailer.messages).toHaveLength(sent);
  }

  const REFUSAL = {
    status: 409,
    type: "/problems/email-setup-required",
    detail: expect.stringMatching(/cannot send email\. Set SMTP_URL and SMTP_FROM together/),
  };

  it("refuses a new invite and creates no Invited row", async () => {
    await withoutFrom(async () => {
      const res = await invite(adminCookies, {
        email: "ghost@example.com",
        displayName: "Ghost Invite",
        role: "legal_team_member",
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json()).toMatchObject(REFUSAL);
    });
    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "ghost@example.com"));
    expect(rows).toEqual([]);
  });

  it("refuses to re-invite a pending address the same way", async () => {
    await withoutFrom(async () => {
      const res = await invite(adminCookies, PENDING);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject(REFUSAL);
    });
  });

  it("refuses a resend from the row", async () => {
    await withoutFrom(async () => {
      const res = await harness.app.inject({
        method: "POST",
        url: `/api/v1/auth/invites/${pendingId}/resend`,
        cookies: adminCookies,
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject(REFUSAL);
    });
  });

  it("sends again once the environment names a sender", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/auth/invites/${pendingId}/resend`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(harness.mailer.messagesTo(PENDING.email)).toHaveLength(2);
  });
});

describe("the invite link lifetime (SET-005 addendum, #1288)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** The user's live set-password tokens. Value is the plain user id. */
  function tokensOf(userId: string) {
    return harness.db.select().from(verifications).where(eq(verifications.value, userId));
  }

  async function setLifetime(days: number, cookies = adminCookies) {
    return harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/invite-policy",
      cookies,
      payload: { inviteLinkLifetimeDays: days },
    });
  }

  it("seeds 7 days, and an invite token lives that long", async () => {
    const policy = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/invite-policy",
      cookies: adminCookies,
    });
    expect(policy.statusCode, policy.body).toBe(200);
    expect(policy.json()).toEqual({ inviteLinkLifetimeDays: 7 });

    const before = Date.now();
    const res = await invite(adminCookies, {
      email: "hannah.brooks@example.com",
      displayName: "Hannah Brooks",
      role: "legal_team_member",
    });
    expect(res.statusCode, res.body).toBe(201);
    const { user, inviteExpiresAt } = res.json() as {
      user: { id: string };
      inviteExpiresAt: string;
    };
    const expires = new Date(inviteExpiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(expires).toBeLessThanOrEqual(Date.now() + 7 * DAY);

    const [token] = await tokensOf(user.id);
    expect(token!.expiresAt.toISOString()).toBe(inviteExpiresAt);

    // The Invited row says when the link stops working.
    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/users",
      cookies: adminCookies,
    });
    expect(listed.json().users).toContainEqual(
      expect.objectContaining({ id: user.id, status: "invited", inviteExpiresAt }),
    );
  });

  it("redeems an invite token until its expiry and refuses it after", async () => {
    const live = await invitePending("ines.alves@example.com", "Ines Alves");
    const stale = await invitePending("omar.haddad@example.com", "Omar Haddad");
    const liveToken = tokenFrom(harness.mailer.messagesTo("ines.alves@example.com").at(-1)!.text);
    const staleToken = tokenFrom(harness.mailer.messagesTo("omar.haddad@example.com").at(-1)!.text);

    // Long past the 1 hour a reset keeps, the invite still works one
    // minute before its own expiry.
    await harness.db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(verifications.value, live));
    await harness.db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(verifications.value, stale));

    expect((await setPassword(liveToken, "ines-sets-her-own-1")).statusCode).toBe(200);
    const refused = await setPassword(staleToken, "omar-too-late-1");
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(refused.statusCode).toBeLessThan(500);
  });

  it("keeps the 1 hour lifetime for a password reset", async () => {
    const [admin] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, TEST_ADMIN.email));
    const before = Date.now();
    const asked = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/password-setup",
      payload: { email: TEST_ADMIN.email },
    });
    expect(asked.statusCode, asked.body).toBe(202);
    const mail = harness.mailer.messagesTo(TEST_ADMIN.email).at(-1)!;
    expect(mail.subject).toBe("Set your OpenLaw password");
    const [token] = await tokensOf(admin!.id);
    const expires = token!.expiresAt.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 1000);
  });

  it("kills the earlier invite link after a resend", async () => {
    const userId = await invitePending("leo.marsh@example.com", "Leo Marsh");
    const first = tokenFrom(harness.mailer.messagesTo("leo.marsh@example.com").at(-1)!.text);

    const resent = await harness.app.inject({
      method: "POST",
      url: `/api/v1/auth/invites/${userId}/resend`,
      cookies: adminCookies,
    });
    expect(resent.statusCode, resent.body).toBe(200);
    expect(resent.json().inviteExpiresAt).toEqual(expect.any(String));
    const second = tokenFrom(harness.mailer.messagesTo("leo.marsh@example.com").at(-1)!.text);
    expect(second).not.toBe(first);
    expect(await tokensOf(userId)).toHaveLength(1);

    const refused = await setPassword(first, "leo-old-link-1");
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(refused.statusCode).toBeLessThan(500);
    expect((await setPassword(second, "leo-new-link-1")).statusCode).toBe(200);
  });

  it("names the expiry and Resend invite, and magic link sign-in only when it is on", async () => {
    await invitePending("mia.chen@example.com", "Mia Chen");
    const withLink = harness.mailer.messagesTo("mia.chen@example.com").at(-1)!;
    expect(withLink.subject).toBe("You are invited to OpenLaw");
    expect(withLink.text).toMatch(/The link expires in 7 days, on [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    expect(withLink.text).toContain(
      "If the link has expired, ask your Administrator to resend the invite.",
    );
    expect(withLink.text).toContain("You can also sign in with an email link.");
    expect(withLink.html).toContain("ask your Administrator to resend the invite");

    const policy = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/policy/legal",
      cookies: adminCookies,
      payload: { password: true, magicLink: false, sso: false, requireTwoFactor: false },
    });
    expect(policy.statusCode, policy.body).toBe(200);
    expect((await setLifetime(1)).statusCode).toBe(200);
    try {
      await invitePending("nils.berg@example.com", "Nils Berg");
      const withoutLink = harness.mailer.messagesTo("nils.berg@example.com").at(-1)!;
      expect(withoutLink.text).toContain("The link expires in 1 day, on ");
      expect(withoutLink.text).not.toContain("email link");
      expect(withoutLink.html).not.toContain("email link");
    } finally {
      await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/auth/policy/legal",
        cookies: adminCookies,
        payload: { password: true, magicLink: true, sso: false, requireTwoFactor: false },
      });
      await setLifetime(7);
    }
  });

  it("bounds the lifetime to 1 to 30 days, logs a change, and holds the Administrator gate", async () => {
    expect((await setLifetime(0)).statusCode).toBe(400);
    expect((await setLifetime(31)).statusCode).toBe(400);

    const changed = await setLifetime(30);
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual({ inviteLinkLifetimeDays: 30 });
    const [entry] = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "org_settings.updated"))
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    expect(entry).toMatchObject({
      visibility: "admin_only",
      payload: { field: "inviteLinkLifetimeDays", old: 7, new: 30 },
    });
    expect((await setLifetime(7)).statusCode).toBe(200);

    const member = await signInCookies(harness.app, INVITEE.email, "casey-sets-her-own");
    expect((await setLifetime(10, member)).statusCode).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/auth/invite-policy",
          cookies: member,
        })
      ).statusCode,
    ).toBe(403);
  });
});
