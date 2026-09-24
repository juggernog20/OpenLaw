// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from "fastify";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, orgSettings, users } from "@openlaw/db";
import { mcpRoutes } from "./routes.js";
import { toolRegister, type ToolDefinition } from "./register.js";
import { startHarness, TEST_ADMIN, signInCookies, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let ownerId: string;
const mounted = Fastify();
const clients: Client[] = [];
let endpoint: URL;
const read: ToolDefinition = {
  name: "test_contract_read",
  title: "Read Contract",
  description: "Read a Contract.",
  toolset: "contracts",
  kind: "read",
  legalUser: "on",
  businessUser: "on",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  run: async () => ({ ok: true }),
};
const write: ToolDefinition = {
  ...read,
  name: "test_contract_write",
  kind: "write",
  businessUser: "off",
  annotations: { ...read.annotations, readOnlyHint: false },
};
const invalid: ToolDefinition = {
  ...read,
  name: "test_invalid_output",
  run: async () => ({ secret: "record content must never leak" }),
};
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const [owner] = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  ownerId = owner!.id;
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  mounted.decorate("db", h.db).decorate("auth", h.app.auth);
  await mounted.register(mcpRoutes({}, [...toolRegister, read, write, invalid]));
  endpoint = new URL("/mcp", await mounted.listen({ port: 0, host: "127.0.0.1" }));
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await mounted.close();
  await h?.stop();
});
async function connect(toolsets: string[], scope: "read" | "write", modern = true) {
  const response = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies: admin,
    payload: { clientName: "Grant test", toolsets, scope },
  });
  expect(response.statusCode, response.body).toBe(201);
  const client = new Client(
    { name: "Grant test", version: "1" },
    { versionNegotiation: { mode: modern ? { pin: "2026-07-28" } : "legacy" } },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "x-api-key": response.json().key } },
    }),
  );
  return client;
}
async function names(client: Client) {
  return (await client.listTools()).tools.map((t) => t.name);
}
async function refusal(client: Client, name: string, code: string) {
  const result = await client.callTool({ name });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(`${code}:`) }]);
}
it.each([false, true])(
  "filters tools/list and refuses calls outside the Toolsets or read-only scope, modern=%s",
  async (modern) => {
    const narrow = await connect(["matters"], "write", modern);
    expect(await names(narrow)).toEqual(["openlaw_whoami"]);
    await refusal(narrow, read.name, "tool_outside_grant");
    const reader = await connect(["contracts"], "read", modern);
    expect(await names(reader)).toEqual(["openlaw_whoami", read.name, invalid.name]);
    await refusal(reader, write.name, "mcp_read_only");
    const writer = await connect(["contracts"], "write", modern);
    expect(await names(writer)).toContain(write.name);
    expect((await writer.callTool({ name: write.name })).structuredContent).toEqual({ ok: true });
    await h.db.update(orgSettings).set({ mcpReadOnly: true });
    expect(await names(writer)).not.toContain(write.name);
    await refusal(writer, write.name, "mcp_read_only");
    await h.db.update(orgSettings).set({ mcpReadOnly: false, mcpToolsetCeiling: ["matters"] });
    expect(await names(writer)).toEqual(["openlaw_whoami"]);
    await refusal(writer, read.name, "tool_outside_grant");
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["matters", "contracts"] });
    await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, ownerId));
    expect(await names(writer)).not.toContain(write.name);
    await refusal(writer, write.name, "tool_outside_grant");
    await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, ownerId));
  },
);
it("records invalid input and output once, without recording or returning their content", async () => {
  const client = await connect(["contracts"], "write");
  const before = await h.db.$client.query("select count(*)::int as n from mcp_tool_calls");
  const result = await client.callTool({
    name: "openlaw_whoami",
    arguments: { unexpected: "private record content" },
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("invalid_arguments");
  expect(JSON.stringify(result)).not.toContain("private record content");
  await refusal(client, invalid.name, "internal_error");
  const after = await h.db.$client.query("select count(*)::int as n from mcp_tool_calls");
  expect(after.rows[0].n - before.rows[0].n).toBe(2);
  const rows = await h.db.$client.query("select * from mcp_tool_calls");
  expect(JSON.stringify(rows.rows)).not.toContain("record content");
  expect(rows.rows.some((r) => r.outcome === "invalid_arguments")).toBe(true);
  expect(rows.rows.some((r) => r.outcome === "internal_error")).toBe(true);
});
