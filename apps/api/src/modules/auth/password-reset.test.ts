// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What a password reset does to the account's other sessions, and where
 * the set-password token travels (TECH-032).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);
});

afterAll(async () => {
  await harness.stop();
});

const me = (cookies: Record<string, string>) =>
  harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });

describe("password reset", () => {
  it("carries the set-password token in the URL fragment, never the query string", async () => {
    const asked = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/password-setup",
      payload: { email: TEST_ADMIN.email },
    });
    expect(asked.statusCode, asked.body).toBe(202);
    const { text } = harness.mailer.messagesTo(TEST_ADMIN.email).at(-1)!;
    expect(text).toContain("/auth/set-password#token=");
    expect(text).not.toContain("?token=");
  });

  it("ends every session that existed before the reset", async () => {
    const first = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const second = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    expect((await me(first)).statusCode).toBe(200);
    expect((await me(second)).statusCode).toBe(200);

    const token = tokenFrom(harness.mailer.messagesTo(TEST_ADMIN.email).at(-1)!.text);
    const newPassword = "a-brand-new-password-1";
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword, token },
    });
    expect(reset.statusCode, reset.body).toBe(200);

    // A cookie stolen before the reset is dead after it.
    expect((await me(first)).statusCode).toBe(401);
    expect((await me(second)).statusCode).toBe(401);

    const fresh = await signInCookies(harness.app, TEST_ADMIN.email, newPassword);
    expect((await me(fresh)).statusCode).toBe(200);
  });
});
