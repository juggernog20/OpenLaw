// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Instance email settings (#37): Administrator-only, env always wins
 * over app configuration, the relay URL (which embeds the credential)
 * never appears in any response, and a wizard save is used by the very
 * next send with no restart. Asserted at the HTTP seam only — responses
 * and captured mail, never resolver internals.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  TEST_SMTP_ENV,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;
let staffCookies: Record<string, string>;

const STAFF = {
  email: "nadia@example.com",
  displayName: "Nadia Osei",
  password: "nadia-sets-her-own",
} as const;

/** A relay URL with an inline credential that must never be echoed. */
const RELAY = {
  smtpUrl: "smtp://mailer:sekret-cred@relay.acme.example:587",
  smtpFrom: "Acme Legal <legal@acme.example>",
} as const;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  // The admin-only checks need an authenticated non-Administrator; the
  // invite email flows while the harness default (env-pinned) holds.
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
  staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
});

afterAll(async () => {
  await harness.stop();
});

describe("email settings guards", () => {
  it("is an Administrator-only surface, all three operations", async () => {
    for (const request of [
      { method: "GET" as const, url: "/api/v1/email-settings" },
      { method: "PUT" as const, url: "/api/v1/email-settings", payload: RELAY },
      { method: "POST" as const, url: "/api/v1/email-settings/test" },
    ]) {
      const anonymous = await harness.app.inject(request);
      expect(anonymous.statusCode, `${request.method} anonymous`).toBe(401);
      expect(anonymous.headers["content-type"]).toContain("application/problem+json");
      expect(anonymous.json()).toMatchObject({ title: "Authentication required.", status: 401 });
      const staff = await harness.app.inject({ ...request, cookies: staffCookies });
      expect(staff.statusCode, `${request.method} staff`).toBe(403);
      expect(staff.headers["content-type"]).toContain("application/problem+json");
      expect(staff.json()).toMatchObject({
        title: "You do not have permission to perform this action.",
        status: 403,
      });
    }
  });
});

describe("while the environment pins SMTP", () => {
  it("reports the env source and the effective from-address, never the URL", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ source: "env", fromAddress: TEST_SMTP_ENV.from });
  });

  it("refuses saves — env wins, so app values would never apply", async () => {
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
      payload: RELAY,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("environment");
  });

  it("sends the test email to the signed-in Administrator", async () => {
    const before = harness.mailer.messagesTo(TEST_ADMIN.email).length;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/email-settings/test",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ delivered: true, to: TEST_ADMIN.email });
    const captured = harness.mailer.messagesTo(TEST_ADMIN.email);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)!.subject).toContain("test");
  });

  it("reports a send failure loudly, with a reason", async () => {
    harness.mailer.configured = false;
    try {
      const res = await harness.app.inject({
        method: "POST",
        url: "/api/v1/email-settings/test",
        cookies: adminCookies,
      });
      expect(res.statusCode, res.body).toBe(502);
      expect(res.json().detail).toContain("could not be sent");
    } finally {
      harness.mailer.configured = true;
    }
  });
});

describe("resolved from the database when the environment sets no SMTP", () => {
  beforeAll(() => {
    harness.smtpEnv = null;
  });
  afterAll(() => {
    harness.smtpEnv = TEST_SMTP_ENV;
  });

  it("starts unconfigured: settings, onboarding status, and issuance agree", async () => {
    const state = await harness.app.inject({
      method: "GET",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
    });
    expect(state.json()).toEqual({ source: "unset", fromAddress: null });

    const status = await harness.app.inject({
      method: "GET",
      url: "/api/v1/onboarding",
      cookies: adminCookies,
    });
    expect(status.json().steps.email.done).toBe(false);

    // The magic-link path refuses uniformly while nothing can send.
    const magic = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "anyone@example.com" },
    });
    expect(magic.statusCode).toBe(403);
  });

  it("rejects malformed relay URLs and half-provided pairs at save time", async () => {
    for (const payload of [
      { smtpUrl: "not a url at all", smtpFrom: RELAY.smtpFrom },
      { smtpUrl: "https://relay.acme.example", smtpFrom: RELAY.smtpFrom },
      { smtpUrl: RELAY.smtpUrl, smtpFrom: null },
      { smtpUrl: null, smtpFrom: RELAY.smtpFrom },
    ]) {
      const res = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/email-settings",
        cookies: adminCookies,
        payload,
      });
      expect(res.statusCode, res.body).toBe(400);
    }
    // Nothing was saved by any of the refused attempts.
    const state = await harness.app.inject({
      method: "GET",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
    });
    expect(state.json()).toEqual({ source: "unset", fromAddress: null });
  });

  it("saves the relay; the very next send uses it, no restart", async () => {
    const saved = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
      payload: RELAY,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ source: "app", fromAddress: RELAY.smtpFrom });

    // Write-only secret: no response carries the URL or its credential.
    expect(saved.body).not.toContain(RELAY.smtpUrl);
    expect(saved.body).not.toContain("sekret-cred");
    const state = await harness.app.inject({
      method: "GET",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
    });
    expect(state.body).not.toContain("sekret-cred");
    expect(state.json()).toEqual({ source: "app", fromAddress: RELAY.smtpFrom });

    // Test-send delivers through the just-saved settings…
    const test = await harness.app.inject({
      method: "POST",
      url: "/api/v1/email-settings/test",
      cookies: adminCookies,
    });
    expect(test.statusCode, test.body).toBe(200);
    expect(harness.mailer.messagesTo(TEST_ADMIN.email).at(-1)!.subject).toContain("test");

    // …and so does a real flow: an invite sent moments after the save.
    const invited = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies: adminCookies,
      payload: { email: "june@example.com", displayName: "June Ito", role: "contributor" },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    expect(harness.mailer.messagesTo("june@example.com")).toHaveLength(1);

    // The wizard's email step now reads done — source is the app.
    const status = await harness.app.inject({
      method: "GET",
      url: "/api/v1/onboarding",
      cookies: adminCookies,
    });
    expect(status.json().steps.email.done).toBe(true);
  });

  it("replaces a saved relay in place — rotation without a reveal", async () => {
    const rotated = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
      payload: {
        smtpUrl: "smtps://mailer:rotated@relay.acme.example:465",
        smtpFrom: RELAY.smtpFrom,
      },
    });
    expect(rotated.statusCode, rotated.body).toBe(200);
    expect(rotated.json()).toEqual({ source: "app", fromAddress: RELAY.smtpFrom });
    expect(rotated.body).not.toContain("rotated");
  });

  it("clears back to unconfigured by saving nulls", async () => {
    const cleared = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/email-settings",
      cookies: adminCookies,
      payload: { smtpUrl: null, smtpFrom: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toEqual({ source: "unset", fromAddress: null });

    // Unconfigured again: the test send fails loudly with a reason…
    const test = await harness.app.inject({
      method: "POST",
      url: "/api/v1/email-settings/test",
      cookies: adminCookies,
    });
    expect(test.statusCode, test.body).toBe(502);
    expect(test.json().detail).toContain("SMTP is not configured");

    // …and the wizard's email step tracks the resolved source back down.
    const status = await harness.app.inject({
      method: "GET",
      url: "/api/v1/onboarding",
      cookies: adminCookies,
    });
    expect(status.json().steps.email.done).toBe(false);
  });
});
