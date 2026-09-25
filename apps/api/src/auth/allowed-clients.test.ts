// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import { allowedClientLinks, allowedClients, oauthClients, eq } from "@openlaw/db";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
const transport = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@better-auth/cimd/node", () => ({ fetchClientMetadataResource: transport }));
let h: TestHarness;
let cookies: Record<string, string>;
const claude = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const code = "https://claude.ai/oauth/claude-code-client-metadata";
const chatgpt = "https://chatgpt.com/oauth/client.json";
const connection = "https://chatgpt.com/oauth/test-connection/client.json";
const redirects: Record<string, string[]> = {
  [claude]: ["https://claude.ai/api/mcp/auth_callback", "https://attacker.example/callback"],
  [code]: ["http://localhost/callback", "http://127.0.0.1/callback"],
  [chatgpt]: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  [connection]: ["https://chatgpt.com/connector/oauth/test-connection"],
};
beforeAll(async () => {
  const { publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
  transport.mockImplementation(async (input) => {
    const id = String(input);
    if (id === "https://chatgpt.com/jwks") return Response.json({ keys: [jwk] });
    if (!redirects[id]) throw new Error(`Unexpected metadata fetch ${id}`);
    return Response.json({
      client_id: id,
      client_name: "Published Client",
      redirect_uris: redirects[id],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: id === chatgpt ? "private_key_jwt" : "none",
      ...(id === chatgpt ? { jwks_uri: "https://chatgpt.com/jwks" } : {}),
    });
  });
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => {
  await h?.stop();
});
function authorize(clientId: string, redirect: string) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "toolset:contracts offline_access",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "test-state",
  });
  return h.app.inject({ url: `/api/auth/oauth2/authorize?${query}`, cookies });
}
it.each([
  [claude, redirects[claude]![0]!],
  [code, "http://localhost:49152/callback"],
  [code, "http://127.0.0.1:54321/callback"],
  [chatgpt, redirects[chatgpt]![0]!],
  [connection, redirects[connection]![0]!],
])("admits %s with the allowed callback %s and links the plugin row", async (id, redirect) => {
  const result = await authorize(id, redirect);
  expect(result.statusCode, result.body).toBe(302);
  expect(new URL(result.headers.location!, h.app.baseUrl).pathname).toBe("/auth/consent");
  const [link] = await h.db
    .select()
    .from(allowedClientLinks)
    .where(eq(allowedClientLinks.clientId, id));
  expect(link).toBeTruthy();
  const [row] = await h.db
    .select()
    .from(allowedClients)
    .where(eq(allowedClients.id, link!.allowedClientId));
  expect(row?.kind).toBe("published");
});
it.each([
  "https://unlisted.example/client.json",
  "https://chatgpt.com.evil.example/oauth/id/client.json",
  "https://chatgpt.com/oauth/id/client.json?extra=1",
  "https://claude.ai/oauth/mcp-oauth-client-metadata#x",
])("refuses unlisted %s before fetching", async (id) => {
  transport.mockClear();
  expect((await authorize(id, "https://client.example/callback")).statusCode).toBe(400);
  expect(transport).not.toHaveBeenCalled();
});
it("refuses a disabled published identity before fetching, including a cached connection", async () => {
  const [row] = await h.db
    .select()
    .from(allowedClients)
    .where(eq(allowedClients.metadataUrl, chatgpt));
  const path = `/api/v1/mcp-settings/allowed-clients/${row!.id}`;
  const off = await h.app.inject({
    method: "PATCH",
    url: path,
    cookies,
    payload: { enabled: false },
  });
  expect(off.statusCode, off.body).toBe(200);
  transport.mockClear();
  for (const id of [chatgpt, connection, "https://chatgpt.com/oauth/new/client.json"])
    expect((await authorize(id, "https://chatgpt.com/connector/oauth/new")).statusCode).toBe(400);
  expect(transport).not.toHaveBeenCalled();
  for (const id of [chatgpt, connection])
    expect(
      (await h.db.select().from(oauthClients).where(eq(oauthClients.clientId, id)))[0]?.disabled,
    ).toBe(true);
  await h.app.inject({ method: "PATCH", url: path, cookies, payload: { enabled: true } });
  expect((await authorize(connection, redirects[connection]![0]!)).statusCode).toBe(302);
});
it.each([
  [claude, "https://attacker.example/callback"],
  [code, "http://localhost:123/callback?extra=1"],
  [code, "http://127.0.0.2:123/callback"],
  [connection, "https://chatgpt.com/connector/oauth/id/extra"],
])("enforces the code-owned redirect policy for %s", async (id, redirect) => {
  expect((await authorize(id!, redirect!)).statusCode).toBe(400);
});
it("requires exact registered redirects, refuses unlisted plugin rows and disabled Clients", async () => {
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/mcp-settings/allowed-clients",
    cookies,
    payload: { name: "Local Client", callbackUrls: ["http://127.0.0.1:43210/callback"] },
  });
  expect(created.statusCode, created.body).toBe(201);
  const row = created.json();
  expect((await authorize(row.clientId, "http://127.0.0.1:43210/callback")).statusCode).toBe(302);
  expect((await authorize(row.clientId, "http://127.0.0.1:43211/callback")).statusCode).toBe(400);
  await h.app.inject({
    method: "PATCH",
    url: `/api/v1/mcp-settings/allowed-clients/${row.id}`,
    cookies,
    payload: { enabled: false },
  });
  expect((await authorize(row.clientId, "http://127.0.0.1:43210/callback")).statusCode).toBe(400);
  await h.db.delete(allowedClients).where(eq(allowedClients.id, row.id));
  expect((await authorize(row.clientId, "http://127.0.0.1:43210/callback")).statusCode).toBe(400);
});
