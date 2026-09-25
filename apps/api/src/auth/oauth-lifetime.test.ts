// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { oauthRefreshTokens, eq } from "@openlaw/db";
import { buildApp } from "../app.js";
import { testDeps } from "../testing/deps.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { effectiveEnvironment, emptySettings } from "../modules/advanced-settings/config.js";
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
});
afterAll(async () => {
  await h?.stop();
});
it.each([90, 1, 365])(
  "issues a refresh token expiring after %s days at the token endpoint",
  async (days) => {
    const baseline = days === 90 ? {} : { MCP_OAUTH_GRANT_LIFETIME_DAYS: String(days) };
    const app = await buildApp(
      testDeps({
        db: h.db,
        advancedRuntime: { baseline, active: effectiveEnvironment(baseline, emptySettings()) },
      }),
    );
    try {
      const cookies = await signInCookies(app, TEST_ADMIN.email, TEST_ADMIN.password);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/mcp-settings/allowed-clients",
        cookies,
        payload: { name: `Lifetime ${days}`, callbackUrls: ["https://client.example/callback"] },
      });
      expect(created.statusCode, created.body).toBe(201);
      const secret = await app.inject({
        method: "POST",
        url: `/api/v1/mcp-settings/allowed-clients/${created.json().id}/secret`,
        cookies,
      });
      expect(secret.statusCode, secret.body).toBe(200);
      const client = { client_id: created.json().clientId, client_secret: secret.json().secret };
      const verifier = "openlaw-lifetime-verifier-".repeat(3);
      const query = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        scope: "toolset:contracts offline_access",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        state: "lifetime-test",
      });
      const authorized = await app.inject({ url: `/api/auth/oauth2/authorize?${query}`, cookies });
      expect(authorized.statusCode, authorized.body).toBe(302);
      const consentQuery = new URL(authorized.headers.location!, app.baseUrl).search.slice(1);
      const consent = await app.inject({
        method: "POST",
        url: "/api/auth/oauth2/consent",
        cookies,
        payload: { accept: true, oauth_query: consentQuery },
      });
      expect(consent.statusCode, consent.body).toBe(200);
      const code = new URL(consent.json().url).searchParams.get("code");
      const token = await app.inject({
        method: "POST",
        url: "/api/auth/oauth2/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          client_secret: client.client_secret,
          code: code!,
          redirect_uri: "https://client.example/callback",
          code_verifier: verifier,
          resource: "http://localhost/mcp",
        }).toString(),
      });
      expect(token.statusCode, token.body).toBe(200);
      expect(token.json().refresh_token).toEqual(expect.any(String));
      const [stored] = await h.db
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.clientId, client.client_id));
      expect(stored).toBeDefined();
      expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBeCloseTo(
        days * 86_400_000,
        -3,
      );
    } finally {
      await app.close();
    }
  },
);
it.each(["0", "366", "1.5", "invalid"])(
  "refuses invalid boot lifetime %s by name",
  async (value) => {
    await expect(
      buildApp(
        testDeps({
          db: h.db,
          advancedRuntime: { baseline: {}, active: { MCP_OAUTH_GRANT_LIFETIME_DAYS: value } },
        }),
      ),
    ).rejects.toThrow("MCP_OAUTH_GRANT_LIFETIME_DAYS");
  },
);
