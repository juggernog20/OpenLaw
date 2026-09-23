// SPDX-License-Identifier: AGPL-3.0-only

import {
  activityLog,
  comments,
  contractTasks,
  contractTypes,
  eq,
  matterTypes,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { provisionUser } from "../auth/instance.js";
import type { AuthenticatedUser } from "../auth/user.js";
import { signInCookies, startHarness, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { requestDepartment } from "../testing/request-department.js";
import { listComments } from "./comments/service.js";
import { createContractTask, updateContractTask } from "./contract-tasks/service.js";
import { updateMatterTask } from "./matter-tasks/service.js";
import { assignRequest, listMyRequests, listRequests, submitRequest } from "./requests/service.js";

let h: TestHarness;
let actor: AuthenticatedUser;
let outsider: AuthenticatedUser;
let cookies: Record<string, string>;
let requestTypeId: string;
let departmentId: string;

beforeAll(async () => {
  h = await startHarness();
  const setup = await h.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  actor = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!;
  const person = await provisionUser(h.app.auth, {
    email: "services-outsider@example.com",
    displayName: "Outsider",
    password: "correct-horse-battery",
  });
  outsider = (
    await h.db
      .update(users)
      .set({ role: "legal_team_member" })
      .where(eq(users.id, person.id))
      .returning()
  )[0]!;
  requestTypeId = (await h.db.select().from(requestTypes).limit(1))[0]!.id;
  departmentId = await requestDepartment(h.db);
});
afterAll(async () => h?.stop());

async function createRecord(kind: "contract" | "matter", isConfidential = false) {
  const types = kind === "contract" ? contractTypes : matterTypes;
  const type = (await h.db.select().from(types).limit(1))[0]!;
  const response = await h.app.inject({
    method: "POST",
    url: `/api/v1/${kind}s`,
    cookies,
    payload: { title: `Service ${kind}`, [`${kind}TypeId`]: type.id, isConfidential },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json()[kind] as { id: string; number: number };
}

function submit(title = "Service Request") {
  return submitRequest(
    h.db,
    actor,
    { requestTypeId, departmentId, title, urgency: "medium" },
    h.notifier,
  );
}

it("submits and assigns a Request with activity, and matches both HTTP lists", async () => {
  const { request } = await submit();
  const assigned = await assignRequest(
    h.db,
    actor,
    request.number,
    { assigneeId: outsider.id },
    h.notifier,
  );
  expect(assigned.request.assignee?.id).toBe(outsider.id);
  const before = await h.db.select().from(activityLog).where(eq(activityLog.entityId, request.id));
  expect(before.map((row) => row.action)).toEqual(
    expect.arrayContaining(["request.created", "request.assignee_changed"]),
  );
  await assignRequest(h.db, actor, request.number, { assigneeId: outsider.id }, h.notifier);
  expect(
    await h.db.select().from(activityLog).where(eq(activityLog.entityId, request.id)),
  ).toHaveLength(before.length);
  for (const [url, read] of [
    [
      "/requests?sort=title&dir=desc",
      () => listRequests(h.db, actor, { sort: "title", dir: "desc" }),
    ],
    ["/portal/requests", () => listMyRequests(h.db, actor)],
  ] as const) {
    const response = await h.app.inject({ method: "GET", url: `/api/v1${url}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    expect(await read()).toEqual(response.json());
  }
  expect((await listMyRequests(h.db, outsider)).requests.map((row) => row.id)).not.toContain(
    request.id,
  );
});

it("names missing Intake Rows without changing the HTTP refusal", async () => {
  await expect(submit(" ")).rejects.toMatchObject({
    statusCode: 400,
    rows: [{ name: "Title", reason: "missing" }],
  });
  const response = await h.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies,
    payload: { requestTypeId, departmentId, title: " ", urgency: "medium" },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().detail).toBe("Fill Title first — the form requires it.");
  expect(response.json()).not.toHaveProperty("rows");
});

it("refuses Business Users at staff services without relying on HTTP guards", async () => {
  const business = { ...actor, role: "business_user" as const };
  for (const run of [
    () => listRequests(h.db, business),
    () => assignRequest(h.db, business, 1, { assigneeId: null }, h.notifier),
    () => createContractTask(h.db, business, 1, { title: "Task" }, h.notifier),
    () => updateContractTask(h.db, business, "missing", { title: "Task" }, h.notifier),
    () => updateMatterTask(h.db, business, "missing", { title: "Task" }, h.notifier),
  ])
    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
});

it("creates and updates Contract Tasks and updates Matter Tasks with activity and no-op handling", async () => {
  const contract = await createRecord("contract");
  const created = await createContractTask(
    h.db,
    actor,
    contract.number,
    { title: " First task " },
    h.notifier,
  );
  expect(created.tasks[0]?.title).toBe("First task");
  const taskId = created.createdTaskId;
  const changed = await updateContractTask(
    h.db,
    actor,
    taskId,
    { title: "Changed", assigneeId: outsider.id, addToTeam: true },
    h.notifier,
  );
  expect(changed.tasks[0]).toMatchObject({ title: "Changed", assigneeId: outsider.id });
  const matter = await createRecord("matter");
  const added = await h.app.inject({
    method: "POST",
    url: `/api/v1/matters/${matter.number}/tasks`,
    cookies,
    payload: { title: "Matter task" },
  });
  expect(added.statusCode, added.body).toBe(201);
  const matterTaskId = added.json().createdTaskId as string;
  const updated = await updateMatterTask(
    h.db,
    actor,
    matterTaskId,
    { title: "Changed", assigneeId: outsider.id, addToTeam: true },
    h.notifier,
  );
  expect(updated.tasks[0]).toMatchObject({ title: "Changed", assigneeId: outsider.id });
  for (const [record, update] of [
    [contract, () => updateContractTask(h.db, actor, taskId, { title: "Changed" }, h.notifier)],
    [matter, () => updateMatterTask(h.db, actor, matterTaskId, { title: "Changed" }, h.notifier)],
  ] as const) {
    const before = await h.db.select().from(activityLog).where(eq(activityLog.entityId, record.id));
    expect(before.filter((row) => row.action === "task.edited")).toHaveLength(1);
    await update();
    expect(
      await h.db.select().from(activityLog).where(eq(activityLog.entityId, record.id)),
    ).toHaveLength(before.length);
  }
});

it("keeps Confidential records out of Task writes and comment reads", async () => {
  const contract = await createRecord("contract", true);
  const task = await createContractTask(
    h.db,
    actor,
    contract.number,
    { title: "Private" },
    h.notifier,
  );
  for (const run of [
    () => createContractTask(h.db, outsider, contract.number, { title: "Private" }, h.notifier),
    () => updateContractTask(h.db, outsider, task.createdTaskId, { title: "Private" }, h.notifier),
    () => listComments(h.db, outsider, { entityType: "contract", entityId: contract.id }),
  ])
    await expect(run()).rejects.toMatchObject({ statusCode: 404 });
});

it("filters comment tiers and cursor boundaries before paging", async () => {
  const { request } = await submit();
  const [hidden, visible] = await h.db
    .insert(comments)
    .values([
      {
        entityType: "request" as const,
        entityId: request.id,
        authorId: actor.id,
        body: "Internal",
        visibility: "legal_only" as const,
      },
      {
        entityType: "request" as const,
        entityId: request.id,
        authorId: actor.id,
        body: "Public",
        visibility: "full_thread" as const,
      },
    ])
    .returning();
  const business = { ...actor, role: "business_user" as const };
  const query = { entityType: "request" as const, entityId: request.id };
  const result = await listComments(h.db, business, query);
  expect(result.comments.map((row) => row.id)).toEqual([visible!.id]);
  expect(await listComments(h.db, business, { ...query, cursor: hidden!.id })).toEqual({
    comments: [],
    nextCursor: null,
  });
  const response = await h.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=request&entityId=${request.id}`,
    cookies,
    headers: { "x-openlaw-surface": "portal" },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(result).toEqual(response.json());
  await h.db.update(requests).set({ archivedAt: new Date() }).where(eq(requests.id, request.id));
  await expect(listComments(h.db, business, query)).rejects.toMatchObject({ statusCode: 404 });
});

it("rolls back Task creation and activity if its notification fails", async () => {
  const contract = await createRecord("contract");
  const before = await h.db.select().from(activityLog).where(eq(activityLog.entityId, contract.id));
  const notification = vi
    .spyOn(h.notifier, "taskAssigned")
    .mockRejectedValueOnce(new Error("Notification failed"));
  try {
    await expect(
      createContractTask(
        h.db,
        actor,
        contract.number,
        {
          title: "Must roll back",
          assigneeId: actor.id,
        },
        h.notifier,
      ),
    ).rejects.toThrow("Notification failed");
  } finally {
    notification.mockRestore();
  }
  expect(
    await h.db.select().from(contractTasks).where(eq(contractTasks.contractId, contract.id)),
  ).toEqual([]);
  expect(
    await h.db.select().from(activityLog).where(eq(activityLog.entityId, contract.id)),
  ).toHaveLength(before.length);
});

it("names invalid and missing Intake Rows and leaves refused submissions unwritten", async () => {
  const type = (
    await h.db.select().from(requestTypes).where(eq(requestTypes.slug, "contract_review"))
  )[0]!;
  const field = await h.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies,
    payload: { displayName: "Review budget", moduleScope: "contract", fieldType: "number" },
  });
  expect(field.statusCode, field.body).toBe(201);
  const { saveFieldRow } = await import("../testing/form-fixtures.js");
  const attached = await saveFieldRow(h, {
    typeUrl: `/api/v1/request-types/${type.id}`,
    cookies,
    payload: { fieldId: field.json().field.id as string, isRequired: true },
  });
  expect(attached.statusCode, attached.body).toBe(200);
  const body = { requestTypeId: type.id, departmentId, title: " ", urgency: "medium" as const };
  const before = await h.db.select().from(requests);
  await expect(submitRequest(h.db, actor, body, h.notifier)).rejects.toMatchObject({
    statusCode: 400,
    rows: [
      { name: "Title", reason: "missing" },
      { name: "Review budget", reason: "missing" },
    ],
  });
  await expect(
    submitRequest(
      h.db,
      actor,
      { ...body, title: "Budget", customFields: { review_budget: "invalid" } },
      h.notifier,
    ),
  ).rejects.toMatchObject({
    statusCode: 400,
    rows: [{ name: "Review budget", reason: "invalid" }],
  });
  expect(await h.db.select().from(requests)).toHaveLength(before.length);
});
