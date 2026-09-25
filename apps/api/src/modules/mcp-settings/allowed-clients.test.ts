// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, oauthClients, oauthConsents, orgSettings, eq } from "@openlaw/db";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";
let h: TestHarness;
let cookies: Record<string, string>;
const url = "/api/v1/mcp-settings/allowed-clients";
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  await h.db.update(orgSettings).set({ mcpEnabled: true, mcpLegalOAuthClientsEnabled: true });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => {
  await h?.stop();
});
it("creates, edits, generates and rotates once-shown secrets, toggles and deletes a registered Client", async () => {
  const created = await h.app.inject({
    method: "POST",
    url,
    cookies,
    payload: { name: "Test Client", callbackUrls: ["https://client.example/callback"] },
  });
  expect(created.statusCode, created.body).toBe(201);
  const row = created.json();
  expect(row).toMatchObject({
    name: "Test Client",
    kind: "registered",
    seeded: false,
    enabled: true,
  });
  expect(row.clientId).toBeTruthy();
  expect(row).not.toHaveProperty("secret");
  const generated = await h.app.inject({ method: "POST", url: `${url}/${row.id}/secret`, cookies });
  expect(generated.statusCode, generated.body).toBe(200);
  const first = generated.json().secret;
  expect(first).toBeTruthy();
  const read = await h.app.inject({ url, cookies });
  expect(read.body).not.toContain(first);
  expect(read.json().find((r: { id: string }) => r.id === row.id).secretGeneratedAt).toBeTruthy();
  const edited = await h.app.inject({
    method: "PATCH",
    url: `${url}/${row.id}`,
    cookies,
    payload: { name: "Renamed Client", callbackUrls: ["https://client.example/new"] },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  const rotated = await h.app.inject({ method: "POST", url: `${url}/${row.id}/secret`, cookies });
  expect(rotated.statusCode, rotated.body).toBe(200);
  expect(rotated.json().secret).not.toBe(first);
  for (const [secret, expected] of [
    [first, "invalid_client"],
    [rotated.json().secret, undefined],
  ]) {
    const verifier = "a".repeat(43);
    const query = new URLSearchParams({
      client_id: row.clientId,
      redirect_uri: "https://client.example/new",
      response_type: "code",
      scope: "toolset:contracts offline_access",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "test",
      prompt: "consent",
    });
    const authorize = await h.app.inject({ url: `/api/auth/oauth2/authorize?${query}`, cookies });
    expect(authorize.statusCode, authorize.body).toBe(302);
    const consent = await h.app.inject({
      method: "POST",
      url: "/api/v1/oauth-grants/consent",
      cookies,
      payload: {
        accept: true,
        toolsets: ["contracts"],
        scope: "read",
        oauth_query: new URL(authorize.headers.location!, h.app.baseUrl).search.slice(1),
      },
    });
    expect(consent.statusCode, consent.body).toBe(200);
    const code = new URL(consent.json().url).searchParams.get("code")!;
    const token = await h.app.inject({
      method: "POST",
      url: "/api/auth/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: row.clientId,
        client_secret: secret,
        code,
        redirect_uri: "https://client.example/new",
        code_verifier: "a".repeat(43),
      }).toString(),
    });
    expect(token.json().error, token.body).toBe(expected);
    if (expected) expect(token.statusCode).toBeGreaterThanOrEqual(400);
    else {
      expect(token.statusCode, token.body).toBe(200);
      expect(token.json().access_token).toBeTruthy();
    }
  }
  const consents = await h.db
    .select()
    .from(oauthConsents)
    .where(eq(oauthConsents.clientId, row.clientId));
  expect(consents).toHaveLength(1);
  await h.app.inject({ method: "POST", url: `${url}/${row.id}/secret`, cookies });
  expect(
    await h.db.select().from(oauthConsents).where(eq(oauthConsents.clientId, row.clientId)),
  ).toEqual(consents);
  const toggled = await h.app.inject({
    method: "PATCH",
    url: `${url}/${row.id}`,
    cookies,
    payload: { enabled: false },
  });
  expect(toggled.statusCode, toggled.body).toBe(200);
  expect(
    (await h.db.select().from(oauthClients).where(eq(oauthClients.clientId, row.clientId)))[0]!
      .disabled,
  ).toBe(true);
  const deleted = await h.app.inject({ method: "DELETE", url: `${url}/${row.id}`, cookies });
  expect(deleted.statusCode, deleted.body).toBe(204);
  expect((await h.app.inject({ url, cookies })).body).not.toContain(row.id);
  const audit = (await h.db.select().from(activityLog)).filter((r) =>
    r.action.startsWith("allowed_client."),
  );
  for (const action of ["created", "updated", "secret_generated", "toggled", "deleted"])
    expect(audit).toContainEqual(
      expect.objectContaining({ action: `allowed_client.${action}`, visibility: "admin_only" }),
    );
  expect(JSON.stringify(audit)).not.toContain(first);
});
it("protects published identities and seeded Clients and rejects invalid callbacks", async () => {
  const rows = (await h.app.inject({ url, cookies })).json();
  const published = rows.find((r: { kind: string }) => r.kind === "published");
  for (const method of ["PATCH", "DELETE"] as const) {
    const response = await h.app.inject({
      method,
      url: `${url}/${published.id}`,
      cookies,
      ...(method === "PATCH" ? { payload: { name: "Changed" } } : {}),
    });
    expect(response.statusCode, response.body).toBe(400);
  }
  const copilot = rows.find((r: { name: string }) => r.name === "Microsoft 365 Copilot");
  expect(
    (await h.app.inject({ method: "DELETE", url: `${url}/${copilot.id}`, cookies })).statusCode,
  ).toBe(400);
  const generated = await h.app.inject({
    method: "POST",
    url: `${url}/${copilot.id}/secret`,
    cookies,
  });
  expect(generated.statusCode, generated.body).toBe(200);
  expect(generated.json().clientId).toBeTruthy();
  for (const callbackUrls of [
    [],
    ["javascript:alert(1)"],
    ["https://client.example/callback#fragment"],
    [""],
  ])
    expect(
      (
        await h.app.inject({
          method: "POST",
          url,
          cookies,
          payload: { name: "Invalid", callbackUrls },
        })
      ).statusCode,
    ).toBe(400);
  expect((await h.app.inject({ url })).statusCode).toBe(401);
});
it("gates dynamic registration and discovery, and enrolls a confidential Client", async () => {
  const register = () =>
    h.app.inject({
      method: "POST",
      url: "/api/auth/oauth2/register",
      payload: {
        client_name: "Self registered",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
      },
    });
  expect((await register()).statusCode).toBe(403);
  const enabled = await h.app.inject({
    method: "PATCH",
    url: "/api/v1/mcp-settings",
    cookies,
    payload: { dynamicClientRegistrationEnabled: true },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  expect(
    (await h.app.inject({ url: "/.well-known/oauth-authorization-server" })).json()
      .registration_endpoint,
  ).toBeTruthy();
  const result = await register();
  expect(result.statusCode, result.body).toBe(201);
  expect(result.json().client_secret).toBeTruthy();
  const row = (await h.app.inject({ url, cookies }))
    .json()
    .find((r: { clientId: string }) => r.clientId === result.json().client_id);
  expect(row).toMatchObject({
    name: "Self registered",
    registeredByClient: true,
    enabled: true,
    kind: "registered",
  });
  expect(
    (await h.app.inject({ method: "POST", url: `${url}/${row.id}/secret`, cookies })).statusCode,
  ).toBe(200);
  await h.app.inject({
    method: "PATCH",
    url: "/api/v1/mcp-settings",
    cookies,
    payload: { dynamicClientRegistrationEnabled: false },
  });
  expect((await register()).statusCode).toBe(403);
  expect(
    (await h.app.inject({ url: "/.well-known/oauth-authorization-server" })).json(),
  ).not.toHaveProperty("registration_endpoint");
});

it("permits any Administrator and refuses staff and anonymous management", async () => {
  const rows = (await h.app.inject({ url, cookies })).json();
  const copilot = rows.find((row: { name: string }) => row.name === "Microsoft 365 Copilot");
  for (const role of ["administrator", "legal_team_member"]) {
    const email = `${role}@example.com`;
    const password = "allowed-clients-test-password";
    await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies,
      payload: { email, displayName: role, role },
    });
    const token = tokenFrom(h.mailer.messagesTo(email)[0]!.text);
    await h.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, newPassword: password },
    });
    const other = await signInCookies(h.app, email, password);
    const response = await h.app.inject({
      method: "POST",
      url: `${url}/${copilot.id}/secret`,
      cookies: other,
    });
    expect(response.statusCode, response.body).toBe(role === "administrator" ? 200 : 403);
    if (role === "legal_team_member")
      for (const [method, path, payload] of [
        ["GET", url, undefined],
        ["POST", url, { name: "Denied", callbackUrls: ["https://client.example/callback"] }],
        ["PATCH", `${url}/${copilot.id}`, { enabled: false }],
        ["DELETE", `${url}/${copilot.id}`, undefined],
      ] as const) {
        expect(
          (await h.app.inject({ method, url: path, cookies: other, payload })).statusCode,
        ).toBe(403);
        expect((await h.app.inject({ method, url: path, payload })).statusCode).toBe(401);
      }
  }
});
it("closes the plugin's HTTP management routes", async () => {
  for (const path of ["create-client", "update-client", "delete-client", "client/rotate-secret"]) {
    const response = await h.app.inject({
      method: "POST",
      url: `/api/auth/oauth2/${path}`,
      cookies,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(403);
  }
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/auth/admin/oauth2/client-enabled",
        cookies,
        payload: { clientId: "any", enabled: true },
      })
    ).statusCode,
  ).toBe(404);
});
