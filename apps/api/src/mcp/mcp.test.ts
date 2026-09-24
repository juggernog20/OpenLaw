// SPDX-License-Identifier: AGPL-3.0-only
import { buildApp } from "../app.js";
import { testDeps } from "../testing/deps.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { apikeys, eq, orgSettings, users, mcpToolCalls, desc, sql } from "@openlaw/db";
import { effectiveEnvironment, emptySettings } from "../modules/advanced-settings/config.js";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
let memberId: string;
let endpoint: URL;
const clients: Client[] = [];
beforeAll(async () => {
  h = await startHarness({
    advancedRuntime: {
      baseline: { MCP_RATE_LIMIT_PER_HOUR: "2" },
      active: effectiveEnvironment({ MCP_RATE_LIMIT_PER_HOUR: "2" }, emptySettings()),
    },
  });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const user = await provisionUser(h.app.auth, {
    email: "member@example.com",
    displayName: "Legal Member",
    password: TEST_ADMIN.password,
  });
  memberId = user.id;
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, memberId));
  member = await signInCookies(h.app, "member@example.com", TEST_ADMIN.password);
  await h.db.update(orgSettings).set({
    mcpEnabled: true,
    mcpLegalApiKeysEnabled: true,
    mcpBusinessApiKeysEnabled: true,
    name: "Example Legal",
  });
  endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
async function key() {
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies: member,
    payload: { clientName: "Approved script", toolsets: ["contracts"], scope: "read" },
  });
  expect(asked.statusCode, asked.body).toBe(201);
  const id = asked.json().id;
  const approved = await h.app.inject({
    method: "POST",
    url: `/api/v1/api-key-requests/${id}/approve`,
    cookies: admin,
    payload: {},
  });
  expect(approved.statusCode, approved.body).toBe(200);
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/api-key-requests/${id}`,
    cookies: member,
  });
  return read.json().key as string;
}
async function connect(secret: string, modern: boolean) {
  const client = new Client(
    { name: "Untrusted protocol name", version: "1" },
    { versionNegotiation: { mode: modern ? { pin: "2026-07-28" } : "legacy" } },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: modern
          ? { Authorization: `Bearer ${secret}`, Origin: "https://foreign.example" }
          : { "x-api-key": secret },
      },
    }),
  );
  return client;
}
it.each([false, true])(
  "connects and lists in the modern era=%s, and records a read without content",
  async (modern) => {
    const client = await connect(await key(), modern);
    expect(client.getNegotiatedProtocolVersion()).toBe(modern ? "2026-07-28" : "2025-11-25");
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(["openlaw_whoami"]);
    const result = await client.callTool({ name: "openlaw_whoami", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      person: { id: memberId, displayName: "Legal Member" },
      accountType: "legal_team_member",
      toolsets: ["guide", "contracts"],
      scope: "read",
      organizationName: "Example Legal",
    });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    const rows = await h.db
      .select()
      .from(mcpToolCalls)
      .where(eq(mcpToolCalls.personId, memberId))
      .orderBy(desc(mcpToolCalls.createdAt));
    expect(rows[0]!).toMatchObject({
      clientName: "Approved script",
      tool: "openlaw_whoami",
      outcome: "success",
      personId: memberId,
    });
    expect(rows[0]!.credentialId).toBeTruthy();
    expect(rows[0]!.requestId).toBeTruthy();
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
    const columns = await h.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mcp_tool_calls'`,
    );
    expect(columns.rows.map((column) => column.column_name).sort()).toEqual(
      [
        "id",
        "person_id",
        "credential_id",
        "client_name",
        "tool",
        "outcome",
        "duration_ms",
        "request_id",
        "created_at",
      ].sort(),
    );
  },
);
it("challenges absent, cookie-only, unknown, expired and revoked credentials", async () => {
  const secret = await key();
  for (const headers of [{}, { "x-api-key": "ol_unknown" }, { authorization: "Bearer unknown" }]) {
    const r = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      cookies: admin,
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(r.statusCode, r.body).toBe(401);
    expect(r.headers["www-authenticate"]).toBe("Bearer");
  }
  for (const patch of [
    { expiresAt: new Date(0) },
    { expiresAt: new Date(Date.now() + 86400000), enabled: false },
  ]) {
    await h.db.update(apikeys).set(patch).where(eq(apikeys.referenceId, memberId));
    const r = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "x-api-key": secret },
      payload: {},
    });
    expect(r.statusCode, r.body).toBe(401);
    expect(r.headers["www-authenticate"]).toBe("Bearer");
  }
});
it("re-reads master, group, account type and archival for an already connected Client", async () => {
  const secret = await key();
  const client = await connect(secret, true);
  for (const patch of [{ mcpEnabled: false }, { mcpLegalApiKeysEnabled: false }]) {
    await h.db.update(orgSettings).set(patch);
    await expect(client.listTools()).rejects.toThrow();
    const r = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "x-api-key": secret },
      payload: {},
    });
    expect(r.statusCode).toBe(401);
    expect(r.headers["www-authenticate"]).toBe("Bearer");
    await h.db.update(orgSettings).set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true });
  }
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, memberId));
  await h.db.update(orgSettings).set({ mcpBusinessApiKeysEnabled: false });
  await expect(client.listTools()).rejects.toThrow();
  await h.db.update(orgSettings).set({ mcpBusinessApiKeysEnabled: true });
  expect((await client.callTool({ name: "openlaw_whoami" })).structuredContent).toMatchObject({
    accountType: "business_user",
  });
  await h.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, memberId));
  await expect(client.listTools()).rejects.toThrow();
  await h.db
    .update(users)
    .set({ role: "legal_team_member", archivedAt: null })
    .where(eq(users.id, memberId));
});
it("records unknown calls as named Tool errors and hides MCP from OpenAPI", async () => {
  const client = await connect(await key(), false);
  const result = await client.callTool({ name: "openlaw_unknown" });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    expect.objectContaining({ text: expect.stringContaining("unknown_tool") }),
  ]);
  const rows = await h.db
    .select({ outcome: mcpToolCalls.outcome })
    .from(mcpToolCalls)
    .where(eq(mcpToolCalls.tool, "openlaw_unknown"));
  expect(rows).toEqual([{ outcome: "unknown_tool" }]);
  expect(h.app.swagger().paths).not.toHaveProperty("/mcp");
});
it("enforces the database allowance across simultaneous calls and resets at the next hour", async () => {
  const secret = await key();
  const client = await connect(secret, true);
  await h.db.update(orgSettings).set({
    advancedSettings: JSON.stringify({
      version: "rate-test",
      values: { MCP_RATE_LIMIT_PER_HOUR: "999" },
    }),
  });
  const replica = await buildApp(
    testDeps({
      db: h.db,
      advancedRuntime: {
        baseline: { MCP_RATE_LIMIT_PER_HOUR: "2" },
        active: { MCP_RATE_LIMIT_PER_HOUR: "2" },
      },
    }),
  );
  const replicaUrl = new URL("/mcp", await replica.listen({ port: 0, host: "127.0.0.1" }));
  const replicaClient = new Client({ name: "Second API process", version: "1" });
  let results;
  try {
    await replicaClient.connect(
      new StreamableHTTPClientTransport(replicaUrl, {
        requestInit: { headers: { "x-api-key": secret } },
      }),
    );
    results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? client : replicaClient).callTool({ name: "openlaw_whoami" }),
      ),
    );
  } finally {
    await replicaClient.close();
    await replica.close();
  }
  expect(results.filter((r) => !r.isError)).toHaveLength(2);
  const refused = results.filter((r) => r.isError);
  expect(refused).toHaveLength(4);
  for (const result of refused) {
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(
          /^rate_limited: The limit is 2 Tool calls per hour per credential\. It resets at \d{4}-.*Z\.$/,
        ),
      },
    ]);
  }
  const rows = await h.db
    .select()
    .from(mcpToolCalls)
    .orderBy(desc(mcpToolCalls.createdAt))
    .limit(6);
  expect(rows.filter((r) => r.outcome === "rate_limited")).toHaveLength(4);
  expect(rows.filter((r) => r.outcome === "success")).toHaveLength(2);
  const credential = rows[0]!.credentialId;
  await h.db
    .update(mcpToolCalls)
    .set({ createdAt: sql`${mcpToolCalls.createdAt} - interval '2 hours'` })
    .where(eq(mcpToolCalls.credentialId, credential));
  expect((await client.callTool({ name: "openlaw_whoami" })).isError).not.toBe(true);
  const other = await connect(await key(), true);
  expect((await other.callTool({ name: "openlaw_whoami" })).isError).not.toBe(true);
  await h.db.update(orgSettings).set({ advancedSettings: null });
});

it("authenticates before parsing a body and challenges GET and DELETE too", async () => {
  for (const method of ["GET", "DELETE"] as const) {
    const response = await h.app.inject({ method, url: "/mcp", cookies: admin });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
  }
  const response = await h.app.inject({
    method: "POST",
    url: "/mcp",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  expect(response.statusCode).toBe(401);
  expect(response.headers["www-authenticate"]).toBe("Bearer");
});
