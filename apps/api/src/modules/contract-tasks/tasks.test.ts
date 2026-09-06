// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-017's task checklist (M17/1), at the HTTP seam through the
 * real-Postgres harness.
 *
 * A task is a lightweight checklist item: title, done flag, optional
 * assignee, optional due date, display order. A Member+ user with reach
 * adds one, edits one, toggles one, reorders the list, and removes one,
 * and every one of those five writes lands its own closed-union activity
 * entry — read straight from `activity_log`, the key-dates precedent.
 *
 * Task due dates never join the deadline union — a named test asserts it.
 *
 * Reach is the last subject. Nothing here holds an audience of its own
 * (DD-014, CTR-021): a viewer outside a confidential record's audience
 * is answered exactly as for a contract that was never created, on the
 * listing and on every write alike.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  and,
  asc,
  eq,
  inArray,
  users,
  contracts,
  contractTasks,
  contractTeam,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "task-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "task-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "task-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let contributorId = "";
let outsiderId = "";
let memberId = "";
let ndaTypeId = "";

interface TaskRow {
  id: string;
  title: string;
  isDone: boolean;
  assigneeId: string | null;
  dueDate: string | null;
  displayOrder: number;
}

interface ContractRow {
  id: string;
  number: number;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  memberId = member.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const outsider = await provisionUser(harness.app.auth, OUTSIDER);
  outsiderId = outsider.id;
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, outsider.id));
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);

  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  contributorId = contributor.id;
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const types = res.json().contractTypes as { id: string; slug: string }[];
  ndaTypeId = types.find((row) => row.slug === "nda")!.id;
});

afterAll(async () => {
  await harness.stop();
});

async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { title, contractTypeId: ndaTypeId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

const listRaw = (number: number, cookies = memberCookies) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}/tasks`, cookies });

async function list(number: number, cookies = memberCookies): Promise<TaskRow[]> {
  const res = await listRaw(number, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tasks as TaskRow[];
}

const addRaw = (number: number, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/tasks`,
    cookies,
    payload,
  });

async function add(
  number: number,
  payload: Record<string, unknown>,
  cookies = memberCookies,
): Promise<string> {
  const res = await addRaw(number, payload, cookies);
  expect(res.statusCode, res.body).toBe(201);
  const rows = res.json().tasks as TaskRow[];
  const landed = rows.find((row) => row.title === payload.title);
  expect(landed, res.body).toBeDefined();
  return landed!.id;
}

const editRaw = (id: string, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "PATCH", url: `/api/v1/tasks/${id}`, cookies, payload });

async function edit(
  id: string,
  payload: Record<string, unknown>,
  cookies = memberCookies,
): Promise<TaskRow[]> {
  const res = await editRaw(id, payload, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tasks as TaskRow[];
}

const toggleRaw = (id: string, cookies = memberCookies) =>
  harness.app.inject({ method: "POST", url: `/api/v1/tasks/${id}/toggle`, cookies });

const removeRaw = (id: string, cookies = memberCookies) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/tasks/${id}`, cookies });

const reorderRaw = (number: number, taskIds: string[], cookies = memberCookies) =>
  harness.app.inject({
    method: "PUT",
    url: `/api/v1/contracts/${number}/tasks/reorder`,
    cookies,
    payload: { taskIds },
  });

/** Every task entry on one contract, oldest first. */
const taskEntriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        inArray(activityLog.action, [
          "task.added",
          "task.edited",
          "task.completed",
          "task.reopened",
          "task.removed",
        ]),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

describe("tasks on a contract (CTR-017)", () => {
  it("starts a record with an empty checklist", async () => {
    const contract = await newContract("Tasks at birth");
    const tasks = await list(contract.number);
    expect(tasks).toEqual([]);
    const res = await listRaw(contract.number);
    expect(res.json().doneCount).toBe(0);
    expect(res.json().totalCount).toBe(0);
  });

  it("adds a task and narrates it", async () => {
    const contract = await newContract("Tasks added");
    const id = await add(contract.number, { title: "Draft the NDA" });

    const tasks = await list(contract.number);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id,
      title: "Draft the NDA",
      isDone: false,
      assigneeId: null,
      dueDate: null,
      displayOrder: 0,
    });

    const entries = await taskEntriesOn(contract.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("task.added");
    expect(entries[0]!.visibility).toBe("working_team");
    expect(entries[0]!.payload).toMatchObject({
      taskId: id,
      title: "Draft the NDA",
    });
  });

  it("delegates independently of the Owner and moves the task between personal task lists", async () => {
    const contract = await newContract("Independent task assignment");
    await harness.db
      .update(contracts)
      .set({ managerId: memberId })
      .where(eq(contracts.id, contract.id));
    await harness.db
      .insert(contractTeam)
      .values({ contractId: contract.id, userId: contributorId, role: "contributor" });
    const id = await add(contract.number, { title: "Junior drafts", assigneeId: memberId });
    const homeIds = async (cookies: Record<string, string>) => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/home/tasks",
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().rows.map((row: { id: string }) => row.id);
    };
    expect(await homeIds(memberCookies)).toContain(id);
    expect(await homeIds(contributorCookies)).not.toContain(id);
    await edit(id, { assigneeId: contributorId });
    const [stored] = await harness.db.select().from(contractTasks).where(eq(contractTasks.id, id));
    const [owner] = await harness.db
      .select({ managerId: contracts.managerId })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(stored?.assigneeId).toBe(contributorId);
    expect(owner?.managerId).toBe(memberId);
    expect((await list(contract.number))[0]).toMatchObject({
      assigneeId: contributorId,
      assigneeName: CONTRIBUTOR.displayName,
      assigneeImage: null,
    });
    expect(await homeIds(memberCookies)).not.toContain(id);
    expect(await homeIds(contributorCookies)).toContain(id);
  });

  it("adds a task with assignee and due date", async () => {
    const contract = await newContract("Tasks with fields");
    const id = await add(contract.number, {
      title: "Review redline",
      assigneeId: memberId,
      dueDate: "2027-06-01",
    });

    const tasks = await list(contract.number);
    expect(tasks[0]).toMatchObject({
      id,
      title: "Review redline",
      isDone: false,
      assigneeId: memberId,
      dueDate: "2027-06-01",
    });
  });

  it("edits a task and narrates only what moved", async () => {
    const contract = await newContract("Tasks edited");
    const id = await add(contract.number, { title: "Draft NDA" });

    const moved = await edit(id, { title: "Draft the NDA", dueDate: "2027-07-01" });
    expect(moved.find((row) => row.id === id)).toMatchObject({
      title: "Draft the NDA",
      dueDate: "2027-07-01",
    });

    const entries = await taskEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["task.added", "task.edited"]);
    const payload = entries[1]!.payload as {
      title: string;
      changed: Record<string, { from: unknown; to: unknown }>;
    };
    expect(payload.title).toBe("Draft the NDA");
    expect(Object.keys(payload.changed).sort()).toEqual(["dueDate", "title"]);
    expect(payload.changed.title).toEqual({ from: "Draft NDA", to: "Draft the NDA" });
  });

  it("writes no entry when an edit changes nothing", async () => {
    const contract = await newContract("Tasks unchanged");
    const id = await add(contract.number, { title: "Check signature" });
    await edit(id, { title: "Check signature" });

    const entries = await taskEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["task.added"]);
  });

  it("toggles a task to done and narrates task.completed", async () => {
    const contract = await newContract("Tasks toggled done");
    const id = await add(contract.number, { title: "Sign the NDA" });

    const res = await toggleRaw(id);
    expect(res.statusCode, res.body).toBe(200);
    const tasks = res.json().tasks as TaskRow[];
    expect(tasks.find((row) => row.id === id)!.isDone).toBe(true);
    expect(res.json().doneCount).toBe(1);

    const entries = await taskEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["task.added", "task.completed"]);
    expect(entries[1]!.payload).toMatchObject({ taskId: id, title: "Sign the NDA" });
  });

  it("toggles a done task back to open and narrates task.reopened", async () => {
    const contract = await newContract("Tasks reopened");
    const id = await add(contract.number, { title: "File the executed copy" });
    await toggleRaw(id);

    const res = await toggleRaw(id);
    expect(res.statusCode, res.body).toBe(200);
    const tasks = res.json().tasks as TaskRow[];
    expect(tasks.find((row) => row.id === id)!.isDone).toBe(false);

    const entries = await taskEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual([
      "task.added",
      "task.completed",
      "task.reopened",
    ]);
  });

  it("reorders the checklist", async () => {
    const contract = await newContract("Tasks reordered");
    const a = await add(contract.number, { title: "First" });
    const b = await add(contract.number, { title: "Second" });
    const c = await add(contract.number, { title: "Third" });

    const res = await reorderRaw(contract.number, [c, a, b]);
    expect(res.statusCode, res.body).toBe(200);
    const tasks = res.json().tasks as TaskRow[];
    expect(tasks.map((row) => row.title)).toEqual(["Third", "First", "Second"]);
    expect(tasks.map((row) => row.displayOrder)).toEqual([0, 1, 2]);
  });

  it("refuses a reorder that does not name every task exactly once", async () => {
    const contract = await newContract("Tasks bad reorder");
    const a = await add(contract.number, { title: "Alpha" });
    await add(contract.number, { title: "Beta" });

    // Missing one.
    expect((await reorderRaw(contract.number, [a])).statusCode).toBe(400);
    // Duplicate.
    expect((await reorderRaw(contract.number, [a, a])).statusCode).toBe(400);
  });

  it("removes a task and leaves the entry as its record", async () => {
    const contract = await newContract("Tasks removed");
    const id = await add(contract.number, { title: "Circulate for approval" });

    const res = await removeRaw(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tasks).toEqual([]);
    expect(await list(contract.number)).toEqual([]);

    const entries = await taskEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["task.added", "task.removed"]);
    expect(entries[1]!.payload).toMatchObject({
      taskId: id,
      title: "Circulate for approval",
    });

    expect((await removeRaw(id)).statusCode).toBe(404);
  });

  it("refuses a title that is blank or too long, and writes nothing", async () => {
    const contract = await newContract("Tasks bounds");
    expect((await addRaw(contract.number, { title: "   " })).statusCode).toBe(400);
    expect((await addRaw(contract.number, { title: "x".repeat(201) })).statusCode).toBe(400);
    expect(await list(contract.number)).toEqual([]);
    expect(await taskEntriesOn(contract.id)).toHaveLength(0);
  });
});

describe("task due dates never join the deadline union (CTR-017)", () => {
  it("a task with a due date does not appear in the key-dates surface", async () => {
    const contract = await newContract("Tasks deadline isolation");
    await add(contract.number, { title: "Review by Friday", dueDate: "2027-03-01" });

    const deadlines = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contract.number}/key-dates`,
      cookies: memberCookies,
    });
    expect(deadlines.statusCode, deadlines.body).toBe(200);
    const rows = deadlines.json().deadlines as { source: string }[];
    // No key-date entry was created; any existing entries are term-derived
    // (expiry, notice_deadline), never from tasks.
    expect(rows.every((row) => row.source !== "task")).toBe(true);
    // And for a contract with no term dates set, the union should be empty.
    expect(rows).toEqual([]);
  });
});

describe("who may read and write tasks (CTR-021, DD-015)", () => {
  it("lets a Contributor on the team read the checklist and write nothing on it", async () => {
    const contract = await newContract("Tasks contributor");
    const joined = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: memberCookies,
      payload: { userId: contributorId, role: "contributor" },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const id = await add(contract.number, { title: "Draft the brief" });

    expect((await list(contract.number, contributorCookies)).map((row) => row.title)).toEqual([
      "Draft the brief",
    ]);
    expect((await addRaw(contract.number, { title: "Mine" }, contributorCookies)).statusCode).toBe(
      403,
    );
    expect((await editRaw(id, { title: "Mine" }, contributorCookies)).statusCode).toBe(403);
    expect((await toggleRaw(id, contributorCookies)).statusCode).toBe(403);
    expect((await removeRaw(id, contributorCookies)).statusCode).toBe(403);
  });

  it("refuses every write on an archived record until it is restored", async () => {
    const contract = await newContract("Tasks frozen");
    const id = await add(contract.number, { title: "Draft the brief" });
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: memberCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    expect((await list(contract.number)).map((row) => row.title)).toEqual(["Draft the brief"]);
    expect((await addRaw(contract.number, { title: "Later" })).statusCode).toBe(409);
    expect((await editRaw(id, { title: "Later" })).statusCode).toBe(409);
    expect((await toggleRaw(id)).statusCode).toBe(409);
    expect((await removeRaw(id)).statusCode).toBe(409);
  });
});

describe("tasks on a confidential contract (DD-014)", () => {
  it("omits the listing and the activity entries from a viewer outside the audience", async () => {
    const walled = await newContract("Tasks walled");
    const id = await add(walled.number, { title: "Board paper circulated" });
    await edit(id, { title: "Board paper circulated to the committee" });

    expect((await list(walled.number, outsiderCookies)).length).toBe(1);

    const flag = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${walled.number}`,
      cookies: memberCookies,
      payload: { isConfidential: true },
    });
    expect(flag.statusCode, flag.body).toBe(200);

    const refused = await listRaw(walled.number, outsiderCookies);
    const absent = await listRaw(999_999, outsiderCookies);
    expect(refused.statusCode).toBe(404);
    expect(refused.body).not.toContain("Board paper");
    expect(refused.json().detail).toBe(absent.json().detail);
    expect((await addRaw(walled.number, { title: "Mine" }, outsiderCookies)).statusCode).toBe(404);
    expect((await editRaw(id, { title: "Mine" }, outsiderCookies)).statusCode).toBe(404);
    expect((await toggleRaw(id, outsiderCookies)).statusCode).toBe(404);
    expect((await removeRaw(id, outsiderCookies)).statusCode).toBe(404);

    const feed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=contract&entityId=${walled.id}`,
      cookies: outsiderCookies,
    });
    expect(feed.statusCode).toBe(404);
    expect(feed.body).not.toContain("Board paper");

    expect((await list(walled.number)).length).toBe(1);
  });
});

describe("explicit team expansion during assignment", () => {
  it("requires an explicit add, persists membership and assignment, and retries without duplicate activity", async () => {
    const record = await newContract("Task team expansion");
    const refused = await addRaw(record.number, { title: "Draft", assigneeId: contributorId });
    expect(refused.statusCode, refused.body).toBe(400);
    const created = await addRaw(record.number, {
      title: "Draft",
      assigneeId: contributorId,
      addToTeam: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const taskId = created.json().tasks[0].id;
    const retry = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      cookies: memberCookies,
      payload: { assigneeId: contributorId, addToTeam: true },
    });
    expect(retry.statusCode, retry.body).toBe(200);
    const members = await harness.db
      .select()
      .from(contractTeam)
      .where(and(eq(contractTeam.contractId, record.id), eq(contractTeam.userId, contributorId)));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("contributor");
    expect((await list(record.number))[0]?.assigneeId).toBe(contributorId);
    const activity = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.entityId, record.id), eq(activityLog.action, "contract.team_added")),
      );
    expect(activity).toHaveLength(1);
    expect((await listRaw(record.number, contributorCookies)).statusCode).toBe(200);
  });

  it("adds a new team member while reassigning an existing task", async () => {
    const record = await newContract("Reassignment adds team member");
    const created = await addRaw(record.number, { title: "Draft", assigneeId: memberId });
    const taskId = created.json().tasks[0].id;
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      cookies: memberCookies,
      payload: { assigneeId: outsiderId, addToTeam: true },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await list(record.number))[0]?.assigneeId).toBe(outsiderId);
    const [member] = await harness.db
      .select()
      .from(contractTeam)
      .where(and(eq(contractTeam.contractId, record.id), eq(contractTeam.userId, outsiderId)));
    expect(member?.role).toBe("member");
  });

  it("does not let an ordinary team member expand a confidential audience", async () => {
    const record = await newContract("Confidential task team");
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, record.id));
    await harness.db
      .insert(contractTeam)
      .values({ contractId: record.id, userId: outsiderId, role: "member" });
    const created = await addRaw(record.number, { title: "Draft", assigneeId: memberId });
    const taskId = created.json().tasks[0].id;
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      cookies: outsiderCookies,
      payload: { assigneeId: contributorId, addToTeam: true },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect((await list(record.number))[0]?.assigneeId).toBe(memberId);
    expect(
      await harness.db
        .select()
        .from(contractTeam)
        .where(and(eq(contractTeam.contractId, record.id), eq(contractTeam.userId, contributorId))),
    ).toHaveLength(0);
    const existing = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      cookies: outsiderCookies,
      payload: { assigneeId: outsiderId },
    });
    expect(existing.statusCode, existing.body).toBe(200);
    const owner = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      cookies: memberCookies,
      payload: { assigneeId: contributorId, addToTeam: true },
    });
    expect(owner.statusCode, owner.body).toBe(200);
  });

  it("rolls back membership if assignment notification fails", async () => {
    const record = await newContract("Atomic team assignment");
    const spy = vi
      .spyOn(harness.app.notifier, "taskAssigned")
      .mockRejectedValueOnce(new Error("notification failure"));
    try {
      const response = await addRaw(record.number, {
        title: "Draft",
        assigneeId: contributorId,
        addToTeam: true,
      });
      expect(response.statusCode).toBe(500);
      expect(await list(record.number)).toHaveLength(0);
      expect(
        await harness.db
          .select()
          .from(contractTeam)
          .where(
            and(eq(contractTeam.contractId, record.id), eq(contractTeam.userId, contributorId)),
          ),
      ).toHaveLength(0);
      expect(
        await harness.db
          .select()
          .from(activityLog)
          .where(
            and(eq(activityLog.entityId, record.id), eq(activityLog.action, "contract.team_added")),
          ),
      ).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
