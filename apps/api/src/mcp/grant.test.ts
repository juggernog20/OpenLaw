// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, orgSettings, users, mcpToolCalls, apiKeyRequests, sql } from "@openlaw/db";
import { toolRegister, type ToolDefinition } from "./register.js";
import { startHarness, TEST_ADMIN, signInCookies, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let ownerId: string;
const credentialIds = new WeakMap<Client, string>();
const clients: Client[] = [];
const guideNames = toolRegister.filter((t) => t.toolset === "guide").map((t) => t.name);
const matterNames = toolRegister.filter((t) => t.toolset === "matters").map((t) => t.name);
const contractReadNames = toolRegister
  .filter((t) => t.toolset === "contracts" && t.kind === "read")
  .map((t) => t.name);
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
  h = await startHarness({
    mcpTools: [
      ...toolRegister,
      read,
      write,
      invalid,
      ...(["team", "administration"] as const).flatMap((toolset) => [
        {
          ...read,
          name: `test_${toolset}_off`,
          toolset,
          legalUser: "off" as const,
          businessUser: "off" as const,
        },
        { ...read, name: `test_${toolset}_on`, toolset },
      ]),
      ...Array.from({ length: 5 }, (_, index): ToolDefinition => ({
        ...read,
        name: `test_paged_${index}`,
        toolset: "documents",
        inputSchema: z.object({ text: z.string().describe("UTF-8 文".repeat(2000)) }),
      })),
    ],
    advancedRuntime: {
      baseline: { MCP_RATE_LIMIT_PER_HOUR: "invalid" },
      active: { MCP_RATE_LIMIT_PER_HOUR: "invalid" },
    },
  });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const [owner] = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  ownerId = owner!.id;
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
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
  const [approved] = await h.db
    .select({ keyId: apiKeyRequests.keyId })
    .from(apiKeyRequests)
    .where(eq(apiKeyRequests.id, response.json().id));
  credentialIds.set(client, approved!.keyId!);
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "x-api-key": response.json().key } },
    }),
  );
  return client;
}
async function names(client: Client) {
  // These assertions read server policy after a change, rather than the Client's five-minute cache.
  return (await client.listTools(undefined, { cacheMode: "refresh" })).tools.map((t) => t.name);
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
    expect(await names(narrow)).toEqual([...guideNames, ...matterNames]);
    await refusal(narrow, read.name, "tool_outside_grant");
    const reader = await connect(["contracts"], "read", modern);
    expect(await names(reader)).toEqual([
      ...guideNames,
      ...contractReadNames,
      read.name,
      invalid.name,
    ]);
    await refusal(reader, write.name, "mcp_read_only");
    const writer = await connect(["contracts"], "write", modern);
    expect(await names(writer)).toContain(write.name);
    expect((await writer.callTool({ name: write.name })).structuredContent).toEqual({ ok: true });
    // The policy and the owner's role are shared with every later test,
    // so a failed assertion below must not leave them changed.
    const [policy] = await h.db
      .select({
        mcpReadOnly: orgSettings.mcpReadOnly,
        mcpToolsetCeiling: orgSettings.mcpToolsetCeiling,
      })
      .from(orgSettings);
    try {
      await h.db.update(orgSettings).set({ mcpReadOnly: true });
      await refusal(writer, write.name, "mcp_read_only");
      expect(await names(writer)).not.toContain(write.name);
      await h.db.update(orgSettings).set({ mcpReadOnly: false, mcpToolsetCeiling: ["matters"] });
      expect(await names(writer)).toEqual(guideNames);
      await refusal(writer, read.name, "tool_outside_grant");
      await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["matters", "contracts"] });
      await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, ownerId));
      expect(await names(writer)).not.toContain(write.name);
      await refusal(writer, write.name, "tool_outside_grant");
    } finally {
      await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, ownerId));
      await h.db.update(orgSettings).set({
        mcpReadOnly: policy!.mcpReadOnly,
        mcpToolsetCeiling: policy!.mcpToolsetCeiling,
      });
    }
  },
);
it("records invalid input and output once, without recording or returning their content", async () => {
  const client = await connect(["contracts"], "write");
  const credential = eq(mcpToolCalls.credentialId, credentialIds.get(client)!);
  const [before] = await h.db
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpToolCalls)
    .where(credential);
  const result = await client.callTool({
    name: "openlaw_whoami",
    arguments: { unexpected: "private record content" },
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("invalid_arguments");
  expect(JSON.stringify(result)).not.toContain("private record content");
  await refusal(client, invalid.name, "internal_error");
  const [after] = await h.db
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpToolCalls)
    .where(credential);
  expect(after!.n - before!.n).toBe(2);
  const rows = await h.db.select().from(mcpToolCalls).where(credential);
  expect(JSON.stringify(rows)).not.toContain("record content");
  expect(rows.some((r) => r.outcome === "invalid_arguments")).toBe(true);
  expect(rows.some((r) => r.outcome === "internal_error")).toBe(true);
});

it("keeps the default allowance when the deployment rate limit is invalid", async () => {
  const client = await connect(["contracts"], "read");
  await h.db.insert(mcpToolCalls).values(
    Array.from({ length: 600 }, (_, index) => ({
      personId: ownerId,
      credentialId: credentialIds.get(client)!,
      clientName: "Grant test",
      tool: "openlaw_whoami",
      outcome: "success",
      requestId: `prior-${index}`,
    })),
  );
  const result = await client.callTool({ name: "openlaw_whoami" });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    {
      type: "text",
      text: expect.stringContaining(
        "rate_limited: The limit is 600 Tool calls per hour per credential.",
      ),
    },
  ]);
});

it("pages tools/list by cursor under the byte budget", async () => {
  await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["matters", "contracts", "documents"] });
  const client = await connect(["documents"], "read");
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await client.request({ method: "tools/list", params: cursor ? { cursor } : {} });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64_000);
    seen.push(...page.tools.map((tool) => tool.name));
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  expect(seen).toEqual([
    ...guideNames,
    ...toolRegister
      .filter((tool) => tool.toolset === "documents" && tool.kind === "read")
      .map((tool) => tool.name),
    ...Array.from({ length: 5 }, (_, index) => `test_paged_${index}`),
  ]);
});

it.each([false, true])(
  "enforces Team and Administration audiences at list and call, modern=%s",
  async (modern) => {
    const client = await connect(["contracts"], "write", modern);
    const [policy] = await h.db.select().from(orgSettings);
    try {
      await h.db
        .update(orgSettings)
        .set({ mcpToolsetCeiling: ["contracts", "team", "administration"] });
      // A cached credential may still name a Toolset that its owner can no longer choose.
      await h.db
        .update(apiKeyRequests)
        .set({ toolsets: ["contracts", "team", "administration"] })
        .where(eq(apiKeyRequests.keyId, credentialIds.get(client)!));
      for (const role of ["administrator", "legal_team_member", "business_user"] as const) {
        await h.db.update(users).set({ role }).where(eq(users.id, ownerId));
        const listed = await names(client);
        for (const toolset of ["team", "administration"]) {
          expect(listed).not.toContain(`test_${toolset}_off`);
          await refusal(client, `test_${toolset}_off`, "tool_outside_grant");
        }
        if (role === "administrator") {
          expect(listed).toContain("test_administration_on");
          expect(
            (await client.callTool({ name: "test_administration_on" })).structuredContent,
          ).toEqual({ ok: true });
        } else {
          expect(listed).not.toContain("test_administration_on");
          await refusal(client, "test_administration_on", "tool_outside_grant");
        }
      }
    } finally {
      await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, ownerId));
      await h.db.update(orgSettings).set({ mcpToolsetCeiling: policy!.mcpToolsetCeiling });
    }
  },
);
