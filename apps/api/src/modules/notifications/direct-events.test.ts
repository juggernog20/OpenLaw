// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The rest of NOT-002's group 1 (#318, M18/3) at the HTTP seam, over the
 * real-Postgres harness and the real pg-boss queue.
 *
 * **Nothing here looks at the Notifier.** Each case performs the real
 * mutation over HTTP — hands a contract to an Owner (CTR-004), assigns a
 * task (CTR-017), posts a comment that addresses somebody by name
 * (CMT-007), asks again after a rejection (CTR-012) — and then asserts
 * what a person can observe: the bell list from the API, and the mail the
 * harness's `CapturingMailer` caught. No test asserts that the seam was
 * called or how the fan-out is wired.
 *
 * The engine's own properties are pinned by `notifications.test.ts` and
 * are not restated here. What this suite pins is the four events, and the
 * two rules every one of them inherits: **the actor hears nothing about
 * their own act**, and **a record reaches only its own audience**.
 *
 * The mention carries one rule of its own. Who a comment addresses is a
 * queryable list — `comment_mentions` — never a substring of a body, and
 * the mention carries the comment's DD-016 tier, so a Legal Only mention
 * reaches nobody the tier excludes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, desc, eq, notifications, users, type Notification } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who acts: they make every record here, so they hold its
 * `creator` row and are on its team. */
const ACTOR = {
  email: "direct-actor@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** The person every event is aimed at. */
const TARGET = {
  email: "direct-target@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Contributor: on a record's team, so they reach it and hear the
 * working-team tier — and outside the Legal Only room by role (DD-016).
 * That is what makes them the subject of the tier case. */
const CONTRIBUTOR = {
  email: "direct-contributor@example.com",
  displayName: "Cody Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};
const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

/** One bell item, as the API answers it. */
interface BellItem {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  userIds.set(ADMIN.email, admin!.id);
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  for (const fixture of [ACTOR, TARGET, CONTRIBUTOR] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({ role: fixture === CONTRIBUTOR ? "contributor" : "legal_team_member" })
      .where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(ADMIN),
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

/** A contract the acting Member made, so they hold its `creator` row. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(ACTOR),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

/** Commits one field of a contract, as the record's own inline editor
 * does (DES-017). */
function patchContract(
  number: number,
  body: Record<string, unknown>,
  fixture: { email: string } = ACTOR,
) {
  return harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: as(fixture),
    payload: body,
  });
}

/** Hands a contract to somebody as its Owner (CTR-004), requiring
 * success. */
async function assignOwner(
  number: number,
  userId: string | null,
  fixture: { email: string } = ACTOR,
): Promise<void> {
  const res = await patchContract(number, { managerId: userId }, fixture);
  expect(res.statusCode, res.body).toBe(200);
}

/** One page of somebody's bell, as they would read it. */
async function bell(fixture: { email: string }): Promise<BellItem[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/notifications",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { notifications: BellItem[] }).notifications;
}

/** The items on one person's bell about one record. */
const bellFor = async (fixture: { email: string }, contract: ContractRow): Promise<BellItem[]> =>
  (await bell(fixture)).filter((row) => row.entityId === contract.id);

/**
 * Every notification row one person holds, newest first.
 *
 * The one thing this suite reads outside the HTTP seam, and only where
 * the seam cannot answer the question. **"Nothing was written" and "a
 * row was written and the wall omitted it" are the same empty bell**
 * (M10's silent omission), so every case that claims an event told
 * nobody has to be able to tell them apart — otherwise a fan-out that
 * ignored the wall would pass the very test written to catch it. Every
 * positive claim is made against the bell endpoint and the captured
 * mail, and nothing here asserts how the fan-out is wired.
 */
const rowsFor = (fixture: { email: string }): Promise<Notification[]> =>
  harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));

/** How long the email is given before the suite calls the queue stuck.
 * The mailer is a capture, so this is slack for pg-boss, not for SMTP. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Waits for a condition the pipeline is expected to bring about. */
async function settles(what: string, ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${what} did not settle within ${SETTLE_TIMEOUT_MS}ms\n` +
      JSON.stringify(harness.jobLog, null, 2),
  );
}

/** The immediate email one event sent this person about this record —
 * the message that names the record, once the queue has delivered it. */
async function mailAbout(fixture: { email: string }, contract: ContractRow) {
  await settles(`the email to ${fixture.email} about ${contract.title}`, () =>
    Promise.resolve(
      harness.mailer.messagesTo(fixture.email).some((m) => m.text.includes(contract.title)),
    ),
  );
  const message = harness.mailer
    .messagesTo(fixture.email)
    .find((m) => m.text.includes(contract.title));
  expect(message).toBeDefined();
  return message!;
}

/** Walls a record off straight in the column: making a record
 * confidential is not the subject of a notifications test. */
const wallOff = (contractId: string) =>
  harness.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contractId));

/** Puts somebody on a contract's team, which is what puts a Contributor
 * on the record at all and a Member+ inside a walled record's
 * audience. */
async function addToTeam(number: number, userId: string, role = "member"): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: as(ACTOR),
    payload: { userId, role },
  });
  expect(res.statusCode, res.body).toBe(201);
}

describe("being handed a contract (CTR-004)", () => {
  it("leaves the new Owner a bell item and one immediate email", async () => {
    const contract = await newContract("Direct · handed over");
    await assignOwner(contract.number, idOf(TARGET));

    // The bell row is written inside the mutation's own transaction, so
    // it is there the moment the 200 lands — nothing to wait for.
    const items = await bellFor(TARGET, contract);
    expect(items, JSON.stringify(items)).toHaveLength(1);
    expect(items[0]!.eventType).toBe("contract.owner_assigned");
    expect(items[0]!.readAt).toBeNull();
    expect(items[0]!.payload.contractNumber).toBe(contract.number);
    expect(items[0]!.payload.contractTitle).toBe(contract.title);
    expect(items[0]!.payload.actorName).toBe(ACTOR.displayName);

    // The email is the queue's, so this is the one thing the suite waits
    // for. It deep-links to the record it is about (NOT-005).
    const message = await mailAbout(TARGET, contract);
    expect(message.subject).toContain(contract.title);
    expect(message.text).toContain(`http://localhost/contracts/${contract.number}`);
    expect(message.text).toContain(ACTOR.displayName);
    expect(message.text).toContain(TARGET.displayName);
  });

  it("tells the actor nothing about handing it to themselves", async () => {
    const contract = await newContract("Direct · handed to myself");
    const before = (await rowsFor(ACTOR)).length;
    await assignOwner(contract.number, idOf(ACTOR));

    expect(await bellFor(ACTOR, contract)).toEqual([]);
    expect(await rowsFor(ACTOR)).toHaveLength(before);
  });

  it("says nothing when the Owner is cleared or unchanged", async () => {
    // Unassigned is a real state (triage), and nobody is handed
    // anything by it — there is no new Owner to tell.
    const contract = await newContract("Direct · back to triage");
    await assignOwner(contract.number, idOf(TARGET));
    const after = (await rowsFor(TARGET)).length;

    // The same person again is not a hand-over: the PATCH writes
    // nothing, so there is nothing to announce.
    await assignOwner(contract.number, idOf(TARGET));
    await assignOwner(contract.number, null);
    expect(await rowsFor(TARGET)).toHaveLength(after);
  });

  it("reaches the new Owner of a confidential record", async () => {
    // The Owner is inside a walled record's audience by being its Owner
    // (CTR-022), which is only true once the hand-over has committed.
    const contract = await newContract("Direct · handed over behind the wall");
    await wallOff(contract.id);
    await assignOwner(contract.number, idOf(TARGET), ADMIN);

    const items = await bellFor(TARGET, contract);
    expect(items.map((row) => row.eventType)).toEqual(["contract.owner_assigned"]);
    expect((await mailAbout(TARGET, contract)).subject).toContain(contract.title);
  });
});

/** Adds a task to a contract's checklist (CTR-017), answering the
 * checklist it leaves behind. */
async function addTask(
  number: number,
  body: { title: string; assigneeId?: string | null },
): Promise<{ id: string; title: string; assigneeId: string | null }[]> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/tasks`,
    cookies: as(ACTOR),
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().tasks as { id: string; title: string; assigneeId: string | null }[];
}

/** Edits one task, as the checklist's own inline editor does. */
async function editTask(taskId: string, body: Record<string, unknown>): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/tasks/${taskId}`,
    cookies: as(ACTOR),
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe("being given a task (CTR-017)", () => {
  it("leaves the assignee a bell item and one immediate email when the task is added", async () => {
    const contract = await newContract("Direct · a task with a name on it");
    const tasks = await addTask(contract.number, {
      title: "Redline clause 7",
      assigneeId: idOf(TARGET),
    });
    expect(tasks).toHaveLength(1);

    const items = await bellFor(TARGET, contract);
    expect(items, JSON.stringify(items)).toHaveLength(1);
    expect(items[0]!.eventType).toBe("contract.task_assigned");
    expect(items[0]!.payload.contractNumber).toBe(contract.number);
    expect(items[0]!.payload.contractTitle).toBe(contract.title);
    expect(items[0]!.payload.actorName).toBe(ACTOR.displayName);
    expect(items[0]!.payload.taskId).toBe(tasks[0]!.id);
    expect(items[0]!.payload.taskTitle).toBe("Redline clause 7");

    const message = await mailAbout(TARGET, contract);
    // The email names the task as well as the record: "a task" is not
    // something a reader can act on without opening the app twice.
    expect(message.text).toContain("Redline clause 7");
    expect(message.text).toContain(`http://localhost/contracts/${contract.number}`);
    expect(message.text).toContain(ACTOR.displayName);
  });

  it("leaves one when an existing task is handed to somebody", async () => {
    const contract = await newContract("Direct · a task handed on");
    const [task] = await addTask(contract.number, { title: "Chase the counterparty" });
    expect(task!.assigneeId).toBeNull();

    await editTask(task!.id, { assigneeId: idOf(TARGET) });
    const items = await bellFor(TARGET, contract);
    expect(items.map((row) => row.eventType)).toEqual(["contract.task_assigned"]);
    expect(items[0]!.payload.taskTitle).toBe("Chase the counterparty");
    expect((await mailAbout(TARGET, contract)).text).toContain("Chase the counterparty");
  });

  it("says nothing on an edit that leaves the assignee where it was", async () => {
    const contract = await newContract("Direct · a task renamed");
    const [task] = await addTask(contract.number, {
      title: "Draft the SOW",
      assigneeId: idOf(TARGET),
    });
    const after = (await rowsFor(TARGET)).length;

    // Renaming a task, moving its due date, and re-sending the same
    // assignee are all edits to a task somebody already holds. Being
    // told again that it is theirs would be noise.
    await editTask(task!.id, { title: "Draft the SOW v2", dueDate: "2030-01-31" });
    await editTask(task!.id, { assigneeId: idOf(TARGET) });
    expect(await rowsFor(TARGET)).toHaveLength(after);
  });

  it("tells the actor nothing about a task they took themselves", async () => {
    const contract = await newContract("Direct · my own task");
    const before = (await rowsFor(ACTOR)).length;
    await addTask(contract.number, { title: "Read the redline", assigneeId: idOf(ACTOR) });

    expect(await bellFor(ACTOR, contract)).toEqual([]);
    expect(await rowsFor(ACTOR)).toHaveLength(before);
  });

  it("tells nobody outside a confidential record's audience", async () => {
    // The checklist takes any live person as an assignee; the wall is
    // what decides who may be *told*. A Member outside a walled
    // record's audience gets no bell row and no email — silently, which
    // is the only way an omission can be made (DD-014, M10).
    const contract = await newContract("Direct · a task behind the wall");
    await wallOff(contract.id);
    const before = (await rowsFor(TARGET)).length;

    await addTask(contract.number, { title: "Not for you", assigneeId: idOf(TARGET) });
    expect(await bellFor(TARGET, contract)).toEqual([]);
    expect(await rowsFor(TARGET)).toHaveLength(before);
  });
});

/** Posts a comment on a record, as the chat panel's composer does. */
function postComment(
  contract: ContractRow,
  body: {
    body: string;
    visibility: "legal_only" | "working_team" | "full_thread";
    mentions?: string[];
  },
  fixture: { email: string } = ACTOR,
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(fixture),
    payload: { entityType: "contract", entityId: contract.id, ...body },
  });
}

/** Posts a comment, requiring success, and answers its id. */
async function comment(
  contract: ContractRow,
  body: Parameters<typeof postComment>[1],
  fixture: { email: string } = ACTOR,
): Promise<string> {
  const res = await postComment(contract, body, fixture);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { comment: { id: string } }).comment.id;
}

describe("being mentioned in a comment (CMT-007)", () => {
  it("leaves the person named a bell item and one immediate email", async () => {
    const contract = await newContract("Direct · named in the thread");
    const commentId = await comment(contract, {
      body: "@Sarah can you look at the indemnity?",
      visibility: "working_team",
      mentions: [idOf(TARGET)],
    });

    const items = await bellFor(TARGET, contract);
    expect(items, JSON.stringify(items)).toHaveLength(1);
    expect(items[0]!.eventType).toBe("comment.mentioned");
    expect(items[0]!.payload.contractNumber).toBe(contract.number);
    expect(items[0]!.payload.contractTitle).toBe(contract.title);
    expect(items[0]!.payload.actorName).toBe(ACTOR.displayName);
    expect(items[0]!.payload.commentId).toBe(commentId);

    const message = await mailAbout(TARGET, contract);
    expect(message.text).toContain(`http://localhost/contracts/${contract.number}`);
    expect(message.text).toContain(ACTOR.displayName);
    // The comment's own words never leave the building. A mention is a
    // prompt to go and read the thread, and the thread is where the
    // tier is enforced.
    expect(message.text).not.toContain("indemnity");
  });

  it("says nothing about a comment that names nobody", async () => {
    const contract = await newContract("Direct · nobody named");
    await addToTeam(contract.number, idOf(TARGET));
    const before = (await rowsFor(TARGET)).length;

    // Being on a record is group 2's business (NOT-002), and group 2 is
    // not this slice: an ordinary comment is not done *to* anybody.
    await comment(contract, { body: "Filed the executed copy.", visibility: "working_team" });
    expect(await rowsFor(TARGET)).toHaveLength(before);
  });

  it("tells the author nothing about naming themselves", async () => {
    const contract = await newContract("Direct · talking to myself");
    const before = (await rowsFor(ACTOR)).length;
    await comment(contract, {
      body: "Note to self.",
      visibility: "working_team",
      mentions: [idOf(ACTOR)],
    });

    expect(await bellFor(ACTOR, contract)).toEqual([]);
    expect(await rowsFor(ACTOR)).toHaveLength(before);
  });

  it("a Legal Only mention reaches nobody the tier excludes", async () => {
    // The Contributor is on the record's team, so they reach it and
    // hear the working-team tier — and no role puts them in the Legal
    // Only room (DD-016).
    const contract = await newContract("Direct · behind the tier");
    await addToTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const before = (await rowsFor(CONTRIBUTOR)).length;

    // Naming them at a tier they cannot hear is refused outright
    // (CMT-007), so no mention row and no notification is ever made.
    const refused = await postComment(contract, {
      body: "Only for the lawyers.",
      visibility: "legal_only",
      mentions: [idOf(CONTRIBUTOR)],
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(await bellFor(CONTRIBUTOR, contract)).toEqual([]);
    expect(await rowsFor(CONTRIBUTOR)).toHaveLength(before);

    // And the tier is what excluded them, not the record: the same
    // words at the tier they are in the room for do reach them.
    await comment(contract, {
      body: "For the working team.",
      visibility: "working_team",
      mentions: [idOf(CONTRIBUTOR)],
    });
    expect((await bellFor(CONTRIBUTOR, contract)).map((row) => row.eventType)).toEqual([
      "comment.mentioned",
    ]);
  });

  it("reaches the Legal Only room's own people", async () => {
    // The other half of the tier: a Legal Only mention is not silent,
    // it is narrow. A Legal Team Member hears every tier on a record
    // they reach, so this one lands.
    const contract = await newContract("Direct · inside the tier");
    await comment(contract, {
      body: "Privileged: our position on clause 9.",
      visibility: "legal_only",
      mentions: [idOf(TARGET)],
    });

    expect((await bellFor(TARGET, contract)).map((row) => row.eventType)).toEqual([
      "comment.mentioned",
    ]);
    expect((await mailAbout(TARGET, contract)).text).toContain(ACTOR.displayName);
  });
});

/** Asks one person to sign a contract off (CTR-012), answering the id of
 * the request that was made. */
async function ask(contract: ContractRow, approverId: string): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/approvals`,
    cookies: as(ACTOR),
    payload: { approverIds: [approverId] },
  });
  expect(res.statusCode, res.body).toBe(201);
  const roster = (res.json() as { approvals: { id: string; status: string }[] }).approvals;
  const pending = roster.filter((row) => row.status === "pending");
  expect(pending, res.body).toHaveLength(1);
  return pending[0]!.id;
}

/** Answers one request, as the named approver alone may. */
async function reject(approvalId: string, fixture: { email: string }): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/approvals/${approvalId}/decision`,
    cookies: as(fixture),
    payload: { decision: "rejected", note: "Clause 9 needs work." },
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe("being asked again after a rejection (CTR-012)", () => {
  it("tells the approver a second time", async () => {
    // A renewed ask is a new request rather than a reopened one
    // (CTR-012), and it is never silent: the first ask has been
    // answered, so nothing about it is still on that person's plate.
    const contract = await newContract("Direct · asked twice");
    const first = await ask(contract, idOf(TARGET));
    await reject(first, TARGET);

    const afterRejection = await bellFor(TARGET, contract);
    expect(afterRejection.map((row) => row.eventType)).toEqual(["approval.requested"]);

    await ask(contract, idOf(TARGET));

    const items = await bellFor(TARGET, contract);
    expect(items.map((row) => row.eventType)).toEqual(["approval.requested", "approval.requested"]);
    // Two asks, two emails: a second prompt that shared the first one's
    // message would be a prompt nobody received.
    await settles("both approval emails", () =>
      Promise.resolve(
        harness.mailer.messagesTo(TARGET.email).filter((m) => m.text.includes(contract.title))
          .length >= 2,
      ),
    );
  });
});
