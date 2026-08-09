// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Theme preference (#44): the theme rides the user record, so it
 * follows the person across browsers. GET /me carries it; PATCH
 * /me/preferences changes it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

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

const signInCookies = () => harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);

describe("theme preference (#44)", () => {
  it("defaults to light on GET /me", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user.theme).toBe("light");
  });

  it("PATCH /me/preferences updates the theme and GET /me reflects it", async () => {
    const cookies = await signInCookies();
    const patched = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "warm" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().user.theme).toBe("warm");

    // Persisted on the user record, not the session: a fresh sign-in
    // (fresh cookie jar) still sees it.
    const fresh = await signInCookies();
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: fresh });
    expect(me.json().user.theme).toBe("warm");
  });

  it("rejects a theme outside light/warm/dark", async () => {
    const cookies = await signInCookies();
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      cookies,
      payload: { theme: "solarized" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/preferences",
      payload: { theme: "dark" },
    });
    expect(res.statusCode, res.body).toBe(401);
  });
});
