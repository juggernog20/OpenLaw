// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Tasks through the real-Postgres HTTP seam (MTR-005, #492). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  and,
  asc,
  eq,
  matterKeyDates,
  matters,
  matterStatuses,
  matterTeam,
  matterTypes,
  notifications,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "matter-task-member@example.com",
  displayName: "Morgan Member",
  password: "correct-horse-battery",
} as const;
const TEAMMATE = {
  email: "matter-task-teammate@example.com",
  displayName: "Taylor Teammate",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-task-outsider@example.com",
  displayName: "Olivia Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-task-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

interface TaskRow {
  id: string;
  title: string;
  isDone: boolean;
  assigneeId: string | null;
  dueDate: string | null;
  displayOrder: number;
}

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let memberId = "";
let teammateId = "";
let outsiderId = "";
let contributorId = "";
let typeId = "";
let openStatusId = "";
let closedStatusId = "";

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [TEAMMATE, "legal_team_member"],
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture.email === MEMBER.email) memberId = person.id;
    if (fixture.email === TEAMMATE.email) teammateId = person.id;
    if (fixture.email === OUTSIDER.email) outsiderId = person.id;
    if (fixture.email === CONTRIBUTOR.email) contributorId = person.id;
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  typeId = (await harness.db.select({ id: matterTypes.id }).from(matterTypes).limit(1))[0]!.id;
  const statuses = await harness.db.select().from(matterStatuses);
  openStatusId = statuses.find((row) => row.category === "open")!.id;
  closedStatusId = statuses.find((row) => row.category === "closed")!.id;
}, 180_000);

afterAll(async () => harness.stop());

async function newMatter(
  title: string,
  options: {
    closed?: boolean;
    archived?: boolean;
    managerId?: string | null;
    contributor?: boolean;
    confidential?: boolean;
  } = {},
) {
  const [matter] = await harness.db
    .insert(matters)
    .values({
      title,
      matterTypeId: typeId,
      statusId: options.closed ? closedStatusId : openStatusId,
      managerId: options.managerId ?? memberId,
      closedAt: options.closed ? new Date() : null,
      archivedAt: options.archived ? new Date() : null,
      isConfidential: options.confidential ?? false,
      createdBy: memberId,
    })
    .returning({ id: matters.id, number: matters.number });
  await harness.db
    .insert(matterTeam)
    .values({ matterId: matter!.id, userId: memberId, role: "creator" });
  if (options.contributor) {
    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter!.id, userId: contributorId, role: "contributor" });
  }
  return matter!;
}

const listRaw = (number: number, cookies = memberCookies) =>
  harness.app.inject({ method: "GET", url: `/api/v1/matters/${number}/tasks`, cookies });
async function list(number: number, cookies = memberCookies): Promise<TaskRow[]> {
  const response = await listRaw(number, cookies);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().tasks as TaskRow[];
}
const addRaw = (number: number, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "POST", url: `/api/v1/matters/${number}/tasks`, cookies, payload });
async function add(number: number, payload: Record<string, unknown>): Promise<TaskRow> {
  const response = await addRaw(number, payload);
  expect(response.statusCode, response.body).toBe(201);
  return (response.json().tasks as TaskRow[]).find((row) => row.title === payload.title)!;
}
const editRaw = (id: string, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "PATCH", url: `/api/v1/matter-tasks/${id}`, cookies, payload });
const toggleRaw = (id: string, cookies = memberCookies) =>
  harness.app.inject({ method: "POST", url: `/api/v1/matter-tasks/${id}/toggle`, cookies });
const removeRaw = (id: string, cookies = memberCookies) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/matter-tasks/${id}`, cookies });
const reorderRaw = (number: number, taskIds: string[], cookies = memberCookies) =>
  harness.app.inject({
    method: "PUT",
    url: `/api/v1/matters/${number}/tasks/reorder`,
    cookies,
    payload: { taskIds },
  });

async function waitForMail(email: string, text: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (harness.mailer.messagesTo(email).some((message) => message.text.includes(text))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The assignment email to ${email} did not arrive.`);
}

describe("Matter Tasks", () => {
  it("starts empty and adds assigned, due tasks with deterministic order and counts", async () => {
    const matter = await newMatter("Checklist shape");
    const empty = await listRaw(matter.number);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toEqual({ tasks: [], doneCount: 0, totalCount: 0 });

    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter.id, userId: teammateId, role: "member" });
    await add(matter.number, { title: "Second", assigneeId: teammateId, dueDate: "2030-01-02" });
    await add(matter.number, { title: "First by id tie" });
    const rows = await list(matter.number);
    expect(rows.map((row) => row.title)).toEqual(["Second", "First by id tie"]);
    expect(rows.map((row) => row.displayOrder)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({
      assigneeId: teammateId,
      assigneeName: TEAMMATE.displayName,
      assigneeImage: null,
      dueDate: "2030-01-02",
      isDone: false,
    });
    expect((await listRaw(matter.number)).json()).toMatchObject({ doneCount: 0, totalCount: 2 });
  });

  it("refuses a reorder that does not name every task exactly once", async () => {
    const matter = await newMatter("Tasks bad reorder");
    const a = await add(matter.number, { title: "Alpha" });
    await add(matter.number, { title: "Beta" });
    const other = await newMatter("Tasks reorder neighbour");
    const foreign = await add(other.number, { title: "Gamma" });

    // Missing one.
    expect((await reorderRaw(matter.number, [a.id])).statusCode).toBe(400);
    // Duplicate.
    expect((await reorderRaw(matter.number, [a.id, a.id])).statusCode).toBe(400);
    // A task belonging to another matter.
    expect((await reorderRaw(matter.number, [a.id, foreign.id])).statusCode).toBe(400);

    // The refusals left the original order alone.
    expect((await list(matter.number)).map((row) => row.title)).toEqual(["Alpha", "Beta"]);
  });

  it("edits, completes, reopens, reorders, and removes while narrating every accepted mutation", async () => {
    const matter = await newMatter("Every mutation narrated", { closed: true });
    const first = await add(matter.number, { title: "First" });
    const second = await add(matter.number, { title: "Second" });
    const edited = await editRaw(first.id, { title: "First edited", dueDate: "2030-02-03" });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await toggleRaw(first.id)).statusCode).toBe(200);
    expect((await toggleRaw(first.id)).statusCode).toBe(200);
    const reordered = await reorderRaw(matter.number, [second.id, first.id]);
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(reordered.json().tasks.map((row: TaskRow) => row.title)).toEqual([
      "Second",
      "First edited",
    ]);
    expect((await removeRaw(second.id)).statusCode).toBe(200);

    const actions = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "matter"), eq(activityLog.entityId, matter.id)))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
    expect(actions.map((row) => row.action)).toEqual([
      "task.added",
      "task.added",
      "task.edited",
      "task.completed",
      "task.reopened",
      "task.reordered",
      "task.removed",
    ]);
  });

  it("accepts only an active Matter Manager or active user already on the Matter team", async () => {
    const matter = await newMatter("Assignee invariant");
    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter.id, userId: teammateId, role: "member" });
    expect(
      (await addRaw(matter.number, { title: "Manager", assigneeId: memberId })).statusCode,
    ).toBe(201);
    const assigned = await add(matter.number, { title: "Teammate", assigneeId: teammateId });
    expect(
      (await addRaw(matter.number, { title: "Outsider", assigneeId: outsiderId })).statusCode,
    ).toBe(400);

    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, teammateId));
    expect(
      (await addRaw(matter.number, { title: "Archived", assigneeId: teammateId })).statusCode,
    ).toBe(400);
    await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, teammateId));

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${matter.number}/team/${teammateId}/member`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await list(matter.number)).find((row) => row.id === assigned.id)?.assigneeId).toBe(
      teammateId,
    );
    expect((await editRaw(assigned.id, { title: "Still editable" })).statusCode).toBe(200);
    expect((await editRaw(assigned.id, { assigneeId: teammateId })).statusCode).toBe(400);
  });

  it("raises one direct assignment notification for a new reachable assignee and excludes the actor", async () => {
    const matter = await newMatter("Direct assignment");
    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter.id, userId: teammateId, role: "member" });
    const task = await add(matter.number, { title: "Draft response", assigneeId: teammateId });
    const first = await harness.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, teammateId), eq(notifications.entityId, matter.id)));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ eventType: "matter.task_assigned", entityType: "matter" });
    expect(first[0]!.payload).toMatchObject({
      matterNumber: matter.number,
      taskId: task.id,
      taskTitle: "Draft response",
    });
    await waitForMail(TEAMMATE.email, "Draft response");
    expect(harness.mailer.messagesTo(TEAMMATE.email).at(-1)!.text).toContain(
      `/matters/${matter.number}/tasks`,
    );

    expect((await editRaw(task.id, { assigneeId: teammateId })).statusCode).toBe(200);
    expect(
      await harness.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, teammateId), eq(notifications.entityId, matter.id))),
    ).toHaveLength(1);
    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter.id, userId: contributorId, role: "contributor" });
    expect((await editRaw(task.id, { assigneeId: contributorId })).statusCode).toBe(200);
    expect(
      await harness.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, contributorId), eq(notifications.entityId, matter.id))),
    ).toHaveLength(1);
    const self = await add(matter.number, { title: "Take it myself", assigneeId: memberId });
    expect(self.assigneeId).toBe(memberId);
    expect(
      await harness.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, memberId), eq(notifications.entityId, matter.id))),
    ).toHaveLength(0);
  });

  it("keeps Task due dates out of the Matter's Next deadline surface", async () => {
    const matter = await newMatter("Task date negative control");
    await add(matter.number, { title: "Internal draft", dueDate: "2099-01-01" });
    await harness.db
      .insert(matterKeyDates)
      .values({ matterId: matter.id, date: "2099-02-01", label: "External filing" });
    const dates = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/key-dates`,
      cookies: memberCookies,
    });
    expect(dates.statusCode, dates.body).toBe(200);
    expect(dates.json().deadlines).toHaveLength(1);
    expect(dates.json().deadlines[0]).toMatchObject({ label: "External filing", isNext: true });
    const record = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}`,
      cookies: memberCookies,
    });
    expect(record.json().matter.nextDeadline).toMatchObject({
      label: "External filing",
      date: "2099-02-01",
    });
  });

  it("lets a reached Contributor read but refuses every mutation, with hidden and unknown Matters alike", async () => {
    const reached = await newMatter("Contributor checklist", { contributor: true });
    const hidden = await newMatter("Hidden checklist", { confidential: true });
    const visibleTask = await add(reached.number, { title: "Visible" });
    const hiddenTask = await add(hidden.number, { title: "Hidden" });
    expect((await list(reached.number, contributorCookies)).map((row) => row.title)).toEqual([
      "Visible",
    ]);
    for (const response of [
      await addRaw(reached.number, { title: "No" }, contributorCookies),
      await editRaw(visibleTask.id, { title: "No" }, contributorCookies),
      await toggleRaw(visibleTask.id, contributorCookies),
      await reorderRaw(reached.number, [visibleTask.id], contributorCookies),
      await removeRaw(visibleTask.id, contributorCookies),
    ])
      expect(response.statusCode).toBe(403);
    for (const response of [
      await listRaw(hidden.number, outsiderCookies),
      await listRaw(999_999, outsiderCookies),
      await editRaw(hiddenTask.id, { title: "No" }, outsiderCookies),
    ])
      expect(response.statusCode).toBe(404);
  });

  it("keeps every mutation writable after Closing and freezes all of them only with Archiving", async () => {
    const closed = await newMatter("Closed checklist", { closed: true });
    const task = await add(closed.number, { title: "Late work" });
    expect((await editRaw(task.id, { title: "Late work edited" })).statusCode).toBe(200);
    expect((await toggleRaw(task.id)).statusCode).toBe(200);
    expect((await reorderRaw(closed.number, [task.id])).statusCode).toBe(200);
    expect((await removeRaw(task.id)).statusCode).toBe(200);

    const archived = await newMatter("Archived checklist");
    const frozenTask = await add(archived.number, { title: "Frozen" });
    await harness.db
      .update(matters)
      .set({ archivedAt: new Date() })
      .where(eq(matters.id, archived.id));
    expect((await list(archived.number)).map((row) => row.title)).toEqual(["Frozen"]);
    for (const response of [
      await addRaw(archived.number, { title: "No" }),
      await editRaw(frozenTask.id, { title: "No" }),
      await toggleRaw(frozenTask.id),
      await reorderRaw(archived.number, [frozenTask.id]),
      await removeRaw(frozenTask.id),
    ])
      expect(response.statusCode).toBe(409);
  });
});

describe("explicit team expansion during assignment", () => {
  it("requires an explicit add, persists membership and assignment, and retries without duplicate activity", async () => {
    const record = await newMatter("Task team expansion");
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
      url: `/api/v1/matter-tasks/${taskId}`,
      cookies: memberCookies,
      payload: { assigneeId: contributorId, addToTeam: true },
    });
    expect(retry.statusCode, retry.body).toBe(200);
    const members = await harness.db
      .select()
      .from(matterTeam)
      .where(and(eq(matterTeam.matterId, record.id), eq(matterTeam.userId, contributorId)));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("contributor");
    expect((await list(record.number))[0]?.assigneeId).toBe(contributorId);
    const activity = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, record.id), eq(activityLog.action, "matter.team_added")));
    expect(activity).toHaveLength(1);
    expect((await listRaw(record.number, contributorCookies)).statusCode).toBe(200);
  });

  it("adds a new team member while reassigning an existing task", async () => {
    const record = await newMatter("Reassignment adds team member");
    const created = await addRaw(record.number, { title: "Draft", assigneeId: memberId });
    const taskId = created.json().tasks[0].id;
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-tasks/${taskId}`,
      cookies: memberCookies,
      payload: { assigneeId: outsiderId, addToTeam: true },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await list(record.number))[0]?.assigneeId).toBe(outsiderId);
    const [member] = await harness.db
      .select()
      .from(matterTeam)
      .where(and(eq(matterTeam.matterId, record.id), eq(matterTeam.userId, outsiderId)));
    expect(member?.role).toBe("member");
  });

  it("does not let an ordinary team member expand a confidential audience", async () => {
    const record = await newMatter("Confidential task team");
    await harness.db.update(matters).set({ isConfidential: true }).where(eq(matters.id, record.id));
    await harness.db
      .insert(matterTeam)
      .values({ matterId: record.id, userId: outsiderId, role: "member" });
    const created = await addRaw(record.number, { title: "Draft", assigneeId: memberId });
    const taskId = created.json().tasks[0].id;
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-tasks/${taskId}`,
      cookies: outsiderCookies,
      payload: { assigneeId: contributorId, addToTeam: true },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect((await list(record.number))[0]?.assigneeId).toBe(memberId);
    expect(
      await harness.db
        .select()
        .from(matterTeam)
        .where(and(eq(matterTeam.matterId, record.id), eq(matterTeam.userId, contributorId))),
    ).toHaveLength(0);
    const existing = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-tasks/${taskId}`,
      cookies: outsiderCookies,
      payload: { assigneeId: outsiderId },
    });
    expect(existing.statusCode, existing.body).toBe(200);
    const owner = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-tasks/${taskId}`,
      cookies: memberCookies,
      payload: { assigneeId: contributorId, addToTeam: true },
    });
    expect(owner.statusCode, owner.body).toBe(200);
  });

  it("rolls back membership if assignment notification fails", async () => {
    const record = await newMatter("Atomic team assignment");
    const spy = vi
      .spyOn(harness.app.notifier, "matterTaskAssigned")
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
          .from(matterTeam)
          .where(and(eq(matterTeam.matterId, record.id), eq(matterTeam.userId, contributorId))),
      ).toHaveLength(0);
      expect(
        await harness.db
          .select()
          .from(activityLog)
          .where(
            and(eq(activityLog.entityId, record.id), eq(activityLog.action, "matter.team_added")),
          ),
      ).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
