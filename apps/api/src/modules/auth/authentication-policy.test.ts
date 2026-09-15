// SPDX-License-Identifier: AGPL-3.0-only

import { beforeAll, afterAll, it, expect } from "vitest";
import { eq, users, orgSettings, verifications } from "@openlaw/db";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
let harness: TestHarness;
let admin: Record<string, string>;
const basic = { password: true, magicLink: true, sso: false, requireTwoFactor: false };
beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await harness.db.update(orgSettings).set({ allowedEmailDomains: ["example.com"] });
});
afterAll(async () => harness.stop());
const policy = (group: string, options = basic, cookies = admin) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/auth/policy/${group}`,
    cookies,
    payload: options,
  });
const requestLink = (email: string) =>
  harness.app.inject({ method: "POST", url: "/api/v1/auth/password-setup", payload: { email } });
const tokenFor = (email: string) =>
  new URL(
    /https?:\/\/\S+/.exec(harness.mailer.messagesTo(email).at(-1)!.text)![0]!,
  ).searchParams.get("token")!;
const complete = (token: string) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/password-setup/complete",
    payload: { token, password: "business-test-password" },
  });

it("saves independent group policies and rejects unusable configurations", async () => {
  expect((await policy("business", basic, {})).statusCode).toBe(401);
  expect(
    (await policy("business", { ...basic, password: false, magicLink: false })).statusCode,
  ).toBe(400);
  expect((await policy("business", { ...basic, sso: true })).statusCode).toBe(400);
  const saved = await policy("business", { ...basic, magicLink: false });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toMatchObject({
    legal: { magicLink: true },
    business: { password: true, magicLink: false },
  });
});
it("verifies inbox ownership before creating a Business User and only accepts the token once", async () => {
  const email = "new-business@example.com";
  expect((await requestLink(email)).statusCode).toBe(202);
  expect(await harness.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  const token = tokenFor(email);
  const response = await complete(token);
  expect(response.statusCode, response.body).toBe(200);
  const cookies = await signInCookies(harness.app, email, "business-test-password");
  const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
  expect(me.json().user).toMatchObject({ email, role: "business_user" });
  expect((await complete(token)).statusCode).toBe(400);
  expect((await policy("legal", basic, cookies)).statusCode).toBe(403);
});
it("returns the same response for ineligible addresses without creating accounts or sending mail", async () => {
  const denied = await requestLink("outsider@other.example");
  const allowed = await requestLink("another@example.com");
  expect(denied.statusCode).toBe(allowed.statusCode);
  expect(denied.json()).toEqual(allowed.json());
  expect(harness.mailer.messagesTo("outsider@other.example")).toHaveLength(0);
  expect(
    await harness.db.select().from(users).where(eq(users.email, "outsider@other.example")),
  ).toHaveLength(0);
  expect(
    await harness.db
      .select()
      .from(verifications)
      .where(eq(verifications.value, "outsider@other.example")),
  ).toHaveLength(0);
});
it("rechecks the group policy at password creation and on every sign-in", async () => {
  const email = "revoked-policy@example.com";
  await requestLink(email);
  const token = tokenFor(email);
  await policy("business", { ...basic, password: false });
  expect((await complete(token)).statusCode).toBe(403);
  const denied = await harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email: "new-business@example.com", password: "business-test-password" },
  });
  expect(denied.statusCode, denied.body).toBe(403);
  expect((await requestLink(email)).statusCode).toBe(202);
  expect(harness.mailer.messagesTo(email)).toHaveLength(1);
  await policy("business", basic);
});
it("rejects expired setup links", async () => {
  await requestLink("expired@example.com");
  const token = tokenFor("expired@example.com");
  await harness.db
    .update(verifications)
    .set({ expiresAt: new Date(0) })
    .where(eq(verifications.value, "expired@example.com"));
  expect((await complete(token)).statusCode).toBe(400);
});
it("retains administrator password recovery even if Legal Users use magic links only", async () => {
  await policy("legal", { ...basic, password: false });
  const cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
  expect(me.statusCode, me.body).toBe(200);
  expect(me.json().user).toMatchObject({ email: TEST_ADMIN.email, role: "administrator" });
  await policy("legal", basic);
});

it("adds a password to an existing Business User who originally used a magic link", async () => {
  const email = "existing-magic@example.com";
  const sent = await harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/portal" },
  });
  expect(sent.statusCode, sent.body).toBe(200);
  const url = new URL(/https?:\/\/\S+/.exec(harness.mailer.messagesTo(email).at(-1)!.text)![0]!);
  await harness.app.inject({ method: "GET", url: url.pathname + url.search });
  expect((await requestLink(email)).statusCode).toBe(202);
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { token: tokenFor(email), newPassword: "business-test-password" },
  });
  expect(reset.statusCode, reset.body).toBe(200);
  const cookies = await signInCookies(harness.app, email, "business-test-password");
  const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
  expect(me.statusCode, me.body).toBe(200);
  expect(me.json().user).toMatchObject({ email, role: "business_user" });
});

it("refuses legacy policy setters once independent group policies are saved", async () => {
  for (const [path, payload] of [
    ["mode", { mode: "built_in" }],
    ["portal", { magicLinkEnabled: false }],
    ["two-factor-policy", { requireTwoFactor: true }],
  ] as const) {
    const result = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/${path}`,
      cookies: admin,
      payload,
    });
    expect(result.statusCode, result.body).toBe(409);
  }
});

it("limits password setup by address and does not resend a live signup token", async () => {
  const email = "limited-setup@example.com";
  for (let attempt = 0; attempt < 3; attempt++)
    expect((await requestLink(email)).statusCode).toBe(202);
  expect(harness.mailer.messagesTo(email)).toHaveLength(1);
  const refused = await requestLink(email);
  expect(refused.statusCode).toBe(429);
  expect(refused.headers["content-type"]).toContain("application/problem+json");
  expect(refused.json()).toMatchObject({ status: 429 });
});

it("limits password setup across addresses sharing an IP", async () => {
  for (let attempt = 0; attempt <= 30; attempt++) {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/password-setup",
      remoteAddress: "192.0.2.90",
      payload: { email: `denied-${attempt}@unlisted.example` },
    });
    expect(response.statusCode, response.body).toBe(attempt < 30 ? 202 : 429);
  }
});
