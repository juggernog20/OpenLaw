// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  fields,
  matterTypes,
  matterTypeFields,
  users,
  orgSettings,
  requestTypes,
  requests,
  comments,
  activityLog,
  eq,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { requestDepartment } from "../testing/request-department.js";
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
let departmentId: string;

const clients: Client[] = [];
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
        payload: {
          clientName: "Requests Comments People test",
          toolsets: ["requests", "comments", "people"],
          scope,
        },
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
      const client = new Client({ name: "Requests Comments People test", version: "1" });
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
  typeId = (await h.db.select().from(requestTypes).limit(1))[0]!.id;
  departmentId = await requestDepartment(h.db);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65_536);
  return result.structuredContent as {
    request: {
      id: string;
      number: number;
      title: string;
      customFields: Record<string, unknown>;
      assignee: { id: string } | null;
    };
    requests: { id: string; number: number }[];
    comment: { id: string; visibility: string };
    comments: { id: string; body: string }[];
    users: { id: string }[];
    departments: { id: string }[];
    nextCursor: string | null;
  };
}
async function refused(client: Client, name: string, args: Record<string, unknown>, code: string) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBe(true);
  expect(JSON.stringify(result)).toContain(code);
  return JSON.stringify(result);
}
const submission = () => ({
  requestTypeId: typeId,
  answers: { title: "MCP intake", department: departmentId, urgency: "medium" },
});
it("registers the audience defaults and refuses submit and assign by name", async () => {
  const legalNames = (await legal.listTools()).tools.map((t) => t.name);
  const businessNames = (await business.listTools()).tools.map((t) => t.name);
  expect(legalNames).toContain("openlaw_request_assign");
  expect(legalNames).toContain("openlaw_people_list");
  expect(legalNames).not.toContain("openlaw_request_submit");
  expect(businessNames).toContain("openlaw_request_submit");
  expect(businessNames).not.toContain("openlaw_request_assign");
  expect(businessNames).not.toContain("openlaw_people_list");
  expect(await refused(legal, "request_submit", submission(), "tool_outside_grant")).toContain(
    "openlaw_request_submit",
  );
  expect(
    await refused(
      business,
      "request_assign",
      { number: 1, assigneeId: legalId },
      "tool_outside_grant",
    ),
  ).toContain("openlaw_request_assign");
  await refused(business, "people_list", {}, "tool_outside_grant");
  await refused(readOnly, "request_assign", { number: 1, assigneeId: legalId }, "mcp_read_only");
});
it("submits Form answers, reads the original and scopes lists and details to the requester", async () => {
  await refused(
    business,
    "request_submit",
    { requestTypeId: typeId, answers: { urgency: "medium" } },
    "validation_error",
  );
  await refused(
    business,
    "request_submit",
    { ...submission(), answers: { ...submission().answers, unknown_row: "secret" } },
    "validation_error",
  );
  const born = (await call(business, "request_submit", submission())).request;
  const original = await call(business, "request_get", { number: born.number });
  expect(original.request.title).toBe("MCP intake");
  expect(original.request.customFields).toEqual({});
  expect((await call(legal, "request_get", { number: born.number })).request.title).toBe(
    "MCP intake",
  );
  const other = (
    await h.db
      .insert(requests)
      .values({
        requestTypeId: typeId,
        requesterId: adminId,
        title: "Other ask",
        urgency: "medium",
      })
      .returning()
  )[0]!;
  expect((await call(legal, "requests_list")).requests.map((r) => r.id)).toContain(other.id);
  expect((await call(business, "requests_list")).requests.map((r) => r.id)).not.toContain(other.id);
  await refused(business, "request_get", { number: other.number }, "not_found");
  const assigned = await call(legal, "request_assign", {
    number: born.number,
    assigneeId: legalId,
  });
  expect(assigned.request.assignee?.id).toBe(legalId);
  await refused(
    legal,
    "request_assign",
    { number: born.number, assigneeId: businessId },
    "validation_error",
  );
});
it("uses the most restrictive comment tier and refuses an unavailable tier", async () => {
  const born = (await call(business, "request_submit", submission())).request;
  const ref = { entityType: "request", entityId: born.id };
  const privateNote = await call(legal, "comment_post", { ...ref, body: "Legal note" });
  expect(privateNote.comment.visibility).toBe("legal_only");
  const publicNote = await call(business, "comment_post", { ...ref, body: "Requester reply" });
  expect(publicNote.comment.visibility).toBe("full_thread");
  await call(legal, "comment_post", { ...ref, body: "Team note", visibility: "working_team" });
  for (const visibility of ["legal_only", "working_team"]) {
    await refused(business, "comment_post", { ...ref, body: "No", visibility }, "forbidden");
    await refused(business, "comments_list", { ...ref, visibility }, "forbidden");
  }
  await refused(readOnly, "comment_post", { ...ref, body: "No" }, "mcp_read_only");
  expect((await call(business, "comments_list", ref)).comments.map((c) => c.body)).toEqual([
    "Requester reply",
  ]);
  expect((await call(legal, "comments_list", ref)).comments).toHaveLength(3);
  expect(await h.db.select().from(comments).where(eq(comments.entityId, born.id))).toHaveLength(3);
  const log = await h.db.select().from(activityLog).where(eq(activityLog.entityId, born.id));
  expect(log.some((l) => l.action === "comment.posted" && l.actorId === legalId)).toBe(true);
});
it("returns the shared assignable people and live Departments", async () => {
  const result = await call(legal, "people_list");
  expect(result.users.map((u) => u.id)).toEqual(
    expect.arrayContaining([legalId, businessId, adminId]),
  );
  expect(result.departments.map((d) => d.id)).toContain(departmentId);
  for (const kind of ["contracts", "matters"]) {
    const route = await h.app.inject({
      method: "GET",
      url: `/api/v1/${kind}/options`,
      cookies: legalCookies,
    });
    expect(route.statusCode, route.body).toBe(200);
    expect(result.users).toEqual(route.json().users);
  }
});

it("keeps Request and comment pages complete without exposing another requester's cursor", async () => {
  for (const client of [legal, business]) {
    await refused(client, "requests_list", { cursor: "x".repeat(65) }, "invalid_arguments");
    const whole = await call(client, "requests_list");
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await call(client, "requests_list", { limit: 1, ...(cursor ? { cursor } : {}) });
      ids.push(...page.requests.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(whole.requests.map((row) => row.id));
  }
  const born = (await call(business, "request_submit", submission())).request;
  const ref = { entityType: "request", entityId: born.id };
  for (const body of ["First", "Second", "Third"])
    await call(legal, "comment_post", { ...ref, body, visibility: "full_thread" });
  const newest = await call(business, "comments_list", { ...ref, limit: 2 });
  expect(newest.comments.map((c) => c.body)).toEqual(["Second", "Third"]);
  const oldest = await call(business, "comments_list", {
    ...ref,
    cursor: newest.nextCursor,
    limit: 2,
  });
  expect(oldest.comments.map((c) => c.body)).toEqual(["First"]);
  expect(oldest.nextCursor).toBeNull();
  const hidden = (await call(legal, "comment_post", { ...ref, body: "Hidden" })).comment;
  expect((await call(business, "comments_list", { ...ref, cursor: hidden.id })).comments).toEqual(
    [],
  );
  const other = (await h.db.select().from(requests).where(eq(requests.requesterId, adminId)))[0]!;
  await refused(business, "requests_list", { cursor: other.id }, "validation_error");
  await refused(
    business,
    "comments_list",
    { entityType: "request", entityId: other.id },
    "not_found",
  );
  await refused(
    business,
    "comment_post",
    { entityType: "request", entityId: other.id, body: "No" },
    "not_found",
  );
});

it("uses Portal Required validation and preserves accepted Form answers", async () => {
  const mt = (
    await h.db
      .insert(matterTypes)
      .values({ slug: "mcp-intake", displayName: "MCP intake", displayOrder: 99 })
      .returning()
  )[0]!;
  const rt = (
    await h.db
      .insert(requestTypes)
      .values({
        slug: "mcp-form",
        displayName: "MCP Form",
        targetModule: "matter",
        targetMatterTypeId: mt.id,
        displayOrder: 99,
      })
      .returning()
  )[0]!;
  const field = (
    await h.db
      .insert(fields)
      .values({
        slug: "business_reason",
        displayName: "Business reason",
        fieldType: "text",
        moduleScope: "matter",
      })
      .returning()
  )[0]!;
  await h.db.insert(matterTypeFields).values({
    typeId: mt.id,
    fieldId: field.id,
    isRequired: true,
    onIntakeForm: true,
    displayOrder: 0,
  });
  const input = { ...submission(), requestTypeId: rt.id };
  expect(await refused(business, "request_submit", input, "validation_error")).toContain(
    "Business reason",
  );
  const accepted = await call(business, "request_submit", {
    ...input,
    answers: { ...input.answers, business_reason: "New office" },
  });
  expect(accepted.request.customFields).toEqual({ business_reason: "New office" });
  for (const client of [legal, business])
    expect(
      (await call(client, "request_get", { number: accepted.request.number })).request.customFields,
    ).toEqual({ business_reason: "New office" });
  await h.db.update(requestTypes).set({ archivedAt: new Date() }).where(eq(requestTypes.id, rt.id));
  await refused(
    business,
    "request_submit",
    { ...input, answers: { ...input.answers, business_reason: "No" } },
    "validation_error",
  );
});

it("refuses mentions that cannot hear the selected tier without posting", async () => {
  const born = (await call(business, "request_submit", submission())).request;
  const ref = { entityType: "request", entityId: born.id };
  await refused(
    legal,
    "comment_post",
    { ...ref, body: "Private mention", mentions: [businessId] },
    "forbidden",
  );
  expect((await call(legal, "comments_list", ref)).comments).toEqual([]);
  await call(legal, "comment_post", {
    ...ref,
    body: "Public mention",
    mentions: [businessId],
    visibility: "full_thread",
  });
});

it("pages assignable users and Departments and excludes archived users", async () => {
  const whole = await call(legal, "people_list");
  for (const kind of ["users", "departments"] as const) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await call(legal, "people_list", {
        kind,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...page[kind].map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(whole[kind].map((row) => row.id));
  }
  const archived = await provisionUser(h.app.auth, {
    email: "archived@example.com",
    displayName: "Archived",
    password: TEST_ADMIN.password,
  });
  await h.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, archived.id));
  expect((await call(legal, "people_list")).users.map((row) => row.id)).not.toContain(archived.id);
});
