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
  mcpToolCalls,
  orgSettings,
  users,
  eq,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let businessId: string;
let member: Record<string, string>;
let contractId: string;
let endpoint: URL;
const clients: Client[] = [];
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
    ? await signInCookies(h.app, "prompt-business@example.com", TEST_ADMIN.password)
    : member;
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies: session,
    payload: {
      clientName: "Prompt test",
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
    { name: "Prompts", version: "1" },
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
  const legal = await provisionUser(h.app.auth, {
    email: "prompt-member@example.com",
    displayName: "Legal Member",
    password: TEST_ADMIN.password,
  });
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, legal.id));
  member = await signInCookies(h.app, "prompt-member@example.com", TEST_ADMIN.password);
  businessId = (
    await provisionUser(h.app.auth, {
      email: "prompt-business@example.com",
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
  await h.db.insert(requests).values({
    title: "Urgent Request",
    requestTypeId: rt.id,
    requesterId: businessId,
    urgency: "critical",
  });
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
  for (const modern of [false, true])
    for (const business of [false, true])
      connected.push({ client: await connect(modern, business), modern, business });
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await h?.stop();
});

it("lists prompts in fixed order for the current grant and audience in both eras", async () => {
  for (const { client, modern, business } of connected) {
    expect(client.getServerCapabilities()).toMatchObject({ prompts: { listChanged: true } });
    const result = await client.listPrompts();
    expect(result.prompts).toEqual([
      ...(!business
        ? [
            {
              name: "triage_inbox",
              title: "Triage the Inbox",
              arguments: [{ name: "limit", description: expect.any(String), required: false }],
              description: expect.any(String),
            },
          ]
        : []),
      {
        name: "summarize_record",
        title: "Summarize a record",
        arguments: [{ name: "record", description: expect.any(String), required: true }],
        description: expect.any(String),
      },
    ]);
    if (modern) expect(result).toMatchObject({ ttlMs: 300000, cacheScope: "private" });
    else expect(result).not.toHaveProperty("ttlMs");
  }
  for (const toolsets of [["contracts"], ["matters"], ["entities"], ["knowledge"], ["documents"]]) {
    const client = await connect(true, false, toolsets);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(
      toolsets[0] === "documents" ? [] : ["summarize_record"],
    );
  }
});

async function recordedGet(client: Client, name: string, args?: Record<string, string>) {
  const before = await h.db.select().from(mcpToolCalls);
  const result = await client.getPrompt({ name, arguments: args });
  const added = (await h.db.select().from(mcpToolCalls)).filter(
    (row) => !before.some((old) => old.id === row.id),
  );
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({
    tool: `prompt:${name}`,
    outcome: result.isError ? expect.any(String) : "success",
  });
  expect(added[0]!.durationMs).toBeGreaterThanOrEqual(0);
  for (const value of Object.values(args ?? {})) {
    if (value.length > 10) expect(JSON.stringify(added)).not.toContain(value);
  }
  return result;
}

function contents(result: Awaited<ReturnType<Client["getPrompt"]>>) {
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.messages.every((message) => message.role === "user")).toBe(true);
  const instruction = result.messages.find((m) => m.content.type === "text")?.content;
  const embedded = result.messages.find((m) => m.content.type === "resource")?.content;
  if (
    instruction?.type !== "text" ||
    embedded?.type !== "resource" ||
    !("text" in embedded.resource)
  )
    throw new Error("Expected an instruction and an embedded text resource.");
  expect(instruction.text.split(/\s+/).length).toBeLessThan(400);
  return { instruction: instruction.text, resource: embedded.resource };
}

it("embeds the current T19 Inbox and gives the person control of triage and Conversion", async () => {
  for (const { client } of connected.filter((entry) => !entry.business)) {
    for (const args of [undefined, { limit: "1" }]) {
      const expected = await client.callTool({
        name: "openlaw_requests_list",
        arguments: args ? { limit: 1 } : {},
      });
      const result = contents(await recordedGet(client, "triage_inbox", args));
      expect(result.resource).toMatchObject({
        uri: "openlaw://inbox",
        mimeType: "application/json",
      });
      expect(JSON.parse(result.resource.text)).toEqual(expected.structuredContent);
      expect(JSON.parse(result.resource.text).requests).toHaveLength(args ? 1 : 2);
      for (const term of [
        "openlaw_request_get",
        "openlaw_vocabulary",
        "openlaw_people_list",
        "openlaw_request_assign",
        "openlaw_comment_post",
        "Contract",
        "Matter",
        "urgency",
        "table",
        "confirmation",
        "http://localhost/inbox/{number}",
      ])
        expect(result.instruction).toContain(term);
      expect(result.instruction).toMatch(/never.*create Tools/i);
    }
  }
});

it("summarizes either address form through the resource templates, with the get Tool's exact content", async () => {
  for (const { client, business } of connected) {
    for (const record of records.filter((r) => !business || r.kind !== "entities")) {
      const expected = await client.callTool({
        name: `openlaw_${record.tool}`,
        arguments: record.args,
      });
      const kind = {
        contracts: "contract",
        matters: "matter",
        requests: "request",
        entities: "entity",
        knowledge: "knowledge",
      }[record.kind];
      for (const address of [
        `openlaw://${record.kind}/${record.address}`,
        `${kind} ${record.address}`,
        `${kind!.toUpperCase()} ${record.address}`,
      ]) {
        const result = contents(await recordedGet(client, "summarize_record", { record: address }));
        expect(JSON.parse(result.resource.text)).toEqual(expected.structuredContent);
        expect(result.resource).toMatchObject({
          uri: `openlaw://${record.kind}/${record.address}`,
          _meta: { title: record.title },
        });
        for (const section of [
          "what the record is",
          "status",
          "people",
          "Key dates",
          "open Tasks",
          "latest activity",
          "open questions",
        ])
          expect(result.instruction).toContain(section);
        expect(result.instruction).toContain("Do not add facts");
      }
    }
  }
});

it("refuses hidden prompts and out-of-grant records and returns not found outside reach", async () => {
  const narrow = await connect(true, false, ["contracts"]);
  const business = connected.find((entry) => entry.business)!.client;
  for (const client of [narrow, business]) {
    expect(await recordedGet(client, "triage_inbox")).toMatchObject({
      isError: true,
      messages: [],
    });
  }
  const denied = await narrow.readResource({ uri: "openlaw://matters/M-1" });
  expect(await recordedGet(narrow, "summarize_record", { record: "matter M-1" })).toMatchObject({
    isError: true,
    content: denied.content,
    messages: [],
  });
  await h.db.delete(contractTeam).where(eq(contractTeam.contractId, contractId));
  try {
    const uri = `openlaw://contracts/${records[0]!.address}`;
    const expected = await business.readResource({ uri });
    expect(JSON.stringify(expected)).toContain("not_found");
    expect(await recordedGet(business, "summarize_record", { record: uri })).toMatchObject({
      isError: true,
      content: expected.content,
      messages: [],
    });
  } finally {
    await h.db.insert(contractTeam).values({ contractId, userId: businessId });
  }
});

it("validates prompt arguments and accounts for every refused get", async () => {
  const client = connected[0]!.client;
  for (const args of [
    { limit: "0" },
    { limit: "101" },
    { limit: "1.5" },
    { limit: "" },
    { limit: "1e1" },
    { unexpected: "x" },
  ] as Record<string, string>[]) {
    expect(await recordedGet(client, "triage_inbox", args)).toMatchObject({
      isError: true,
      messages: [],
      content: [{ type: "text", text: expect.stringContaining("invalid_arguments") }],
    });
  }
  for (const args of [
    undefined,
    { record: "" },
    { record: "contract M-1" },
    { record: "contract C-1?extra=2" },
    { record: "openlaw://inbox" },
    { record: "openlaw://document-versions/00000000-0000-4000-8000-000000000000" },
  ]) {
    expect(await recordedGet(client, "summarize_record", args)).toMatchObject({
      isError: true,
      messages: [],
    });
  }
  expect(await recordedGet(client, "missing_prompt")).toMatchObject({
    isError: true,
    messages: [],
  });
});

it("reads the current Inbox and rechecks the grant when a listed prompt is fetched", async () => {
  const client = connected.find((entry) => !entry.business)!.client;
  expect((await client.listPrompts()).prompts.map((p) => p.name)).toContain("triage_inbox");
  await h.db.update(requests).set({ title: "Changed after listing" });
  const result = contents(await recordedGet(client, "triage_inbox"));
  expect(
    JSON.parse(result.resource.text).requests.every(
      (r: { title: string }) => r.title === "Changed after listing",
    ),
  ).toBe(true);
  const settings = (await h.db.select().from(orgSettings))[0]!;
  await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["contracts"] });
  try {
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["summarize_record"]);
    expect(await recordedGet(client, "triage_inbox")).toMatchObject({
      isError: true,
      messages: [],
    });
    expect(await recordedGet(client, "summarize_record", { record: "request R-1" })).toMatchObject({
      isError: true,
      messages: [],
    });
  } finally {
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: settings.mcpToolsetCeiling });
  }
});
