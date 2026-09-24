// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  apiKeyRequests,
  activityLog,
  matters,
  matterTypes,
  matterStatuses,
  matterTeam,
  matterKeyDates,
  matterTasks,
  matterTemplates,
  matterTemplateTasks,
  matterTypeFields,
  fields,
  contracts,
  contractTypes,
  contractStatuses,
  contractTasks,
  users,
  orgSettings,
  eq,
  sql,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let legalCookies: Record<string, string>;
let legal: Client;
let business: Client;
let readOnly: Client;
let legalId: string;
let businessId: string;
let adminId: string;
let typeId: string;
let statusId: string;
let visible: typeof matters.$inferSelect;
let hidden: typeof matters.$inferSelect;
let contract: typeof contracts.$inferSelect;
const clients: Client[] = [];
const credentialIds = new Map<Client, string>();
beforeAll(async () => {
  h = await startHarness();
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
    if (role === "legal_team_member") legalCookies = cookies;
    for (const scope of role === "business_user" ? ["write"] : ["write", "read"]) {
      const asked = await h.app.inject({
        method: "POST",
        url: "/api/v1/api-key-requests",
        cookies,
        payload: { clientName: "Matters Tasks test", toolsets: ["matters", "tasks"], scope },
      });
      expect(asked.statusCode, asked.body).toBe(201);
      await h.app.inject({
        method: "POST",
        url: `/api/v1/api-key-requests/${asked.json().id}/approve`,
        cookies: admin,
        payload: {},
      });
      const read = await h.app.inject({
        method: "GET",
        url: `/api/v1/api-key-requests/${asked.json().id}`,
        cookies,
      });
      const client = new Client({ name: "Matters Tasks test", version: "1" });
      const [credential] = await h.db
        .select()
        .from(apiKeyRequests)
        .where(eq(apiKeyRequests.id, asked.json().id));
      credentialIds.set(client, credential!.keyId!);
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
  typeId = (await h.db.select().from(matterTypes).limit(1))[0]!.id;
  statusId = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "open")).limit(1)
  )[0]!.id;
  [visible, hidden] = (await h.db
    .insert(matters)
    .values([
      {
        title: "Visible Matter",
        matterTypeId: typeId,
        statusId,
        createdBy: legalId,
        managerId: legalId,
      },
      {
        title: "Hidden Matter",
        matterTypeId: typeId,
        statusId,
        createdBy: adminId,
        managerId: adminId,
        isConfidential: true,
      },
    ])
    .returning()) as [typeof visible, typeof hidden];
  await h.db.insert(matterTeam).values([
    { matterId: visible.id, userId: businessId },
    { matterId: visible.id, userId: legalId },
  ]);
  const ct = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const cs = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "draft")).limit(1)
  )[0]!;
  contract = (
    await h.db
      .insert(contracts)
      .values({
        title: "Task Contract",
        contractTypeId: ct.id,
        statusId: cs.id,
        createdBy: legalId,
        managerId: legalId,
      })
      .returning()
  )[0]!;
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
interface ToolAnswer {
  number: number;
  taskId: string;
  matter: {
    title: string;
    priority: string;
    manager: { id: string };
    customFields: Record<string, unknown>;
  };
  matters: { number: number }[];
  tasks: { title: string }[];
  rows: { id: string; title: string; isDone: boolean; isOverdue: boolean }[];
  nextCursor: string | null;
  relations: { parent: { restricted: boolean } };
  customFields: Record<string, unknown>;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65_536);
  return result.structuredContent as unknown as ToolAnswer;
}
async function refused(client: Client, name: string, args: Record<string, unknown>, code: string) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBe(true);
  expect(JSON.stringify(result)).toContain(code);
  return JSON.stringify(result);
}
it("registers all eight Tools and enforces role and read grants at calls", async () => {
  const names = [
    "matters_list",
    "matter_get",
    "matter_create",
    "matter_update",
    "matter_set_status",
    "tasks_list",
    "task_create",
    "task_update",
  ];
  expect((await legal.listTools()).tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(names.map((n) => `openlaw_${n}`)),
  );
  const portal = (await business.listTools()).tools.map((t) => t.name);
  expect(portal).toContain("openlaw_matter_get");
  expect(portal).not.toContain("openlaw_tasks_list");
  await refused(business, "tasks_list", {}, "tool_outside_grant");
  for (const client of [business, readOnly])
    await refused(
      client,
      "matter_update",
      { number: visible.number, changes: { title: "Forbidden" } },
      client === business ? "tool_outside_grant" : "mcp_read_only",
    );
});
it("filters Matters, pages without duplicates and applies Portal reach", async () => {
  await h.db
    .insert(matterKeyDates)
    .values({ matterId: visible.id, label: "Hearing", date: sql`current_date + 5` });
  for (const client of [legal, business]) {
    const page = await call(client, "matters_list", {
      statusId,
      typeId,
      managerId: legalId,
      ...(client === legal ? { keyDateWithinDays: 5 } : {}),
      limit: 1,
    });
    expect(page.matters.map((m) => m.number)).toEqual([visible.number]);
    if (client === legal)
      expect((await call(client, "matters_list", { keyDateWithinDays: 4 })).matters).toEqual([]);
    else await refused(client, "matters_list", { keyDateWithinDays: 4 }, "forbidden");
    await refused(client, "matter_get", { number: hidden.number }, "not_found");
    expect(JSON.stringify(await call(client, "matters_list"))).not.toContain(hidden.title);
  }
  await refused(legal, "matters_list", { cursor: "bad" }, "validation_error");
});
it("reads overview, Fields, team, Key dates, Tasks, relations and Documents with Portal projection", async () => {
  const read = await call(legal, "matter_get", { number: visible.number });
  for (const key of ["matter", "fields", "team", "keyDates", "tasks", "relations", "documents"])
    expect(read).toHaveProperty(key);
  const portal = await call(business, "matter_get", { number: visible.number });
  expect(portal.matter.title).toBe(visible.title);
  for (const key of ["keyDates", "tasks", "relations"]) expect(portal).not.toHaveProperty(key);
  for (const key of ["risk", "priority", "isConfidential", "aiUnverified"])
    expect(portal.matter).not.toHaveProperty(key);
});
it("creates from a template, updates Fields and Manager, and separates lifecycle confirmation", async () => {
  const template = (
    await h.db
      .insert(matterTemplates)
      .values({ matterTypeId: typeId, name: "Checklist", defaultPriority: "high" })
      .returning()
  )[0]!;
  await h.db.insert(matterTemplateTasks).values({
    matterTemplateId: template.id,
    title: "Template Task",
    assigneeRole: "matter_manager",
    dueOffsetDays: 3,
    displayOrder: 1,
  });
  const born = await call(legal, "matter_create", {
    matterTypeId: typeId,
    answers: { title: "From MCP" },
    templateId: template.id,
    managerId: legalId,
  });
  const [created] = await h.db.select().from(matters).where(eq(matters.number, born.number));
  const activity = await h.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, created!.id));
  expect(activity).toContainEqual(
    expect.objectContaining({
      action: "matter.created",
      actorId: legalId,
      visibility: "working_team",
      viaKind: "api_key",
      viaId: credentialIds.get(legal),
      viaClientName: "Matters Tasks test",
    }),
  );
  const read = await call(legal, "matter_get", { number: born.number });
  expect(read.matter.priority).toBe("high");
  expect(read.tasks[0]!.title).toBe("Template Task");
  await call(legal, "matter_update", {
    number: born.number,
    changes: { title: "Updated", managerId: adminId },
  });
  expect((await call(legal, "matter_get", { number: born.number })).matter.manager.id).toBe(
    adminId,
  );
  await refused(
    legal,
    "matter_update",
    { number: born.number, changes: { statusId } },
    "invalid_arguments",
  );
  const closed = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "closed")).limit(1)
  )[0]!;
  await refused(
    legal,
    "matter_set_status",
    { number: born.number, statusId: closed.id },
    "validation_error",
  );
  await call(legal, "matter_set_status", {
    number: born.number,
    statusId: closed.id,
    closingNote: "Finished",
  });
  await refused(
    legal,
    "matter_set_status",
    { number: born.number, statusId },
    "matter_reopen_confirmation",
  );
  await call(legal, "matter_set_status", { number: born.number, statusId, confirmReopen: true });
});
it("returns named validation errors for missing and invalid creation Fields without writing", async () => {
  const mt = (
    await h.db
      .insert(matterTypes)
      .values({ slug: "mcp-required", displayName: "Required", displayOrder: 99 })
      .returning()
  )[0]!;
  for (const slug of ["first_required", "second_required"]) {
    const field = (
      await h.db
        .insert(fields)
        .values({ slug, displayName: slug, fieldType: "text", moduleScope: "matter" })
        .returning()
    )[0]!;
    await h.db
      .insert(matterTypeFields)
      .values({ typeId: mt.id, fieldId: field.id, isRequired: true, displayOrder: 0 });
  }
  const error = await refused(
    legal,
    "matter_create",
    { matterTypeId: mt.id, answers: { title: "Missing" } },
    "validation_error",
  );
  expect(error).toContain("first_required");
  expect(error).toContain("second_required");
  await refused(
    legal,
    "matter_create",
    { matterTypeId: typeId, answers: { title: "Unknown", bogus_field: "x" } },
    "validation_error",
  );
  expect((await call(legal, "matters_list", { typeId: mt.id })).matters).toEqual([]);
});
it.each(["contract", "matter"] as const)(
  "creates and atomically completes, reassigns and reschedules a %s Task under UI assignee rules",
  async (kind) => {
    const number = kind === "contract" ? contract.number : visible.number;
    await refused(
      legal,
      "task_create",
      { kind, number, title: "Bad assignee", assigneeId: businessId },
      "validation_error",
    );
    await refused(
      legal,
      "task_create",
      { kind, number, title: "Needs team", assigneeId: adminId },
      "validation_error",
    );
    const born = await call(legal, "task_create", {
      kind,
      number,
      title: "MCP Task",
      assigneeId: legalId,
      dueDate: "2026-01-01",
    });
    const readTask = async () => {
      const response = await h.app.inject({
        method: "GET",
        url: `/api/v1/${kind}s/${number}/tasks`,
        cookies: legalCookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{
        tasks: { id: string; isDone: boolean; assigneeId: string | null; dueDate: string | null }[];
      }>();
      const task = body.tasks.find((row) => row.id === born.taskId);
      expect(task).toBeDefined();
      return task!;
    };
    await refused(
      legal,
      "task_update",
      { kind, taskId: born.taskId, changes: { isDone: true, assigneeId: businessId } },
      "validation_error",
    );
    expect((await readTask()).isDone).toBe(false);
    await call(legal, "task_update", {
      kind,
      taskId: born.taskId,
      changes: { isDone: true, assigneeId: adminId, addToTeam: true, dueDate: "2026-12-01" },
    });
    expect(await readTask()).toMatchObject({
      isDone: true,
      assigneeId: adminId,
      dueDate: "2026-12-01",
    });
    await call(legal, "task_update", { kind, taskId: born.taskId, changes: { isDone: true } });
    const activity = await h.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=${kind}&entityId=${kind === "contract" ? contract.id : visible.id}`,
      cookies: legalCookies,
    });
    expect(activity.statusCode, activity.body).toBe(200);
    const logs = activity
      .json<{ entries: { action: string; payload: { taskId?: string } }[] }>()
      .entries.filter(
        (entry) => entry.action === "task.completed" && entry.payload.taskId === born.taskId,
      );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actor: { id: legalId },
      visibility: "working_team",
      viaKind: "api_key",
      viaId: credentialIds.get(legal),
      viaClientName: "Matters Tasks test",
    });
  },
);
it("lists the Home assigned Tasks with filters, own reach for a named assignee and stable paging", async () => {
  await h.db.insert(contractTasks).values({
    contractId: contract.id,
    title: "Overdue",
    assigneeId: legalId,
    dueDate: sql`current_date - 1`,
    displayOrder: 10,
  });
  await h.db.insert(matterTasks).values([
    {
      matterId: visible.id,
      title: "Today",
      assigneeId: legalId,
      dueDate: sql`current_date`,
      displayOrder: 10,
    },
    {
      matterId: visible.id,
      title: "Future",
      assigneeId: legalId,
      dueDate: sql`current_date + 2`,
      displayOrder: 11,
    },
    { matterId: visible.id, title: "Undated", assigneeId: legalId, displayOrder: 12 },
    { matterId: hidden.id, title: "Hidden Task", assigneeId: adminId, displayOrder: 0 },
  ]);
  const list = await call(legal, "tasks_list");
  const home = await h.app.inject({
    method: "GET",
    url: "/api/v1/home/tasks",
    cookies: legalCookies,
  });
  expect(home.statusCode, home.body).toBe(200);
  expect(list).toEqual(home.json());
  const due = await call(legal, "tasks_list", { dueWithinDays: 2 });
  expect(due.rows.find((t) => t.title === "Future")!.isOverdue).toBe(false);
  expect(due.rows.some((t) => t.title === "Undated")).toBe(false);
  expect((await call(legal, "tasks_list", { overdue: true })).rows.map((t) => t.title)).toEqual([
    "Overdue",
  ]);
  const other = await call(legal, "tasks_list", { assigneeId: adminId, includeCompleted: true });
  expect(JSON.stringify(other)).not.toContain("Hidden Task");
  expect(other.rows.some((t) => t.isDone)).toBe(true);
  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await call(legal, "tasks_list", { limit: 1, ...(cursor ? { cursor } : {}) });
    paged.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(paged).toEqual(list.rows.map((r) => r.id));
  await refused(legal, "tasks_list", { cursor: "broken" }, "invalid_arguments");
});

it("keeps hidden Fields and restricted relatives out of Portal reads", async () => {
  const field = (
    await h.db
      .insert(fields)
      .values({
        slug: "internal_advice",
        displayName: "Internal advice",
        fieldType: "text",
        moduleScope: "matter",
      })
      .returning()
  )[0]!;
  await h.db
    .insert(matterTypeFields)
    .values({ typeId, fieldId: field.id, displayOrder: 99, visibleOnPortal: false });
  await call(legal, "matter_update", {
    number: visible.number,
    changes: { customFields: { internal_advice: "Privileged advice" } },
  });
  await h.db.update(matters).set({ parentId: hidden.id }).where(eq(matters.id, visible.id));
  const staff = await call(legal, "matter_get", { number: visible.number });
  expect(staff.customFields.internal_advice).toBe("Privileged advice");
  expect(staff.relations.parent).toEqual({ restricted: true });
  for (const name of ["matter_get", "matters_list"]) {
    const portal = await call(
      business,
      name,
      name === "matter_get" ? { number: visible.number } : {},
    );
    expect(JSON.stringify(portal)).not.toContain("Privileged advice");
    expect(JSON.stringify(portal)).not.toContain("internal_advice");
    expect(JSON.stringify(portal)).not.toContain(hidden.title);
  }
});
it("pages Matters and hides archived records and inactive-record Tasks", async () => {
  const first = await call(legal, "matters_list", { limit: 1 });
  expect(first.nextCursor).not.toBeNull();
  const second = await call(legal, "matters_list", { limit: 1, cursor: first.nextCursor });
  expect(second.matters[0]!.number).not.toBe(first.matters[0]!.number);
  const closed = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "closed")).limit(1)
  )[0]!;
  const inactive = (
    await h.db
      .insert(matters)
      .values({
        title: "Closed Matter",
        matterTypeId: typeId,
        statusId: closed.id,
        managerId: legalId,
        createdBy: legalId,
      })
      .returning()
  )[0]!;
  await h.db.insert(matterTasks).values({
    matterId: inactive.id,
    title: "Closed record Task",
    assigneeId: legalId,
    displayOrder: 0,
  });
  expect(JSON.stringify(await call(legal, "tasks_list", { includeCompleted: true }))).not.toContain(
    "Closed record Task",
  );
  const ended = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "ended")).limit(1)
  )[0]!;
  await h.db.update(contracts).set({ statusId: ended.id }).where(eq(contracts.id, contract.id));
  expect((await call(legal, "tasks_list")).rows.some((t) => t.title === "Overdue")).toBe(false);
  await h.db.update(matters).set({ archivedAt: new Date() }).where(eq(matters.id, visible.id));
  expect(JSON.stringify(await call(legal, "matters_list"))).not.toContain(visible.title);
  expect(JSON.stringify(await call(legal, "tasks_list", { includeCompleted: true }))).not.toContain(
    visible.title,
  );
  await refused(business, "matter_get", { number: visible.number }, "not_found");
  await refused(
    legal,
    "task_create",
    { kind: "matter", number: visible.number, title: "Archived" },
    "conflict",
  );
});
