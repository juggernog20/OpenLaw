// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

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

async function listUsers(cookies?: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/users", cookies });
}

describe("the Users list (GET /api/v1/users, SET-005)", () => {
  it("lists every user with role, status, and last-active; a pending invite is a row", async () => {
    const invited = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies: adminCookies,
      payload: { email: "pat@example.com", displayName: "Pat Osei", role: "contributor" },
    });
    expect(invited.statusCode, invited.body).toBe(201);

    const res = await listUsers(adminCookies);
    expect(res.statusCode, res.body).toBe(200);
    const { users } = res.json() as {
      users: {
        id: string;
        email: string;
        displayName: string;
        role: string;
        status: string;
        lastActiveAt: string | null;
      }[];
    };

    // The Administrator signed in, so the session hook has stamped them.
    const admin = users.find((user) => user.email === TEST_ADMIN.email);
    expect(admin).toMatchObject({ role: "administrator", status: "active" });
    expect(admin?.lastActiveAt).toBeTruthy();

    // The pending invite renders as a row, not a fire-and-forget.
    const pat = users.find((user) => user.email === "pat@example.com");
    expect(pat).toMatchObject({
      displayName: "Pat Osei",
      role: "contributor",
      status: "invited",
      lastActiveAt: null,
    });

    // Oldest first: the install's Administrator leads the list.
    expect(users[0]?.email).toBe(TEST_ADMIN.email);
  });

  it("flips an invite to active once the invitee activates and signs in", async () => {
    const token = tokenFrom(harness.mailer.messagesTo("pat@example.com")[0]!.text);
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "pat-sets-his-own-1", token },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    await signInCookies(harness.app, "pat@example.com", "pat-sets-his-own-1");

    const res = await listUsers(adminCookies);
    const pat = (
      res.json() as { users: { email: string; status: string; lastActiveAt: string | null }[] }
    ).users.find((user) => user.email === "pat@example.com");
    expect(pat?.status).toBe("active");
    expect(pat?.lastActiveAt).toBeTruthy();
  });

  it("holds the Administrator gate: 401 signed out, 403 for other roles", async () => {
    const anonymous = await listUsers();
    expect(anonymous.statusCode).toBe(401);

    const patCookies = await signInCookies(harness.app, "pat@example.com", "pat-sets-his-own-1");
    const forbidden = await listUsers(patCookies);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.headers["content-type"]).toContain("application/problem+json");
  });
});
