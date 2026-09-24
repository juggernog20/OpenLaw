// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  contracts,
  documents,
  documentVersions,
  documentVersionText,
  contractAnalysisRuns,
  contractTeam,
  contractTypes,
  contractStatuses,
  contractApprovals,
  contractKeyDates,
  contractTypeFields,
  fields,
  requests,
  requestTypes,
  knowledgeItems,
  knowledgeTypes,
  counterparties,
  entities,
  entityTypes,
  departments,
  regions,
  users,
  orgSettings,
  activityLog,
  notifications,
  apiKeyRequests,
  eq,
  sql,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

import { FakeAiProvider, FAKE_VALID_AI_KEY } from "../lib/ai/fake.js";

const provider = new FakeAiProvider();
let h: TestHarness;
let admin: Record<string, string>;
let legal: Client;
let business: Client;
let readOnly: Client;
let legalId: string;
let businessId: string;
let adminId: string;
let typeId: string;
let statusId: string;
let visible: typeof contracts.$inferSelect;
let hidden: typeof contracts.$inferSelect;
const clients: Client[] = [];
beforeAll(async () => {
  h = await startHarness({ aiDriverFactory: () => provider });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  adminId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  for (const role of ["legal_team_member", "business_user"] as const) {
    const person = await provisionUser(h.app.auth, {
      email: `${role}@example.com`,
      displayName: role,
      password: TEST_ADMIN.password,
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (role === "business_user") businessId = person.id;
    else legalId = person.id;
    const cookies = await signInCookies(h.app, `${role}@example.com`, TEST_ADMIN.password);
    for (const scope of role === "business_user"
      ? (["write"] as const)
      : (["write", "read"] as const)) {
      const asked = await h.app.inject({
        method: "POST",
        url: "/api/v1/api-key-requests",
        cookies,
        payload: { clientName: "Workspace test", toolsets: ["workspace", "contracts"], scope },
      });
      expect(asked.statusCode, asked.body).toBe(201);
      const approved = await h.app.inject({
        method: "POST",
        url: `/api/v1/api-key-requests/${asked.json().id}/approve`,
        cookies: admin,
        payload: {},
      });
      expect(approved.statusCode, approved.body).toBe(200);
      const read = await h.app.inject({
        method: "GET",
        url: `/api/v1/api-key-requests/${asked.json().id}`,
        cookies,
      });
      const client = new Client({ name: "Workspace test", version: "1" });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(endpoint, {
          requestInit: { headers: { "x-api-key": read.json().key } },
        }),
      );
      if (role === "business_user") business = client;
      else if (scope === "read") readOnly = client;
      else legal = client;
    }
  }
  typeId = (await h.db.select().from(contractTypes).where(eq(contractTypes.slug, "other")))[0]!.id;
  statusId = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.slug, "draft"))
  )[0]!.id;
  [visible, hidden] = (await h.db
    .insert(contracts)
    .values([
      {
        title: "Quartz visible",
        contractTypeId: typeId,
        statusId,
        createdBy: legalId,
        managerId: legalId,
      },
      {
        title: "Quartz confidential",
        contractTypeId: typeId,
        statusId,
        createdBy: adminId,
        managerId: adminId,
        isConfidential: true,
      },
    ])
    .returning()) as [typeof visible, typeof hidden];
  await h.db.insert(contractTeam).values([
    { contractId: visible.id, userId: legalId },
    { contractId: visible.id, userId: businessId },
  ]);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65_536);
  return result.structuredContent as Record<string, unknown>;
}
it("registers the eight Tools with role and scope filtering", async () => {
  const names = (await legal.listTools()).tools.map((t) => t.name);
  for (const name of [
    "search",
    "activity_recent",
    "contracts_list",
    "contract_get",
    "contract_create",
    "contract_update",
    "contract_set_status",
    "analysis_run",
  ])
    expect(names).toContain(`openlaw_${name}`);
  for (const client of [business, readOnly]) {
    const list = await client.listTools();
    expect(list.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const refused = await client.callTool({
      name: "openlaw_contract_update",
      arguments: { number: visible.number, changes: { region: "x" } },
    });
    expect(refused.isError).toBe(true);
  }
  expect((await business.listTools()).tools.map((t) => t.name)).not.toContain(
    "openlaw_activity_recent",
  );
});
it("omits an off-team Confidential Contract from search, list and get", async () => {
  for (const client of [legal, business]) {
    const list = await call(client, "openlaw_contracts_list");
    expect(JSON.stringify(list)).toContain(visible.title);
    expect(JSON.stringify(list)).not.toContain(hidden.title);
    const search = await call(client, "openlaw_search", { query: "Quartz" });
    expect(JSON.stringify(search)).toContain(visible.title);
    expect(JSON.stringify(search)).not.toContain(hidden.title);
    const result = await client.callTool({
      name: "openlaw_contract_get",
      arguments: { number: hidden.number },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("not_found");
  }
});
it("adds own Requests and portal-readable Knowledge only to Business User MCP search", async () => {
  const rt = (await h.db.select().from(requestTypes).limit(1))[0]!;
  const kt = (await h.db.select().from(knowledgeTypes).limit(1))[0]!;
  await h.db.insert(requests).values([
    {
      title: "Quartz own request",
      requestTypeId: rt.id,
      requesterId: businessId,
      description: "Own",
      urgency: "medium",
    },
    {
      title: "Quartz other request",
      requestTypeId: rt.id,
      requesterId: adminId,
      description: "Other",
      urgency: "medium",
    },
  ]);
  for (const [title, state, audience, archivedAt] of [
    ["Quartz portal knowledge", "published", "everyone", null],
    ["Quartz draft knowledge", "draft", "everyone", null],
    ["Quartz legal knowledge", "published", "legal_only", null],
    ["Quartz archived knowledge", "published", "everyone", new Date()],
  ] as const)
    await h.db.insert(knowledgeItems).values({
      title,
      state,
      audience,
      archivedAt,
      knowledgeTypeId: kt.id,
      createdBy: adminId,
      updatedBy: adminId,
    });
  await h.db.insert(counterparties).values({ name: "Quartz counterparty" });
  const et = (await h.db.select().from(entityTypes).limit(1))[0]!;
  await h.db.insert(entities).values({ legalName: "Quartz entity", entityTypeId: et.id });
  const result = await call(business, "openlaw_search", { query: "Quartz" });
  const json = JSON.stringify(result);
  expect(json).toContain("Quartz own request");
  expect(json).toContain("Quartz portal knowledge");
  for (const name of [
    "other request",
    "draft knowledge",
    "legal knowledge",
    "archived knowledge",
    "counterparty",
    "entity",
  ])
    expect(json).not.toContain(`Quartz ${name}`);
  const cookies = await signInCookies(h.app, "business_user@example.com", TEST_ADMIN.password);
  const header = await h.app.inject({ method: "GET", url: "/api/v1/search?q=Quartz", cookies });
  expect(header.statusCode).toBe(200);
  expect(header.body).not.toContain("Quartz own request");
  expect(header.body).not.toContain("Quartz portal knowledge");
});
it("pages search and Contract filters without gaps under the byte budget", async () => {
  const [party] = await h.db.insert(counterparties).values({ name: "Filter party" }).returning();
  const created = await call(legal, "openlaw_contract_create", {
    contractTypeId: typeId,
    answers: {
      title: "Filtered contract",
      expiry_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      counterparties: [{ counterpartyId: party!.id }],
    },
    managerId: legalId,
  });
  const filters = {
    statusId,
    typeId,
    counterpartyId: party!.id,
    ownerId: legalId,
    expiringWithinDays: 7,
    limit: 1,
  };
  const result = await call(legal, "openlaw_contracts_list", filters);
  expect(result.contracts).toHaveLength(1);
  expect(JSON.stringify(result)).toContain("Filtered contract");
  expect(created.number).toBeDefined();
  let cursor: unknown;
  const numbers: number[] = [];
  do {
    const page = await call(legal, "openlaw_contracts_list", {
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    numbers.push(...(page.contracts as { number: number }[]).map((c) => c.number));
    cursor = page.nextCursor;
  } while (cursor);
  expect(numbers).toContain(visible.number);
  expect(new Set(numbers).size).toBe(numbers.length);
  const first = await call(legal, "openlaw_search", { query: "Quartz", limit: 1 });
  expect(first.nextCursor).toBeTruthy();
  const second = await call(legal, "openlaw_search", {
    query: "Quartz",
    limit: 1,
    cursor: first.nextCursor,
  });
  expect(second.results).not.toEqual(first.results);
  const overlong = await legal.callTool({
    name: "openlaw_search",
    arguments: { query: "Quartz", cursor: "x".repeat(65) },
  });
  expect(overlong.isError).toBe(true);
  expect(JSON.stringify(overlong)).toContain("invalid_arguments");
});
it("continues Contract pages when the cursor record leaves the filter", async () => {
  const older = await call(legal, "openlaw_contract_create", {
    contractTypeId: typeId,
    answers: { title: "Older cursor record" },
    managerId: legalId,
  });
  const newer = await call(legal, "openlaw_contract_create", {
    contractTypeId: typeId,
    answers: { title: "Newer cursor record" },
    managerId: legalId,
  });
  const filters = { ownerId: legalId, limit: 1 };
  const first = await call(legal, "openlaw_contracts_list", filters);
  expect(first.contracts).toEqual([expect.objectContaining({ number: newer.number })]);
  const wideBoundary = await call(legal, "openlaw_contracts_list", {
    ...filters,
    cursor: String(Number.MAX_SAFE_INTEGER),
  });
  expect(wideBoundary.contracts).toEqual(first.contracts);
  const invalid = await legal.callTool({
    name: "openlaw_contracts_list",
    arguments: { cursor: "-1" },
  });
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid)).toContain("validation_error");
  await call(legal, "openlaw_contract_update", {
    number: newer.number,
    changes: { managerId: adminId },
  });
  const second = await call(legal, "openlaw_contracts_list", {
    ...filters,
    cursor: first.nextCursor,
  });
  expect(second.contracts).toEqual([expect.objectContaining({ number: older.number })]);
});
it("preserves sub-millisecond activity boundaries between pages", async () => {
  const entries = [];
  for (const fraction of ["123400", "123500"]) {
    const [entry] = await h.db
      .insert(activityLog)
      .values({
        entityType: "contract",
        entityId: visible.id,
        actorId: legalId,
        action: "contract.updated",
        visibility: "working_team",
        payload: {},
        createdAt: sql`${`2035-01-01T00:00:00.${fraction}Z`}::timestamptz`,
      })
      .returning({ id: activityLog.id });
    entries.push(entry!.id);
  }
  const filters = { since: "2035-01-01T00:00:00Z", limit: 1 };
  const first = await call(legal, "openlaw_activity_recent", filters);
  expect(first.entries).toEqual([expect.objectContaining({ id: entries[1] })]);
  const second = await call(legal, "openlaw_activity_recent", {
    ...filters,
    cursor: first.nextCursor,
  });
  expect(second.entries).toEqual([expect.objectContaining({ id: entries[0] })]);
});
it("returns named creation errors and preserves create-service behavior", async () => {
  const r = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: admin,
    payload: { displayName: "Required MCP" },
  });
  const requiredType = r.json().contractType.id;
  const [field] = await h.db
    .insert(fields)
    .values({
      slug: "mcp_required",
      displayName: "Required answer",
      moduleScope: "contract",
      fieldType: "text",
    })
    .returning();
  await h.db
    .insert(contractTypeFields)
    .values({ typeId: requiredType, fieldId: field!.id, isRequired: true, displayOrder: 1 });
  const missing = await legal.callTool({
    name: "openlaw_contract_create",
    arguments: { contractTypeId: requiredType, answers: { title: "Missing answer" } },
  });
  expect(missing.isError).toBe(true);
  expect(JSON.stringify(missing)).toContain("validation_error");
  expect(JSON.stringify(missing)).toContain("Required answer");
  const invalid = await legal.callTool({
    name: "openlaw_contract_create",
    arguments: {
      contractTypeId: requiredType,
      answers: { title: "Invalid answer", mcp_required: 42 },
    },
  });
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid)).toContain("validation_error");
  expect(JSON.stringify(invalid)).toContain("Required answer");
  const badDate = await legal.callTool({
    name: "openlaw_contract_create",
    arguments: {
      contractTypeId: requiredType,
      answers: { title: "Bad date", mcp_required: "complete", expiry_date: "next spring" },
    },
  });
  expect(badDate.isError).toBe(true);
  expect(JSON.stringify(badDate)).toContain("validation_error");
  expect(JSON.stringify(badDate)).toContain("expiry_date:");
  expect(JSON.stringify(badDate)).not.toContain("expiryDate");
  const created = await call(legal, "openlaw_contract_create", {
    contractTypeId: requiredType,
    answers: {
      title: "Created through MCP",
      contract_type: requiredType,
      mcp_required: "complete",
    },
  });
  const row = (
    await h.db
      .select()
      .from(contracts)
      .where(eq(contracts.number, created.number as number))
  )[0]!;
  expect(row.createdBy).toBe(legalId);
  expect(row.customFields).toMatchObject({ mcp_required: "complete" });
  expect(await h.db.select().from(contractTeam).where(eq(contractTeam.contractId, row.id))).toEqual(
    expect.arrayContaining([expect.objectContaining({ userId: legalId })]),
  );
});
it("updates Fields and ownership through the shared write and returns the soft gate reason", async () => {
  const [department] = await h.db
    .insert(departments)
    .values({ slug: "mcp", displayName: "MCP", displayOrder: 1 })
    .returning();
  await h.db.insert(regions).values({ slug: "mcp", displayName: "MCP", displayOrder: 1 });
  await call(legal, "openlaw_contract_update", {
    number: visible.number,
    changes: {
      owningDepartmentId: department!.id,
      region: "MCP",
      businessOwnerId: businessId,
      managerId: legalId,
    },
  });
  const row = (await h.db.select().from(contracts).where(eq(contracts.id, visible.id)))[0]!;
  expect(row).toMatchObject({
    owningDepartmentId: department!.id,
    region: "MCP",
    businessOwnerId: businessId,
  });
  const [active] = await h.db
    .select()
    .from(contractStatuses)
    .where(eq(contractStatuses.stage, "active"));
  await h.db.insert(contractApprovals).values({
    contractId: visible.id,
    approverId: adminId,
    requestedBy: legalId,
    source: "manual",
  });
  const refused = await legal.callTool({
    name: "openlaw_contract_set_status",
    arguments: { number: visible.number, statusId: active!.id },
  });
  expect(refused.isError).toBe(true);
  expect(JSON.stringify(refused)).toContain("soft_gate");
  expect(JSON.stringify(refused)).toContain("unresolved approvals");
  await call(legal, "openlaw_contract_set_status", {
    number: visible.number,
    statusId: active!.id,
    overrideSoftGate: true,
  });
  expect(
    (await h.db.select().from(contracts).where(eq(contracts.id, visible.id)))[0]!.statusId,
  ).toBe(active!.id);
});
it("composes a Contract read and excludes legal details from the Portal projection", async () => {
  await h.db
    .insert(contractKeyDates)
    .values({ contractId: visible.id, date: "2030-01-01", label: "Legal date" });
  const [ownApproval] = await h.db
    .insert(contractApprovals)
    .values({
      contractId: visible.id,
      approverId: businessId,
      requestedBy: legalId,
      source: "manual",
    })
    .returning();
  const staff = await call(legal, "openlaw_contract_get", { number: visible.number });
  for (const key of [
    "contract",
    "fields",
    "team",
    "keyDates",
    "documents",
    "analysis",
    "approvals",
  ])
    expect(staff).toHaveProperty(key);
  expect(JSON.stringify(staff)).toContain("Legal date");
  const portal = await call(business, "openlaw_contract_get", { number: visible.number });
  expect(portal.approvals).toEqual([
    expect.objectContaining({ id: ownApproval!.id, approverId: businessId }),
  ]);
  expect(portal).not.toHaveProperty("analysis");
  expect(portal).not.toHaveProperty("keyDates");
  expect(JSON.stringify(portal)).not.toContain("Legal date");
  // DD-021 exposes the stage, never the status label or the type, status and Department ids.
  const businessList = await call(business, "openlaw_contracts_list");
  for (const record of [portal.contract, ...(businessList.contracts as object[])]) {
    expect(record).toHaveProperty("stage");
    for (const key of ["statusName", "statusId", "contractTypeId", "owningDepartmentId"])
      expect(record).not.toHaveProperty(key);
  }
});
it("pages recent activity at reachable records and tiers", async () => {
  for (const [entityId, title, visibility] of [
    [visible.id, "Visible activity", "working_team"],
    [hidden.id, "Hidden activity", "working_team"],
    [visible.id, "Admin activity", "admin_only"],
  ] as const)
    await h.db.insert(activityLog).values({
      entityType: "contract",
      entityId,
      actorId: adminId,
      action: "contract.updated",
      visibility,
      payload: { title },
    });
  const result = await call(legal, "openlaw_activity_recent", {
    since: "2020-01-01T00:00:00Z",
    limit: 100,
  });
  expect(JSON.stringify(result)).toContain("Visible activity");
  expect(JSON.stringify(result)).not.toContain("Hidden activity");
  expect(JSON.stringify(result)).not.toContain("Admin activity");
  const page = await call(legal, "openlaw_activity_recent", {
    since: "2020-01-01T00:00:00Z",
    limit: 1,
  });
  expect(page.nextCursor).toBeTruthy();
  const next = await call(legal, "openlaw_activity_recent", {
    since: "2020-01-01T00:00:00Z",
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.entries).not.toEqual(page.entries);
});
it("returns an Analysis refusal through MCP when no connector is configured", async () => {
  const result = await legal.callTool({
    name: "openlaw_analysis_run",
    arguments: { number: visible.number },
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("AI connector");
});
it("analyzes the executed pin or a named Version through the worker", async () => {
  const configured = await h.app.inject({
    method: "PUT",
    url: "/api/v1/ai-connector",
    cookies: admin,
    payload: {
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://analysis.invalid/v1",
      apiKey: FAKE_VALID_AI_KEY,
      model: "mcp-test-model",
    },
  });
  expect(configured.statusCode, configured.body).toBe(200);
  const [paper] = await h.db
    .insert(documents)
    .values({ title: "MCP paper", contractId: visible.id, createdBy: legalId })
    .returning();
  const versions = [];
  for (const [index, text] of [
    "Pinned version words",
    "Named version words",
    "Current version words",
  ].entries()) {
    const [version] = await h.db
      .insert(documentVersions)
      .values({
        documentId: paper!.id,
        versionNumber: index + 1,
        fileRef: `local:mcp-${index}`,
        kind: "draft_ours",
        originalFilename: `version-${index}.pdf`,
        mimeType: "application/pdf",
        byteSize: text.length,
        checksumSha256: "0".repeat(64),
        createdBy: legalId,
      })
      .returning();
    await h.db
      .insert(documentVersionText)
      .values({ versionId: version!.id, state: "ready", source: "native_layer", text });
    versions.push(version!);
  }
  await h.db
    .update(documents)
    .set({ executedVersionId: versions[0]!.id })
    .where(eq(documents.id, paper!.id));
  await h.db
    .update(contracts)
    .set({ primaryDocumentId: paper!.id })
    .where(eq(contracts.id, visible.id));
  for (const [versionId, text] of [
    [undefined, "Pinned version words"],
    [versions[1]!.id, "Named version words"],
  ] as const) {
    const result = await call(legal, "openlaw_analysis_run", {
      number: visible.number,
      ...(versionId ? { versionId } : {}),
    });
    const run = result.run as { id: string; versionId: string };
    expect(run.versionId).toBe(versionId ?? versions[0]!.id);
    await vi.waitFor(
      async () => {
        const [stored] = await h.db
          .select()
          .from(contractAnalysisRuns)
          .where(eq(contractAnalysisRuns.id, run.id));
        expect(stored?.state).toBe("ready");
        expect(stored?.versionId).toBe(run.versionId);
      },
      { timeout: 15000, interval: 100 },
    );
    expect(provider.extractions.at(-1)?.text).toBe(text);
  }
  const wrongContract = await legal.callTool({
    name: "openlaw_analysis_run",
    arguments: { number: hidden.number, versionId: versions[0]!.id },
  });
  expect(wrongContract.isError).toBe(true);
  expect(JSON.stringify(wrongContract)).toContain("not_found");
  const read = await call(legal, "openlaw_contract_get", { number: visible.number });
  expect((read.analysis as { latestRun: unknown }).latestRun).toMatchObject({
    state: "ready",
    versionId: versions[1]!.id,
  });
  expect(read.documents).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: paper!.id })]),
  );
});
it("projects Portal-visible Fields and omits confidential Document activity off-team", async () => {
  const attached = await h.db
    .insert(fields)
    .values([
      {
        slug: "mcp_portal",
        displayName: "Portal answer",
        moduleScope: "contract",
        fieldType: "text",
      },
      {
        slug: "mcp_internal",
        displayName: "Internal answer",
        moduleScope: "contract",
        fieldType: "text",
      },
    ])
    .returning();
  for (const [index, field] of attached.entries())
    await h.db.insert(contractTypeFields).values({
      typeId,
      fieldId: field.id,
      displayOrder: index + 30,
      visibleOnPortal: index === 0,
    });
  await call(legal, "openlaw_contract_update", {
    number: visible.number,
    changes: { customFields: { mcp_portal: "Business fact", mcp_internal: "Legal secret" } },
  });
  const businessRead = await call(business, "openlaw_contract_get", { number: visible.number });
  expect(JSON.stringify(businessRead)).toContain("Business fact");
  expect(JSON.stringify(businessRead)).not.toContain("Legal secret");
  expect(JSON.stringify(businessRead)).not.toContain("mcp_internal");
  const legalRead = await call(legal, "openlaw_contract_get", { number: visible.number });
  expect(JSON.stringify(legalRead)).toContain("Legal secret");
  const [offTeam] = await h.db
    .insert(contracts)
    .values({
      title: "Off-team open contract",
      contractTypeId: typeId,
      statusId,
      createdBy: adminId,
    })
    .returning();
  const [paper] = await h.db
    .insert(documents)
    .values({
      title: "Secret Document",
      contractId: offTeam!.id,
      createdBy: adminId,
      isConfidential: true,
    })
    .returning();
  await h.db.insert(activityLog).values({
    entityType: "contract",
    entityId: offTeam!.id,
    actorId: adminId,
    action: "document.created",
    visibility: "working_team",
    payload: { documentId: paper!.id, title: "Secret Document" },
  });
  const result = await call(legal, "openlaw_activity_recent", {
    since: "2020-01-01T00:00:00Z",
    limit: 100,
  });
  expect(JSON.stringify(result)).not.toContain("Secret Document");
  await h.db.update(contracts).set({ archivedAt: new Date() }).where(eq(contracts.id, offTeam!.id));
});
it("cuts large UTF-8 Contract pages at the byte budget and keeps every cursor", async () => {
  const born = await h.db
    .insert(contracts)
    .values(
      Array.from({ length: 8 }, (_, i) => ({
        title: `Budget contract ${i}`,
        description: '世界\\"'.repeat(1400),
        contractTypeId: typeId,
        statusId,
        createdBy: legalId,
        managerId: legalId,
      })),
    )
    .returning();
  const ids = new Set(born.map((r) => r.id));
  const seen: string[] = [];
  let cursor: unknown;
  do {
    const page = await call(legal, "openlaw_contracts_list", {
      typeId,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const rows = page.contracts as { id: string }[];
    seen.push(...rows.filter((r) => ids.has(r.id)).map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(seen).size).toBe(8);
  expect(seen).toHaveLength(8);
});

it("includes reachable Request activity and redacts an unreached conversion target", async () => {
  const [request] = await h.db.select().from(requests).where(eq(requests.requesterId, businessId));
  const [entry] = await h.db
    .insert(activityLog)
    .values({
      entityType: "request",
      entityId: request!.id,
      actorId: adminId,
      action: "request.converted",
      visibility: "working_team",
      payload: { number: request!.number, contractNumber: hidden.number },
    })
    .returning();
  const result = await call(legal, "openlaw_activity_recent", {
    since: "2020-01-01T00:00:00Z",
    limit: 100,
  });
  const found = (result.entries as { id: string; payload: Record<string, unknown> }[]).find(
    (e) => e.id === entry!.id,
  );
  expect(found?.payload).toEqual({ number: request!.number });
});
it("continues the Contract Document page for staff and Portal readers", async () => {
  const paper = await h.db
    .insert(documents)
    .values(
      Array.from({ length: 3 }, (_, i) => ({
        title: `Paged paper ${i}`,
        contractId: visible.id,
        createdBy: legalId,
      })),
    )
    .returning();
  await h.db.insert(documentVersions).values(
    paper.map((document) => ({
      documentId: document.id,
      versionNumber: 1,
      fileRef: `local:${document.id}`,
      kind: "draft_ours" as const,
      originalFilename: "paged.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
      checksumSha256: "0".repeat(64),
      createdBy: legalId,
    })),
  );
  for (const client of [legal, business]) {
    let cursor: unknown;
    const seen: string[] = [];
    do {
      const page = await call(client, "openlaw_contract_get", {
        number: visible.number,
        documentsLimit: 1,
        ...(cursor ? { documentsCursor: cursor } : {}),
      });
      const documents = page.documents as { id: string }[];
      expect(documents.length).toBeLessThanOrEqual(1);
      seen.push(...documents.map((d) => d.id));
      cursor = page.documentsNextCursor;
    } while (cursor);
    expect(seen).toEqual(expect.arrayContaining(paper.map((d) => d.id)));
    expect(new Set(seen).size).toBe(seen.length);
  }
});
it("fails a manual run whose selected Version was erased instead of reading other paper", async () => {
  const count = provider.extractions.length;
  const [run] = await h.db
    .insert(contractAnalysisRuns)
    .values({
      contractId: visible.id,
      versionId: null,
      state: "pending",
      trigger: "manual",
      requestedBy: legalId,
      preset: "custom",
      model: "mcp-test-model",
    })
    .returning();
  expect(await h.app.jobs.requestContractAnalysis(visible.id, run!.id)).toBe(true);
  await vi.waitFor(
    async () => {
      const [stored] = await h.db
        .select()
        .from(contractAnalysisRuns)
        .where(eq(contractAnalysisRuns.id, run!.id));
      expect(stored?.state).toBe("failed");
    },
    { timeout: 15000, interval: 100 },
  );
  expect(provider.extractions.length).toBe(count);
});

it("carries credential attribution through Contract writes, feeds, audit and notifications", async () => {
  const created = await call(legal, "openlaw_contract_create", {
    contractTypeId: typeId,
    answers: { title: "Via contract" },
    managerId: legalId,
  });
  const [contract] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.number, Number(created.number)));
  await call(legal, "openlaw_contract_update", {
    number: created.number,
    changes: { managerId: adminId, title: "Via updated contract" },
  });
  const [review] = await h.db
    .select()
    .from(contractStatuses)
    .where(eq(contractStatuses.stage, "review"));
  await call(legal, "openlaw_contract_set_status", {
    number: created.number,
    statusId: review!.id,
  });
  const [credential] = await h.db
    .select()
    .from(apiKeyRequests)
    .where(eq(apiKeyRequests.requesterId, legalId));
  const via = { viaKind: "api_key", viaId: credential!.keyId, viaClientName: "Workspace test" };
  const rows = await h.db.select().from(activityLog).where(eq(activityLog.entityId, contract!.id));
  for (const action of ["contract.created", "contract.updated", "contract.status_changed"]) {
    expect(rows).toContainEqual(expect.objectContaining({ action, actorId: legalId, ...via }));
  }
  const feed = await h.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=contract&entityId=${contract!.id}`,
    cookies: admin,
  });
  expect(feed.statusCode, feed.body).toBe(200);
  expect(feed.json().entries).toContainEqual(
    expect.objectContaining({ action: "contract.updated", ...via }),
  );
  const recent = await call(legal, "openlaw_activity_recent", {
    since: "2020-01-01T00:00:00Z",
    limit: 100,
  });
  expect(recent.entries).toContainEqual(
    expect.objectContaining({ entityId: contract!.id, ...via }),
  );
  const audit = await h.app.inject({
    method: "GET",
    url: `/api/v1/audit-log?entityId=${contract!.id}`,
    cookies: admin,
  });
  expect(audit.statusCode, audit.body).toBe(200);
  expect(audit.json().entries).toContainEqual(expect.objectContaining(via));
  const csv = await h.app.inject({
    method: "GET",
    url: `/api/v1/audit-log/export?entityId=${contract!.id}`,
    cookies: admin,
  });
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body).toContain('"via_kind","via_id","via_client_name"');
  expect(csv.body).toContain(`"api_key","${credential!.keyId}","Workspace test"`);
  const notices = await h.db
    .select()
    .from(notifications)
    .where(eq(notifications.entityId, contract!.id));
  expect(notices).toContainEqual(
    expect.objectContaining({
      eventType: "contract.owner_assigned",
      payload: expect.objectContaining({ actorName: "legal_team_member", ...via }),
    }),
  );

  const legalCookies = await signInCookies(
    h.app,
    "legal_team_member@example.com",
    TEST_ADMIN.password,
  );
  const [ui] = await Promise.all([
    h.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract!.number}`,
      cookies: legalCookies,
      payload: { title: "UI edit" },
    }),
    call(legal, "openlaw_contract_update", {
      number: contract!.number,
      changes: { description: "Concurrent MCP edit" },
    }),
  ]);
  expect(ui.statusCode, ui.body).toBe(200);
  const afterUi = await h.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, contract!.id));
  expect(afterUi).toContainEqual(
    expect.objectContaining({
      actorId: legalId,
      action: "contract.updated",
      viaKind: null,
      viaId: null,
      viaClientName: null,
    }),
  );
});
