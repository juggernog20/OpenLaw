// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { getSchema } from "better-auth/db";
import { verifyMcpJwt } from "../mcp/auth.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MCP_TOOLSETS } from "@openlaw/shared";
import { orgSettings } from "@openlaw/db";
import { buildApp } from "../app.js";
import { testDeps } from "../testing/deps.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  TEST_AUTH_CONFIG,
  type TestHarness,
} from "../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let apiKey: string;
const forms = [
  ["oauth-authorization-server", ""],
  ["oauth-authorization-server", "/api/auth"],
  ["openid-configuration", ""],
  ["openid-configuration", "/api/auth"],
  ["oauth-protected-resource", ""],
  ["oauth-protected-resource", "/mcp"],
];
beforeAll(async () => {
  h = await startHarness();
  await (await h.app.auth.$context).checkSchema?.();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await h.db.update(orgSettings).set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true });
  const key = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies,
    payload: { clientName: "LAN script", toolsets: ["contracts"], scope: "read" },
  });
  expect(key.statusCode, key.body).toBe(201);
  apiKey = key.json().key;
  expect(apiKey).toMatch(/^ol_/);
});
afterAll(async () => {
  await h?.stop();
});

it.each(forms)("serves root %s%s through the plugin", async (name, suffix) => {
  const root = await h.app.inject({
    url: `/.well-known/${name}${suffix}`,
    headers: { origin: "https://client.example", "sec-fetch-site": "cross-site" },
  });
  const prefixed = await h.app.auth.handler(
    new Request(`http://localhost/api/auth/.well-known/${name}`),
  );
  expect(root.statusCode, root.body).toBe(200);
  expect(prefixed.status).toBe(200);
  expect(root.json()).toEqual(await prefixed.json());
  expect(h.app.swagger().paths).not.toHaveProperty(`/.well-known/${name}${suffix}`);
});
it("advertises each required authorization fact and only OpenLaw scopes", async () => {
  const res = await h.app.inject({ url: "/.well-known/oauth-authorization-server" });
  expect(res.statusCode, res.body).toBe(200);
  const doc = res.json();
  expect(doc.client_id_metadata_document_supported).toBe(true);
  expect(doc.token_endpoint_auth_methods_supported).toContain("none");
  expect(doc.code_challenge_methods_supported).toContain("S256");
  expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  expect(doc.scopes_supported).toContain("offline_access");
  expect(doc.scopes_supported).toEqual([
    ...MCP_TOOLSETS.map((t) => `toolset:${t}`),
    "write",
    "offline_access",
  ]);
  expect(doc).not.toHaveProperty("registration_endpoint");
  const resource = await h.app.inject({ url: "/.well-known/oauth-protected-resource/mcp" });
  expect(resource.json()).toMatchObject({
    resource: "http://localhost/mcp",
    authorization_servers: ["http://localhost/api/auth"],
  });
});
it.each(["/oauth2/register", "/oauth2/register/", "/oauth2/%72egister"])(
  "refuses registration at %s",
  async (path) => {
    const res = await h.app.inject({
      method: "POST",
      url: `/api/auth${path}`,
      cookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(403);
  },
);
it("updates the challenge from the live ceiling and read-only switch", async () => {
  for (const readOnly of [false, true]) {
    await h.db
      .update(orgSettings)
      .set({ mcpToolsetCeiling: ["contracts", "documents"], mcpReadOnly: readOnly });
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const res = await h.app.inject({ method, url: "/mcp", cookies });
      expect(res.statusCode, res.body).toBe(401);
      expect(res.headers["www-authenticate"]).toBe(
        `Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource" scope="toolset:contracts toolset:documents ${readOnly ? "" : "write "}offline_access"`,
      );
    }
  }
});
it.each(["http://10.0.0.5:3000", "http://localhost:3000"])(
  "boots and reports availability at %s",
  async (baseUrl) => {
    const webDist = await mkdtemp(join(tmpdir(), "openlaw-oauth-spa-"));
    await writeFile(join(webDist, "index.html"), "OpenLaw SPA");
    const app = await buildApp(
      testDeps({ db: h.db, webDist, config: { ...TEST_AUTH_CONFIG, baseUrl } }),
    );
    try {
      const enabled = baseUrl.includes("localhost");
      for (const [name, suffix] of forms) {
        const res = await app.inject({ url: `/.well-known/${name}${suffix}` });
        expect(res.statusCode, res.body).toBe(enabled ? 200 : 404);
      }
      const res = await app.inject({ url: "/api/v1/mcp-settings", cookies });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().authorizationServerAvailable).toBe(enabled);
      const plugins = app.auth.options.plugins.map((plugin) => plugin.id);
      for (const id of ["jwt", "oauth-provider", "cimd"] as const) {
        expect(plugins.includes(id)).toBe(enabled);
      }
      for (const headers of [{ "x-api-key": apiKey }, { authorization: `Bearer ${apiKey}` }]) {
        const initialized = await app.inject({
          method: "POST",
          url: "/mcp",
          headers: {
            ...headers,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            origin: "https://client.example",
          },
          payload: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "LAN script", version: "1" },
            },
          },
        });
        expect(initialized.statusCode, initialized.body).toBe(200);
      }
    } finally {
      await app.close();
      await rm(webDist, { recursive: true, force: true });
    }
  },
);

function authorizationQuery(clientId: string) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: "toolset:contracts offline_access",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "openlaw-test-state",
  });
}

it("opens a server-created Client's consent page with a signed query", async () => {
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/mcp-settings/allowed-clients",
    cookies,
    payload: { name: "Registered Client", callbackUrls: ["https://client.example/callback"] },
  });
  expect(created.statusCode, created.body).toBe(201);
  const client = { client_id: created.json().clientId };
  const query = authorizationQuery(client.client_id);
  const res = await h.app.inject({ url: `/api/auth/oauth2/authorize?${query}`, cookies });
  expect(res.statusCode, res.body).toBe(302);
  const consent = new URL(res.headers.location!, h.app.baseUrl);
  expect(consent.pathname).toBe("/auth/consent");
  expect(consent.searchParams.get("client_id")).toBe(client.client_id);
  expect(consent.searchParams.get("sig")).toBeTruthy();
  expect(Number(consent.searchParams.get("exp"))).toBeGreaterThan(Date.now() / 1000);
  const login = await h.app.inject({ url: `/api/auth/oauth2/authorize?${query}` });
  expect(login.statusCode, login.body).toBe(302);
  expect(new URL(login.headers.location!, h.app.baseUrl).pathname).toBe("/auth/login");
});

it.each(["https://unlisted.example/client.json"])(
  "refuses CIMD %s before a metadata request",
  async (clientId) => {
    const requests: unknown[] = [];
    const observe = (message: unknown) => {
      requests.push(message);
    };
    const channels = ["http.client.request.start", "undici:request:create"];
    channels.forEach((name) => subscribe(name, observe));
    try {
      const res = await h.app.inject({
        url: `/api/auth/oauth2/authorize?${authorizationQuery(clientId)}`,
        cookies,
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.body).toContain("Client is not on the enabled Allowed Clients list.");
      expect(requests).toEqual([]);
    } finally {
      channels.forEach((name) => unsubscribe(name, observe));
    }
  },
);

it("verifies a JWT, but refuses it until a grant can be resolved", async () => {
  const { token } = await h.app.auth.api.signJWT({
    body: {
      payload: {
        sub: "test-person",
        iss: "http://localhost/api/auth",
        aud: "http://localhost/mcp",
        exp: Math.floor(Date.now() / 1000) + 300,
      },
    },
  });
  expect(await verifyMcpJwt(h.app, token)).toMatchObject({ sub: "test-person" });
  const jwks = await h.app.inject({ url: "/api/auth/jwks" });
  expect(jwks.statusCode, jwks.body).toBe(200);
  expect(jwks.json()).toEqual(await h.app.auth.api.getJwks());
  expect(jwks.json().keys.length).toBeGreaterThan(0);
  for (const key of jwks.json().keys) expect(key).not.toHaveProperty("d");
  const res = await h.app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.body).toBe(401);
  expect(res.headers["www-authenticate"]).toContain(
    'resource_metadata="http://localhost/.well-known/oauth-protected-resource"',
  );
});

it.each(["bad signature", "expired", "another audience", "another issuer", "malformed"])(
  "refuses a JWT with %s with the challenge",
  async (kind) => {
    const payload = {
      sub: "test-person",
      iss:
        kind === "another issuer" ? "https://other.example/api/auth" : "http://localhost/api/auth",
      aud: kind === "another audience" ? "https://other.example/mcp" : "http://localhost/mcp",
      exp: Math.floor(Date.now() / 1000) + (kind === "expired" ? -60 : 300),
    };
    let { token } = await h.app.auth.api.signJWT({ body: { payload } });
    if (kind === "bad signature") {
      const parts = token.split(".");
      parts[2] = Buffer.alloc(64, 1).toString("base64url");
      token = parts.join(".");
    }
    if (kind === "malformed") token = "bad.jwt";
    await expect(verifyMcpJwt(h.app, token)).rejects.toMatchObject({ statusCode: 401 });
    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.body).toBe(401);
    expect(res.headers["www-authenticate"]).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource"',
    );
  },
);

it("lets a foreign-origin Client reach token validation", async () => {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/auth/oauth2/token",
    headers: {
      origin: "https://client.example",
      "sec-fetch-site": "cross-site",
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: "grant_type=authorization_code&code=invalid&client_id=unknown",
  });
  expect(res.statusCode, res.body).toBe(400);
  expect(res.json().error).toBeTruthy();
  expect(res.body).not.toContain("own origin");
});

it("migrates every plugin table with its schema fields", async () => {
  const schema = getSchema(h.app.auth.options);
  for (const [model, table] of Object.entries(schema)) {
    if (!model.startsWith("oauth") && model !== "jwk") continue;
    const name = `${snake(model)}s`;
    const result = await h.db.$client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
      [name],
    );
    expect(result.rows.map((row) => row.column_name).sort(), name).toEqual(
      ["id", ...Object.keys(table.fields).map(snake)].sort(),
    );
  }
});
const snake = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
