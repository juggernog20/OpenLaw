// SPDX-License-Identifier: AGPL-3.0-only

/** A Business User's own Tasks in the Portal (MTR-005 addendum, 2026-10-02). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, eq, matters, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

interface PortalTask {
  id: string;
  title: string;
  dueDate: string | null;
  isDone: boolean;
  isOverdue: boolean;
  record: { kind: "contract" | "matter"; number: number; title: string };
}

let harness: TestHarness;
let admin: Record<string, string>;
let owner: Record<string, string>;
let ownerId: string;
let otherId: string;
let contractTypeId: string;
let matterTypeId: string;

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const people = [
    {
      email: "portal-task-owner@example.com",
      displayName: "Felix Brandt",
      password: "correct-horse-battery",
    },
    {
      email: "portal-task-other@example.com",
      displayName: "Pia Other",
      password: "correct-horse-battery",
    },
  ];
  const ids: string[] = [];
  for (const person of people) {
    const created = await provisionUser(harness.app.auth, person);
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, created.id));
    ids.push(created.id);
  }
  [ownerId, otherId] = ids as [string, string];
  owner = await signInCookies(harness.app, people[0]!.email, people[0]!.password);
  const contractOptions = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: admin,
  });
  contractTypeId = contractOptions.json().contractTypes[0].id;
  const matterOptions = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: admin,
  });
  matterTypeId = matterOptions.json().matterTypes[0].id;
});
afterAll(async () => harness?.stop());

async function record(module: "contract" | "matter", title: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${module}s`,
    cookies: admin,
    payload: { title, ...(module === "contract" ? { contractTypeId } : { matterTypeId }) },
  });
  expect(response.statusCode, response.body).toBe(201);
  const created = response.json()[module] as { id: string; number: number };
  for (const userId of [ownerId, otherId]) {
    const joined = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s/${created.number}/team`,
      cookies: admin,
      payload: { userId },
    });
    expect(joined.statusCode, joined.body).toBe(201);
  }
  return created;
}

async function task(
  module: "contract" | "matter",
  number: number,
  payload: { title: string; assigneeId?: string; dueDate?: string },
): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${module}s/${number}/tasks`,
    cookies: admin,
    payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().createdTaskId as string;
}

async function portalTasks(query = "", cookies = owner) {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/tasks${query}`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { total: number; rows: PortalTask[]; nextCursor: string | null };
}

const toggle = (taskId: string, kind: "contract" | "matter", cookies = owner) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/portal/tasks/${taskId}/toggle`,
    cookies,
    payload: { kind },
  });

describe("Portal Tasks", () => {
  it("lists only the viewer's own Tasks on records they reach in the Portal", async () => {
    const contract = await record("contract", "Supplier dispute");
    const matter = await record("matter", "Warehouse claim");
    await task("contract", contract.number, {
      title: "Send the delivery notes",
      assigneeId: ownerId,
      dueDate: "2000-01-01",
    });
    await task("matter", matter.number, { title: "Find the photos", assigneeId: ownerId });
    await task("matter", matter.number, { title: "Not yours", assigneeId: otherId });
    await task("contract", contract.number, { title: "Unassigned" });
    const archived = await record("matter", "Archived claim");
    await task("matter", archived.number, { title: "Archived work", assigneeId: ownerId });
    await harness.db
      .update(matters)
      .set({ archivedAt: new Date() })
      .where(eq(matters.id, archived.id));

    const all = await portalTasks();
    expect(all.total).toBe(2);
    expect(all.rows.map((row) => row.title)).toEqual([
      "Send the delivery notes",
      "Find the photos",
    ]);
    expect(all.rows[0]).toMatchObject({
      dueDate: "2000-01-01",
      isDone: false,
      isOverdue: true,
      record: { kind: "contract", number: contract.number, title: "Supplier dispute" },
    });
    expect(all.rows[1]).toMatchObject({
      dueDate: null,
      isOverdue: false,
      record: { kind: "matter", number: matter.number, title: "Warehouse claim" },
    });

    const one = await portalTasks(`?kind=matter&number=${matter.number}`);
    expect(one.rows.map((row) => row.title)).toEqual(["Find the photos"]);
    expect(
      (await portalTasks(`?kind=contract&number=${contract.number}`)).rows.map((row) => row.title),
    ).toEqual(["Send the delivery notes"]);

    for (const query of ["?kind=matter", `?number=${matter.number}`, "?limit=0"]) {
      const refused = await harness.app.inject({
        method: "GET",
        url: `/api/v1/portal/tasks${query}`,
        cookies: owner,
      });
      expect(refused.statusCode, refused.body).toBe(400);
    }
    const anonymous = await harness.app.inject({ method: "GET", url: "/api/v1/portal/tasks" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("completes and reopens the viewer's own Task, with them as the actor", async () => {
    const matter = await record("matter", "Insurance claim");
    const taskId = await task("matter", matter.number, {
      title: "Sign the claim form",
      assigneeId: ownerId,
    });

    const completed = await toggle(taskId, "matter");
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().task).toMatchObject({
      id: taskId,
      isDone: true,
      record: { kind: "matter", number: matter.number },
    });
    const scoped = `?kind=matter&number=${matter.number}`;
    expect((await portalTasks(scoped)).total).toBe(0);
    expect((await portalTasks(`${scoped}&includeCompleted=true`)).rows).toMatchObject([
      { id: taskId, isDone: true },
    ]);

    const reopened = await toggle(taskId, "matter");
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().task.isDone).toBe(false);

    const entries = await harness.db
      .select({ action: activityLog.action, actorId: activityLog.actorId })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, matter.id),
          eq(activityLog.entityType, "matter"),
          eq(activityLog.actorId, ownerId),
        ),
      )
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
    expect(entries).toEqual([
      { action: "task.completed", actorId: ownerId },
      { action: "task.reopened", actorId: ownerId },
    ]);
  });

  it("refuses another person's Task, the wrong kind, and every staff Task write", async () => {
    const contract = await record("contract", "Licence renewal");
    const own = await task("contract", contract.number, {
      title: "Confirm the user count",
      assigneeId: ownerId,
    });
    const theirs = await task("contract", contract.number, {
      title: "Confirm the budget",
      assigneeId: otherId,
    });
    const unassigned = await task("contract", contract.number, { title: "Legal review" });

    for (const response of [
      await toggle(theirs, "contract"),
      await toggle(unassigned, "contract"),
      await toggle(own, "matter"),
      await toggle("no-such-task", "contract"),
    ])
      expect(response.statusCode, response.body).toBe(404);
    const extra = await harness.app.inject({
      method: "POST",
      url: `/api/v1/portal/tasks/${own}/toggle`,
      cookies: owner,
      payload: { kind: "contract", isDone: true },
    });
    expect(extra.statusCode, extra.body).toBe(400);

    for (const response of [
      await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/tasks/${own}`,
        cookies: owner,
        payload: { title: "Renamed" },
      }),
      await harness.app.inject({
        method: "PUT",
        url: `/api/v1/contracts/${contract.number}/tasks/reorder`,
        cookies: owner,
        payload: { taskIds: [own, theirs, unassigned] },
      }),
      await harness.app.inject({ method: "DELETE", url: `/api/v1/tasks/${own}`, cookies: owner }),
      await harness.app.inject({
        method: "POST",
        url: `/api/v1/tasks/${own}/toggle`,
        cookies: owner,
      }),
    ])
      expect(response.statusCode, response.body).toBe(403);
  });

  it("hides the Tasks on a record after team removal, on the next read", async () => {
    const matter = await record("matter", "Lease exit");
    const taskId = await task("matter", matter.number, {
      title: "Return the keys",
      assigneeId: ownerId,
    });
    const scoped = `?kind=matter&number=${matter.number}`;
    expect((await portalTasks(scoped)).total).toBe(1);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${matter.number}/team/${ownerId}`,
      cookies: admin,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await portalTasks(scoped)).total).toBe(0);
    expect((await portalTasks()).rows.some((row) => row.id === taskId)).toBe(false);
    expect((await toggle(taskId, "matter")).statusCode).toBe(404);
  });
});
