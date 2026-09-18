// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The password sign-in lockout and the client address behind it
 * (TECH-032). The lockout is asserted through the mounted better-auth
 * handler; the address handling through the password-setup budget, which
 * is the app's own code keyed on `request.ip`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ilike, sql, verifications } from "@openlaw/db";
import { buildApp } from "../../app.js";
import { testDeps } from "../../testing/deps.js";
import {
  signIn,
  startHarness,
  TEST_ADMIN,
  TEST_AUTH_CONFIG,
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

const wrongPassword = (attempt: number) => `not-the-password-${attempt}`;

async function failTenTimes(email: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await signIn(harness.app, email, wrongPassword(attempt));
    expect(res.statusCode, res.body).toBe(401);
  }
}

describe("password sign-in lockout", () => {
  it("closes the password door after ten wrong passwords, the right one included", async () => {
    await failTenTimes(TEST_ADMIN.email);

    const eleventh = await signIn(harness.app, TEST_ADMIN.email, wrongPassword(11));
    expect(eleventh.statusCode, eleventh.body).toBe(429);

    const correct = await signIn(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    expect(correct.statusCode, correct.body).toBe(429);
    expect(correct.cookies.find((c) => c.name.includes("session_token"))).toBeUndefined();
  });

  it("locks an address with no account the same way, so the lock reveals nothing", async () => {
    const ghost = "nobody@example.com";
    await failTenTimes(ghost);

    const ghostLocked = await signIn(harness.app, ghost, wrongPassword(11));
    const adminLocked = await signIn(harness.app, TEST_ADMIN.email, wrongPassword(11));
    expect(ghostLocked.statusCode).toBe(429);
    expect(ghostLocked.json()).toEqual(adminLocked.json());
  });

  it("does not count a refused attempt, so the lock ends when the window does", async () => {
    // Time travel through the database: the HTTP seam offers no clock.
    // Had the refusals above been counted, the window would have moved.
    await harness.db
      .update(verifications)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(ilike(verifications.identifier, "password-sign-in-failures:%"));

    const res = await signIn(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    expect(res.statusCode, res.body).toBe(200);
  });

  it("clears the count on a correct password", async () => {
    for (let round = 0; round < 2; round++) {
      for (let attempt = 0; attempt < 9; attempt++) {
        await signIn(harness.app, TEST_ADMIN.email, wrongPassword(attempt));
      }
      const res = await signIn(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
      expect(res.statusCode, res.body).toBe(200);
    }
  });
});

describe("the client address behind a proxy", () => {
  type App = Awaited<ReturnType<typeof buildApp>>;

  /** One password-setup request, the app's own per-address budget being
   * the seam that shows which address a request was counted under. */
  const setupLink = (
    app: App,
    remoteAddress: string,
    headers: Record<string, string>,
    email: string,
  ) =>
    app.inject({
      method: "POST",
      url: "/api/v1/auth/password-setup",
      remoteAddress,
      headers,
      payload: { email },
    });

  it("ignores a spoofed X-Forwarded-For when no proxy is trusted", async () => {
    for (let n = 0; n <= 30; n++) {
      const res = await setupLink(
        harness.app,
        "192.0.2.10",
        { "x-forwarded-for": `10.0.0.${n}` },
        `spoof-${n}@unlisted.example`,
      );
      expect(res.statusCode, res.body).toBe(n < 30 ? 202 : 429);
    }
  });

  describe("with a trusted proxy", () => {
    const PROXY = "192.0.2.1";
    let proxied: App;

    beforeAll(async () => {
      proxied = await buildApp(
        testDeps({
          db: harness.db,
          config: { ...TEST_AUTH_CONFIG, trustedProxies: [PROXY] },
        }),
      );
      await proxied.ready();
    });

    afterAll(async () => {
      await proxied.close();
    });

    it("believes the address the proxy forwards, one bucket per client", async () => {
      for (let n = 0; n <= 30; n++) {
        const res = await setupLink(
          proxied,
          PROXY,
          { "x-forwarded-for": `203.0.113.${n}` },
          `client-${n}@unlisted.example`,
        );
        expect(res.statusCode, res.body).toBe(202);
      }
      for (let n = 0; n <= 30; n++) {
        const res = await setupLink(
          proxied,
          PROXY,
          { "x-forwarded-for": "203.0.113.200" },
          `same-client-${n}@unlisted.example`,
        );
        expect(res.statusCode, res.body).toBe(n < 30 ? 202 : 429);
      }
    });

    it("still ignores the header from a sender that is not the proxy", async () => {
      for (let n = 0; n <= 30; n++) {
        const res = await setupLink(
          proxied,
          "198.51.100.5",
          { "x-forwarded-for": `203.0.113.${n}` },
          `direct-${n}@unlisted.example`,
        );
        expect(res.statusCode, res.body).toBe(n < 30 ? 202 : 429);
      }
    });

    it("does not count by address when the proxy forwarded none", async () => {
      // The proxy's own address would be every visitor's; the per-email
      // scope is the only one that applies then.
      for (let n = 0; n <= 30; n++) {
        const res = await setupLink(proxied, PROXY, {}, `unforwarded-${n}@unlisted.example`);
        expect(res.statusCode, res.body).toBe(202);
      }
    });
  });
});
