// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Onboarding state (SET-004) and the portal toggle (DD-010): both are
 * Administrator-only, completion is one-way and idempotent, and the
 * toggle's effect is observable on the public methods endpoint and the
 * magic-link request path.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orgSettings } from "@openlaw/db";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
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

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  // The admin-only checks need an authenticated non-Administrator.
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
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

describe("onboarding state (GET /api/v1/onboarding, POST /api/v1/onboarding/complete)", () => {
  it("is an Administrator-only surface", async () => {
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/onboarding" })).statusCode,
    ).toBe(401);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/onboarding",
          cookies: staffCookies,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: "/api/v1/onboarding/complete",
          cookies: staffCookies,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("starts incomplete and reports the harness mailer as configured", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/onboarding",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ completed: false, emailConfigured: true });
  });

  it("reflects an unconfigured mailer", async () => {
    harness.mailer.configured = false;
    try {
      const res = await harness.app.inject({
        method: "GET",
        url: "/api/v1/onboarding",
        cookies: adminCookies,
      });
      expect(res.json()).toEqual({ completed: false, emailConfigured: false });
    } finally {
      harness.mailer.configured = true;
    }
  });

  it("completes once, idempotently, and never reopens", async () => {
    const first = await harness.app.inject({
      method: "POST",
      url: "/api/v1/onboarding/complete",
      cookies: adminCookies,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ completed: true, emailConfigured: true });

    const [afterFirst] = await harness.db
      .select({ at: orgSettings.onboardingCompletedAt })
      .from(orgSettings);
    expect(afterFirst?.at).toBeInstanceOf(Date);

    // A repeat call succeeds but must not move the recorded timestamp.
    const second = await harness.app.inject({
      method: "POST",
      url: "/api/v1/onboarding/complete",
      cookies: adminCookies,
    });
    expect(second.statusCode, second.body).toBe(200);
    const [afterSecond] = await harness.db
      .select({ at: orgSettings.onboardingCompletedAt })
      .from(orgSettings);
    expect(afterSecond?.at?.getTime()).toBe(afterFirst?.at?.getTime());

    const status = await harness.app.inject({
      method: "GET",
      url: "/api/v1/onboarding",
      cookies: adminCookies,
    });
    expect(status.json()).toEqual({ completed: true, emailConfigured: true });
  });
});

describe("portal toggle (PATCH /api/v1/auth/portal)", () => {
  it("is an Administrator-only surface", async () => {
    const anonymous = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      payload: { magicLinkEnabled: false },
    });
    expect(anonymous.statusCode).toBe(401);
    const staff = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: staffCookies,
      payload: { magicLinkEnabled: false },
    });
    expect(staff.statusCode).toBe(403);
  });

  it("closes and reopens magic-link sign-in, visibly and effectively", async () => {
    const closed = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: adminCookies,
      payload: { magicLinkEnabled: false },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toEqual({ magicLinkEnabled: false });

    // The login screen's discovery endpoint reflects it…
    const methods = await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" });
    expect(methods.json()).toMatchObject({ magicLinkEnabled: false });

    // …and the request path refuses loudly (global config leaks nothing).
    const refused = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "anyone@example.com" },
    });
    expect(refused.statusCode).toBe(403);

    const reopened = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: adminCookies,
      payload: { magicLinkEnabled: true },
    });
    expect(reopened.json()).toEqual({ magicLinkEnabled: true });
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" })).json(),
    ).toMatchObject({ magicLinkEnabled: true });
  });
});
