// SPDX-License-Identifier: AGPL-3.0-only
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  contracts,
  contractStatuses,
  contractTypes,
  contractTeam,
  matters,
  matterStatuses,
  matterTypes,
  matterTeam,
  requests,
  requestTypes,
  entities,
  entityTypes,
  knowledgeItems,
  knowledgeTypes,
  documents,
  documentVersions,
  documentVersionText,
  mcpToolCalls,
  orgSettings,
  users,
  eq,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { RESULT_BYTE_BUDGET } from "./results.js";

let h: TestHarness;
let admin: Record<string, string>;
let businessId: string;
let contractId: string;
let endpoint: URL;
let versionId: string;
let documentId: string;
const clients: Client[] = [];
const templates = [
  "contracts",
  "matters",
  "requests",
  "entities",
  "knowledge",
  "document-versions",
];
const views = ["inbox", "tasks/mine", "vocabulary"];
const records: {
  kind: string;
  address: string;
  tool: string;
  args: Record<string, unknown>;
  title: string;
}[] = [];
const connected: { client: Client; modern: boolean; business: boolean }[] = [];

async function connect(modern: boolean, business: boolean, toolsets?: string[]) {
  const session = business
    ? await signInCookies(h.app, "resource-business@example.com", TEST_ADMIN.password)
    : admin;
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies: session,
    payload: {
      clientName: "Resource test",
      scope: "read",
      toolsets:
        toolsets ??
        (business
          ? ["contracts", "matters", "requests", "entities", "knowledge", "documents"]
          : ["contracts", "matters", "requests", "entities", "knowledge", "documents", "tasks"]),
    },
  });
  expect(asked.statusCode, asked.body).toBe(201);
  let key = asked.json().key;
  if (!key) {
    const approved = await h.app.inject({
      method: "POST",
      url: `/api/v1/api-key-requests/${asked.json().id}/approve`,
      cookies: admin,
      payload: {},
    });
    expect(approved.statusCode, approved.body).toBe(200);
    key = (
      await h.app.inject({ url: `/api/v1/api-key-requests/${asked.json().id}`, cookies: session })
    ).json().key;
  }
  const client = new Client(
    { name: "Resources", version: "1" },
    { versionNegotiation: { mode: modern ? { pin: "2026-07-28" } : "legacy" } },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { "x-api-key": key } } }),
  );
  return client;
}
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const adminId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  businessId = (
    await provisionUser(h.app.auth, {
      email: "resource-business@example.com",
      displayName: "Business",
      password: TEST_ADMIN.password,
    })
  ).id;
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, businessId));
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  const ct = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const cs = (await h.db.select().from(contractStatuses).limit(1))[0]!;
  const [contract] = await h.db
    .insert(contracts)
    .values({
      title: "Resource agreement",
      contractTypeId: ct.id,
      statusId: cs.id,
      createdBy: adminId,
    })
    .returning();
  contractId = contract!.id;
  await h.db.insert(contractTeam).values({ contractId, userId: businessId });
  const mt = (await h.db.select().from(matterTypes).limit(1))[0]!;
  const ms = (await h.db.select().from(matterStatuses).limit(1))[0]!;
  const [matter] = await h.db
    .insert(matters)
    .values({ title: "Resource work", matterTypeId: mt.id, statusId: ms.id, createdBy: adminId })
    .returning();
  await h.db.insert(matterTeam).values({ matterId: matter!.id, userId: businessId });
  const rt = (await h.db.select().from(requestTypes).limit(1))[0]!;
  const [request] = await h.db
    .insert(requests)
    .values({
      title: "Resource ask",
      requestTypeId: rt.id,
      requesterId: businessId,
      urgency: "medium",
    })
    .returning();
  const et = (await h.db.select().from(entityTypes).limit(1))[0]!;
  const [entity] = await h.db
    .insert(entities)
    .values({ legalName: "Resource company", entityTypeId: et.id })
    .returning();
  const kt = (await h.db.select().from(knowledgeTypes).limit(1))[0]!;
  const [item] = await h.db
    .insert(knowledgeItems)
    .values({
      title: "Resource guidance",
      knowledgeTypeId: kt.id,
      createdBy: adminId,
      updatedBy: adminId,
      state: "published",
      audience: "everyone",
    })
    .returning();
  records.push(
    {
      kind: "contracts",
      address: `C-${contract!.number}`,
      tool: "contract_get",
      args: { number: contract!.number },
      title: `C-${contract!.number}: Resource agreement`,
    },
    {
      kind: "matters",
      address: `M-${matter!.number}`,
      tool: "matter_get",
      args: { number: matter!.number },
      title: `M-${matter!.number}: Resource work`,
    },
    {
      kind: "requests",
      address: `R-${request!.number}`,
      tool: "request_get",
      args: { number: request!.number },
      title: `R-${request!.number}: Resource ask`,
    },
    {
      kind: "entities",
      address: entity!.id,
      tool: "entity_get",
      args: { id: entity!.id },
      title: "Resource company",
    },
    {
      kind: "knowledge",
      address: item!.id,
      tool: "knowledge_get",
      args: { id: item!.id },
      title: "Resource guidance",
    },
  );
  const [doc] = await h.db
    .insert(documents)
    .values({ title: "Resource paper", contractId, createdBy: adminId })
    .returning();
  documentId = doc!.id;
  const [version] = await h.db
    .insert(documentVersions)
    .values({
      documentId,
      versionNumber: 1,
      fileRef: "local:resource-paper",
      kind: "draft_ours",
      originalFilename: "paper.txt",
      mimeType: "text/plain",
      byteSize: 10000,
      checksumSha256: "0".repeat(64),
      createdBy: adminId,
    })
    .returning();
  versionId = version!.id;
  await h.db.insert(documentVersionText).values({
    versionId,
    state: "ready",
    source: "native_layer",
    text: 'Words "quoted" 🌍\n'.repeat(3000),
  });
  for (const modern of [false, true])
    for (const business of [false, true])
      connected.push({ client: await connect(modern, business), modern, business });
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await h?.stop();
});

it("lists only allowed templates and views in fixed order in both eras, with capabilities and cache hints", async () => {
  for (const { client, modern, business } of connected) {
    expect(client.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
    });
    expect(client.getServerCapabilities()).not.toHaveProperty("completions");
    const listed = await client.listResourceTemplates();
    expect(listed.resourceTemplates.map((r) => r.name)).toEqual(
      templates.filter((name) => !business || name !== "entities"),
    );
    for (const resource of listed.resourceTemplates) {
      expect(resource.title).toBeTruthy();
      expect(resource.mimeType).toBe(
        resource.name === "document-versions" ? "text/plain" : "application/json",
      );
    }
    const listedViews = await client.listResources();
    expect(listedViews.resources.map((r) => r.uri)).toEqual(
      views.filter((name) => !business || name !== "tasks/mine").map((name) => `openlaw://${name}`),
    );
    for (const result of [listed, await client.listTools()]) {
      if (modern) expect(result).toMatchObject({ ttlMs: 300000, cacheScope: "private" });
      else expect(result).not.toHaveProperty("ttlMs");
    }
    if (modern) expect(listedViews).toMatchObject({ ttlMs: 0 });
    else expect(listedViews).not.toHaveProperty("ttlMs");
  }
  const narrow = await connect(true, false, ["contracts"]);
  expect((await narrow.listResourceTemplates()).resourceTemplates.map((r) => r.name)).toEqual([
    "contracts",
  ]);
  expect((await narrow.listResources()).resources.map((r) => r.uri)).toEqual([
    "openlaw://vocabulary",
  ]);
});
it("reads exactly the matching Tool's structured result and records one named ledger row per resource", async () => {
  for (const { client, modern, business } of connected) {
    const cases = [
      ...records
        .filter((r) => !business || r.kind !== "entities")
        .map((r) => ({ ...r, uri: `openlaw://${r.kind}/${r.address}` })),
      ...[
        { kind: "inbox", tool: "requests_list", title: "Inbox" },
        { kind: "tasks", tool: "tasks_list", title: "My Tasks" },
        { kind: "vocabulary", tool: "vocabulary", title: "OpenLaw vocabulary" },
      ]
        .filter((r) => !business || r.kind !== "tasks")
        .map((r) => ({
          ...r,
          uri: `openlaw://${r.kind === "tasks" ? "tasks/mine" : r.kind}`,
          args: {},
        })),
    ];
    for (const entry of cases) {
      const tool = await client.callTool({ name: `openlaw_${entry.tool}`, arguments: entry.args });
      expect(tool.isError, JSON.stringify(tool)).not.toBe(true);
      const before = await h.db.select().from(mcpToolCalls);
      const result = await client.readResource({ uri: entry.uri });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri: entry.uri,
        mimeType: "application/json",
        _meta: { title: entry.title },
      });
      expect(JSON.parse(resourceText(result))).toEqual(tool.structuredContent);
      if (modern) expect(result).toMatchObject({ ttlMs: 0 });
      else expect(result).not.toHaveProperty("ttlMs");
      const added = (await h.db.select().from(mcpToolCalls)).filter(
        (r) => !before.some((b) => b.id === r.id),
      );
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ tool: `resource:${entry.kind}`, outcome: "success" });
      expect(added[0]!.durationMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(added)).not.toContain(entry.uri);
    }
  }
  const ledger = await h.app.inject({ url: "/api/v1/audit-log/tool-calls", cookies: admin });
  expect(ledger.statusCode, ledger.body).toBe(200);
  expect(ledger.body).toContain("resource:");
});
it("returns the first Version page as bounded plain text with T26 continuation arguments", async () => {
  for (const { client } of connected) {
    const tool = await client.callTool({
      name: "openlaw_document_read",
      arguments: { documentId, versionId },
    });
    const result = await client.readResource({ uri: `openlaw://document-versions/${versionId}` });
    expect(result.contents[0]!.mimeType).toBe("text/plain");
    const content = tool.structuredContent as { text: { text: string }; nextCursor: string };
    expect(resourceText(result)).toContain(content.text.text);
    expect(resourceText(result)).toContain("openlaw_document_read");
    expect(resourceText(result)).toContain(content.nextCursor);
    expect(resourceText(result)).toContain(documentId);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(RESULT_BYTE_BUDGET);
  }
});
it("uses the Tool's not-found error outside reach and refuses resources outside the grant", async () => {
  const client = connected.find((c) => c.business)!.client;
  await h.db.delete(contractTeam).where(eq(contractTeam.contractId, contractId));
  try {
    for (const [uri, tool, args] of [
      [`openlaw://contracts/${records[0]!.address}`, "openlaw_contract_get", records[0]!.args],
      [
        `openlaw://document-versions/${versionId}`,
        "openlaw_document_read",
        { documentId, versionId },
      ],
    ] as const) {
      const expected = await client.callTool({ name: tool, arguments: args });
      const result = await client.readResource({ uri });
      expect(result).toMatchObject({ isError: true, content: expected.content });
      expect(JSON.stringify(result)).toContain("not_found");
      if (tool === "openlaw_document_read") {
        const missing = await client.readResource({
          uri: "openlaw://document-versions/00000000-0000-4000-8000-000000000000",
        });
        expect(missing).toMatchObject({ isError: true, content: result.content });
      }
    }
  } finally {
    await h.db.insert(contractTeam).values({ contractId, userId: businessId });
  }
  const narrow = await connect(true, false, ["contracts"]);
  for (const [reader, uri] of [
    [narrow, "openlaw://matters/M-1"],
    [client, `openlaw://entities/${records[3]!.address}`],
    [client, "openlaw://tasks/mine"],
  ] as const) {
    expect(await reader.readResource({ uri })).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("tool_outside_grant") }],
    });
  }
});

function resourceText(result: Awaited<ReturnType<Client["readResource"]>>) {
  const content = result.contents[0]!;
  if (!("text" in content)) throw new Error("Expected a text resource.");
  return content.text;
}

it("rejects malformed addresses and never stores the supplied address in the ledger", async () => {
  const client = connected[0]!.client;
  for (const uri of [
    "openlaw://contracts/C-1/extra",
    "openlaw://contracts/C-1?number=2",
    "openlaw://contracts/C-1#fragment",
    "openlaw://contracts/C-9007199254740992",
    "openlaw://contracts/M-1",
    "openlaw://entities/not-an-id",
    "openlaw://document-versions/not-an-id",
    "openlaw://unknown/private-record",
  ]) {
    const before = await h.db.select().from(mcpToolCalls);
    expect(await client.readResource({ uri })).toMatchObject({ isError: true });
    const added = (await h.db.select().from(mcpToolCalls)).filter(
      (r) => !before.some((b) => b.id === r.id),
    );
    expect(added).toHaveLength(1);
    expect(added[0]!.tool).toMatch(/^resource:[a-z-]+$/);
    expect(JSON.stringify(added)).not.toContain(uri);
  }
  const numeric = await client.readResource({
    uri: `openlaw://contracts/${records[0]!.args.number}`,
  });
  const prefixed = await client.readResource({ uri: `openlaw://contracts/${records[0]!.address}` });
  expect(resourceText(numeric)).toBe(resourceText(prefixed));
});

it("admits one resource or prompt ledger prefix and sanitizes other colon-bearing names", async () => {
  const client = connected[0]!.client;
  for (const [name, expected] of [
    ["resource:contracts", "resource:contracts"],
    ["prompt:summary", "prompt:summary"],
    ["resource:prompt:summary", "unknown_tool"],
    ["other:contracts", "unknown_tool"],
    ["resource:contracts/C-1", "unknown_tool"],
    ["resource:", "unknown_tool"],
    [`prompt:${"x".repeat(65)}`, "unknown_tool"],
  ]) {
    const before = await h.db.select().from(mcpToolCalls);
    await client.callTool({ name: name! });
    const added = (await h.db.select().from(mcpToolCalls)).filter(
      (r) => !before.some((b) => b.id === r.id),
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ tool: expected, outcome: "unknown_tool" });
  }
});

it("keeps JSON escaping from imposing a second, smaller budget on record resources", async () => {
  const client = connected[0]!.client;
  await h.db
    .update(contracts)
    .set({ description: "\\".repeat(6000) })
    .where(eq(contracts.id, contractId));
  try {
    const tool = await client.callTool({
      name: "openlaw_contract_get",
      arguments: records[0]!.args,
    });
    expect(tool.isError, JSON.stringify(tool)).not.toBe(true);
    const resource = await client.readResource({
      uri: `openlaw://contracts/${records[0]!.address}`,
    });
    expect(resource.isError, JSON.stringify(resource)).not.toBe(true);
    expect(JSON.parse(resourceText(resource))).toEqual(tool.structuredContent);
    expect(Buffer.byteLength(JSON.stringify(resource))).toBeLessThan(64000);
  } finally {
    await h.db.update(contracts).set({ description: null }).where(eq(contracts.id, contractId));
  }
});
