// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Profile pane's self-service surfaces (SET-006, #67). These
 * mutations ride better-auth's own mounted routes; what is ours — and
 * what this suite proves — is the DD-017 audit trail the after hook
 * appends, the update-user validation the before hook enforces, and the
 * sign-out-my-other-devices semantics: every session ends except the
 * one that asked.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq } from "@openlaw/db";
import {
  signIn,
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;

// The password changes mid-suite; later sign-ins must use the current one.
let password: string = ADMIN.password;

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

const signInCookies = () => harnessSignInCookies(harness.app, ADMIN.email, password);

async function me(cookies: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
}

const rowsFor = (action: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, action))
    .orderBy(asc(activityLog.createdAt));

/** A tiny but genuine PNG (1×1 transparent pixel) as a data: URI. */
const PNG_DATA_URI =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("display name and avatar (better-auth /update-user)", () => {
  it("updates the display name and appends an old/new audit entry", async () => {
    const cookies = await signInCookies();
    const before = (await rowsFor("user.display_name_changed")).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      cookies,
      payload: { name: "Blair W. Wentworth" },
    });
    expect(res.statusCode, res.body).toBe(200);

    const who = await me(cookies);
    expect(who.json().user.displayName).toBe("Blair W. Wentworth");

    const rows = (await rowsFor("user.display_name_changed")).slice(before);
    expect(rows).toHaveLength(1);
    const userId = who.json().user.id;
    expect(rows[0]).toMatchObject({
      entityType: "user",
      entityId: userId,
      actorId: userId,
      visibility: "admin_only",
      payload: { field: "display_name", old: ADMIN.displayName, new: "Blair W. Wentworth" },
    });
  });

  it("updates the avatar and audits presence only, never the image bytes", async () => {
    const cookies = await signInCookies();
    const before = (await rowsFor("user.avatar_changed")).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      cookies,
      payload: { image: PNG_DATA_URI },
    });
    expect(res.statusCode, res.body).toBe(200);

    const who = await me(cookies);
    expect(who.json().user.image).toBe(PNG_DATA_URI);

    const rows = (await rowsFor("user.avatar_changed")).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ field: "avatar", old: null, new: "[image]" });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("base64");
  });

  it("rejects an avatar that is not a PNG/JPEG data: URI, and an empty name", async () => {
    const cookies = await signInCookies();
    const svg = await harness.app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      cookies,
      payload: { image: "data:image/svg+xml;base64,PHN2Zy8+" },
    });
    expect(svg.statusCode, svg.body).toBe(400);

    const blank = await harness.app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      cookies,
      payload: { name: "   " },
    });
    expect(blank.statusCode, blank.body).toBe(400);
  });

  it("appends no audit entry when the update fails", async () => {
    const cookies = await signInCookies();
    const before = (await rowsFor("user.avatar_changed")).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      cookies,
      payload: { image: "https://example.com/avatar.png" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(await rowsFor("user.avatar_changed")).toHaveLength(before);
  });
});

describe("sign out my other devices (better-auth /revoke-other-sessions)", () => {
  it("ends every session but the caller's", async () => {
    const mine = await signInCookies();
    const otherA = await signInCookies();
    const otherB = await signInCookies();
    for (const jar of [mine, otherA, otherB]) {
      expect((await me(jar)).statusCode).toBe(200);
    }

    const before = (await rowsFor("user.other_sessions_revoked")).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/revoke-other-sessions",
      cookies: mine,
    });
    expect(res.statusCode, res.body).toBe(200);

    // The other cookies are dead the moment the rows are gone…
    expect((await me(otherA)).statusCode, "other session A must be signed out").toBe(401);
    expect((await me(otherB)).statusCode, "other session B must be signed out").toBe(401);
    // …and the session that asked keeps working.
    expect((await me(mine)).statusCode, "the current session must survive").toBe(200);

    const rows = (await rowsFor("user.other_sessions_revoked")).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "user", visibility: "admin_only" });
  });
});

describe("change password (better-auth /change-password)", () => {
  it("changes the password and appends a value-free audit entry", async () => {
    const cookies = await signInCookies();
    const newPassword = "correct-horse-battery-staple-2";
    const before = (await rowsFor("user.password_changed")).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies,
      payload: { currentPassword: password, newPassword },
    });
    expect(res.statusCode, res.body).toBe(200);

    const stale = await signIn(harness.app, ADMIN.email, password);
    expect(stale.statusCode, "the old password must stop working").toBe(401);
    password = newPassword;
    expect((await signIn(harness.app, ADMIN.email, password)).statusCode).toBe(200);

    const rows = (await rowsFor("user.password_changed")).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "user", visibility: "admin_only", payload: {} });
  });

  it("appends nothing when the current password is wrong", async () => {
    const cookies = await signInCookies();
    const before = (await rowsFor("user.password_changed")).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies,
      payload: { currentPassword: "not-the-password-123", newPassword: "irrelevant-anyway-9" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await rowsFor("user.password_changed")).toHaveLength(before);
  });
});

describe("TOTP lifecycle audit (SET-006: enrol, re-enrol, disable)", () => {
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

  async function enroll(
    cookies: Record<string, string>,
  ): Promise<{ secret: string; cookies: Record<string, string> }> {
    const enable = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/enable",
      cookies,
      payload: { password },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    const secretParam = new URL(enable.json().totpURI).searchParams.get("secret")!;
    const secret = base32Decode(secretParam);
    const { code } = await harness.app.auth.api.generateTOTP({ body: { secret } });
    const prove = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/verify-totp",
      cookies,
      payload: { code },
    });
    expect(prove.statusCode, prove.body).toBe(200);
    // A first-enrolment verify rotates the session (the old token is
    // deleted); carry the fresh cookie forward or the jar goes stale.
    const jar = { ...cookies };
    for (const c of prove.cookies) if (c.value) jar[c.name] = c.value;
    return { secret, cookies: jar };
  }

  it("audits enrolment, re-enrolment, and disable — but never a sign-in challenge", async () => {
    // Enrolment: enable + first verified code → one enrolled entry.
    const beforeEnroll = (await rowsFor("user.two_factor_enrolled")).length;
    const { secret, cookies } = await enroll(await signInCookies());
    expect(await rowsFor("user.two_factor_enrolled")).toHaveLength(beforeEnroll + 1);
    const [entry] = (await rowsFor("user.two_factor_enrolled")).slice(-1);
    expect(entry).toMatchObject({ entityType: "user", visibility: "admin_only" });

    // A sign-in challenge answers through the same verify endpoint but is
    // not an enrolment — it must not append a second entry.
    const challenge = await signIn(harness.app, ADMIN.email, password);
    expect(challenge.statusCode, challenge.body).toBe(200);
    expect(challenge.json()).toMatchObject({ twoFactorRedirect: true });
    const jar: Record<string, string> = {};
    for (const c of challenge.cookies) if (c.value) jar[c.name] = c.value;
    const { code } = await harness.app.auth.api.generateTOTP({ body: { secret } });
    const answered = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/verify-totp",
      cookies: jar,
      payload: { code },
    });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(await rowsFor("user.two_factor_enrolled")).toHaveLength(beforeEnroll + 1);

    // Re-enrolment (a fresh secret while already enabled) is a real
    // event and appends its own entry.
    const reenrolled = await enroll(cookies);
    expect(await rowsFor("user.two_factor_enrolled")).toHaveLength(beforeEnroll + 2);

    // Disable requires the password and appends one disabled entry.
    const beforeDisable = (await rowsFor("user.two_factor_disabled")).length;
    const disabled = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/disable",
      cookies: reenrolled.cookies,
      payload: { password },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(await rowsFor("user.two_factor_disabled")).toHaveLength(beforeDisable + 1);

    // Disabling when already disabled records nothing — no transition.
    // (Disable rotates the session like the enrolment verify does, so
    // the fresh cookie rides along.)
    const afterDisable = { ...reenrolled.cookies };
    for (const c of disabled.cookies) if (c.value) afterDisable[c.name] = c.value;
    const again = await harness.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/disable",
      cookies: afterDisable,
      payload: { password },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(await rowsFor("user.two_factor_disabled")).toHaveLength(beforeDisable + 1);
  });
});
