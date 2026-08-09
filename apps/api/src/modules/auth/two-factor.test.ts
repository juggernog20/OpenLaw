// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, orgSettings, twoFactors, users } from "@openlaw/db";
import {
  signIn,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  await harness.db.update(orgSettings).set({ allowedEmailDomains: ["example.com"] });
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** Every cookie a response set, for carrying state to the next request. */
function cookiesOf(res: { cookies: { name: string; value: string }[] }): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const c of res.cookies) if (c.value) jar[c.name] = c.value;
  return jar;
}

function hasSessionCookie(jar: Record<string, string>): boolean {
  return Object.keys(jar).some((name) => name.includes("session_token"));
}

/** RFC 4648 base32 decode (what an authenticator does to the QR secret). */
function base32Decode(encoded: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.replace(/=+$/, "")) {
    const index = alphabet.indexOf(char.toUpperCase());
    expect(index, `invalid base32 character: ${char}`).toBeGreaterThanOrEqual(0);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** The raw TOTP seed, recovered from the QR URI as an authenticator would. */
function secretFrom(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  expect(secret, `no secret in TOTP URI: ${totpURI}`).toBeTruthy();
  return base32Decode(secret!);
}

/** The code a user's authenticator would show right now. */
async function currentCode(secret: string): Promise<string> {
  const { code } = await harness.app.auth.api.generateTOTP({ body: { secret } });
  return code;
}

/**
 * Full enrolment as the signed-in user: password-confirmed enable, then
 * prove the first code so the factor arms (verified=true). Returns the
 * TOTP secret and one-time backup codes exactly as the user would hold them.
 */
async function enroll(cookies: Record<string, string>, password: string) {
  const enable = await harness.app.inject({
    method: "POST",
    url: "/api/auth/two-factor/enable",
    cookies,
    payload: { password },
  });
  expect(enable.statusCode, enable.body).toBe(200);
  const { totpURI, backupCodes } = enable.json() as { totpURI: string; backupCodes: string[] };
  const secret = secretFrom(totpURI);

  const prove = await harness.app.inject({
    method: "POST",
    url: "/api/auth/two-factor/verify-totp",
    cookies,
    payload: { code: await currentCode(secret) },
  });
  expect(prove.statusCode, prove.body).toBe(200);
  return { secret, backupCodes };
}

/** Password sign-in that must come back as a 2FA challenge, not a session. */
async function challenge(email: string, password: string): Promise<Record<string, string>> {
  const res = await signIn(harness.app, email, password);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
  const jar = cookiesOf(res);
  expect(hasSessionCookie(jar), "challenge must not carry a session").toBe(false);
  return jar;
}

/** Answers an open challenge with a TOTP or backup code. */
async function answer(
  jar: Record<string, string>,
  path: "verify-totp" | "verify-backup-code",
  code: string,
) {
  return harness.app.inject({
    method: "POST",
    url: `/api/auth/two-factor/${path}`,
    cookies: jar,
    payload: { code },
  });
}

async function me(cookies: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
}

/** Invites a staff user and activates them with the given password. */
async function inviteActivated(email: string, displayName: string, password: string) {
  const adminCookies = await signInThroughChallenge();
  const invited = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: adminCookies,
    payload: { email, displayName, role: "legal_team_member" },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const token = /\/auth\/set-password\?token=([A-Za-z0-9._~-]+)/.exec(
    harness.mailer.messagesTo(email).at(-1)!.text,
  )![1]!;
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: password, token },
  });
  expect(reset.statusCode, reset.body).toBe(200);
}

/** Admin session cookies, answering the 2FA challenge if one is armed. */
let adminSecret: string | null = null;
async function signInThroughChallenge(): Promise<Record<string, string>> {
  if (!adminSecret) return signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const jar = await challenge(TEST_ADMIN.email, TEST_ADMIN.password);
  const verified = await answer(jar, "verify-totp", await currentCode(adminSecret));
  expect(verified.statusCode, verified.body).toBe(200);
  return { ...jar, ...cookiesOf(verified) };
}

describe("TOTP two-factor (mounted better-auth twoFactor plugin)", () => {
  let adminBackupCodes: string[] = [];

  it("refuses enrolment without the correct password", async () => {
    const cookies = await signInThroughChallenge();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/enable",
      cookies,
      payload: { password: "not-the-password-123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enrols, then challenges the next sign-in and mints a session on the code", async () => {
    const cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const enrolment = await enroll(cookies, TEST_ADMIN.password);
    adminSecret = enrolment.secret;
    adminBackupCodes = enrolment.backupCodes;
    expect(adminBackupCodes).toHaveLength(10);

    // Fresh sign-in: correct password alone now yields a challenge…
    const jar = await challenge(TEST_ADMIN.email, TEST_ADMIN.password);

    // …and the authenticator code completes it into a real session.
    const verified = await answer(jar, "verify-totp", await currentCode(adminSecret));
    expect(verified.statusCode, verified.body).toBe(200);
    const sessionJar = { ...jar, ...cookiesOf(verified) };
    expect(hasSessionCookie(sessionJar)).toBe(true);

    const who = await me(sessionJar);
    expect(who.statusCode, who.body).toBe(200);
    expect(who.json().user).toMatchObject({ email: TEST_ADMIN.email, role: "administrator" });
  });

  it("stores the TOTP seed and backup codes encrypted, never in the clear", async () => {
    const [row] = await harness.db.select().from(twoFactors).limit(1);
    expect(row).toBeDefined();
    expect(row!.secret).not.toContain(adminSecret!);
    for (const code of adminBackupCodes) {
      expect(row!.backupCodes).not.toContain(code);
    }
  });

  it("redeems a backup code exactly once", async () => {
    const code = adminBackupCodes[0]!;

    const first = await answer(
      await challenge(TEST_ADMIN.email, TEST_ADMIN.password),
      "verify-backup-code",
      code,
    );
    expect(first.statusCode, first.body).toBe(200);
    expect(hasSessionCookie(cookiesOf(first))).toBe(true);

    const replay = await answer(
      await challenge(TEST_ADMIN.email, TEST_ADMIN.password),
      "verify-backup-code",
      code,
    );
    expect(replay.statusCode).toBe(401);
    expect(hasSessionCookie(cookiesOf(replay))).toBe(false);
  });

  it("never challenges a magic-link sign-in — 2FA gates passwords only", async () => {
    const issue = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: TEST_ADMIN.email },
    });
    expect(issue.statusCode, issue.body).toBe(202);
    const link = /(https?:\/\/\S*\/api\/auth\/magic-link\/verify\?\S+)/.exec(
      harness.mailer.messagesTo(TEST_ADMIN.email).at(-1)!.text,
    )![1]!;
    const url = new URL(link);
    const redeemed = await harness.app.inject({ method: "GET", url: url.pathname + url.search });
    const jar = cookiesOf(redeemed);
    expect(hasSessionCookie(jar), "magic link must sign straight in").toBe(true);
    const who = await me(jar);
    expect(who.statusCode, who.body).toBe(200);
  });

  it("locks the account after repeated wrong codes, even for the right code", async () => {
    const email = "iris@example.com";
    const password = "iris-picks-a-passphrase";
    await inviteActivated(email, "Iris Whitcombe", password);
    const { secret } = await enroll(await signInCookies(harness.app, email, password), password);

    // Each challenge grants five attempts; ten consecutive failures spend
    // the account-level budget and lock the factor.
    for (let round = 0; round < 2; round++) {
      const jar = await challenge(email, password);
      for (let i = 0; i < 5; i++) {
        const res = await answer(jar, "verify-totp", "000000");
        expect(res.statusCode).toBe(401);
      }
    }

    const jar = await challenge(email, password);
    const locked = await answer(jar, "verify-totp", await currentCode(secret));
    expect(locked.statusCode, locked.body).toBe(429);
    expect(hasSessionCookie(cookiesOf(locked))).toBe(false);

    // Backup codes ride the same lock — a locked factor is locked whole.
    const backupJar = await challenge(email, password);
    const lockedBackup = await answer(backupJar, "verify-backup-code", "AAAAA-AAAAA");
    expect(lockedBackup.statusCode).toBe(429);

    // Once the lock expires (time-travelled via the database), the right
    // code signs in and the failure budget resets.
    await harness.db
      .update(twoFactors)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(
        eq(
          twoFactors.userId,
          (await harness.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!
            .id,
        ),
      );
    const retry = await answer(
      await challenge(email, password),
      "verify-totp",
      await currentCode(secret),
    );
    expect(retry.statusCode, retry.body).toBe(200);
    const [factor] = await harness.db
      .select()
      .from(twoFactors)
      .where(
        eq(
          twoFactors.userId,
          (await harness.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!
            .id,
        ),
      );
    expect(factor!.failedVerificationCount).toBe(0);
    expect(factor!.lockedUntil).toBeNull();
  });

  it("disables with the password and returns sign-in to a single factor", async () => {
    const cookies = await signInThroughChallenge();

    const wrongPassword = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/disable",
      cookies,
      payload: { password: "not-the-password-123" },
    });
    expect(wrongPassword.statusCode).toBe(400);

    const disabled = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/disable",
      cookies,
      payload: { password: TEST_ADMIN.password },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    adminSecret = null;

    const res = await signIn(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().twoFactorRedirect).toBeUndefined();
    expect(hasSessionCookie(cookiesOf(res))).toBe(true);
  });
});
