// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The notification engine and its first event (#316, M18/1) at the HTTP
 * seam, through the real-Postgres harness and the real pg-boss queue.
 *
 * **Nothing here looks at the Notifier.** A suite performs the real
 * mutation over HTTP — somebody asks a colleague to sign a contract off
 * (CTR-012) — and then asserts what a person can observe: the bell list
 * and the unread count from the API, and the mail the harness's
 * `CapturingMailer` caught. No test asserts that the seam was called or
 * how the fan-out is wired.
 *
 * Six properties are pinned.
 *
 * **The tracer bullet.** One approval request leaves one bell item for
 * the approver and one immediate email, and the item deep-links to the
 * record.
 *
 * **The actor hears nothing about their own act** (NOT-002). CTR-012
 * permits self-approval, so somebody can ask themselves — and that ask
 * must leave them nothing at all.
 *
 * **The mutation never depends on the channels.** A rolled-back
 * transaction leaves no bell row, and a queue that cannot be reached
 * fails no mutation: the 201 lands, the bell row lands with it, and the
 * email is still recorded as owed.
 *
 * **The wall has no cracks** (DD-014, CTR-022, M10). A record walled off
 * **after** an item existed takes that item out of the list *and* out of
 * the count, silently — the M10 answer, applied to a second surface.
 *
 * **An unconfigured relay degrades one channel and hides nothing**
 * (TECH-011). The bell row stays, the skip is recorded on it as
 * terminal, and the pipeline says "unconfigured" out loud.
 *
 * **The reads are the signed-in person's, and they page.**
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, contracts, desc, eq, notifications, users, type Notification } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { buildApp } from "../../app.js";
import { createNotifier } from "../../lib/notifications/notifier.js";
import { createUnconfiguredJobQueue } from "../../pipeline/jobs.js";
import { testDeps } from "../../testing/deps.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who asks. On the team of every record here, because they
 * make them. */
const MEMBER = {
  email: "notif-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** The approver: everything this milestone promises lands on them. */
const APPROVER = {
  email: "notif-approver@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A second approver, so a confidential record has somebody inside its
 * audience to reach. */
const INSIDER = {
  email: "notif-insider@example.com",
  displayName: "Marcus Webb",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Legal Team Member with no team row anywhere. They reach every open
 * contract and nothing of a walled one — which is what makes them the
 * subject of the silent-omission case. */
const OUTSIDER = {
  email: "notif-outsider@example.com",
  displayName: "Otto Outsider",
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

  for (const fixture of [MEMBER, APPROVER, INSIDER, OUTSIDER] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
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

/** A contract the asking Member made, so they hold its `creator` row. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(MEMBER),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

const requestApprovals = (jar: Record<string, string>, number: number, approverIds: string[]) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/approvals`,
    cookies: jar,
    payload: { approverIds },
  });

/** Asks for one approval, requiring success. */
async function ask(number: number, approverId: string, jar = as(MEMBER)): Promise<void> {
  const res = await requestApprovals(jar, number, [approverId]);
  expect(res.statusCode, res.body).toBe(201);
}

/** One page of somebody's bell, as they would read it. */
async function bell(
  fixture: { email: string },
  cursor?: string,
): Promise<{ notifications: BellItem[]; nextCursor: string | null }> {
  const res = await harness.app.inject({
    method: "GET",
    url: cursor ? `/api/v1/notifications?cursor=${cursor}` : "/api/v1/notifications",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { notifications: BellItem[]; nextCursor: string | null };
}

/** Somebody's unread badge, as the top nav would read it. */
async function unread(fixture: { email: string }): Promise<number> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/notifications/unread-count",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { unread: number }).unread;
}

/** Every notification row one person holds, newest first. Read from the
 * table for the facts the API deliberately does not publish — whether
 * an email was owed, and whether it went or was given up on. */
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

/** Mail this person has received, once at least `count` of it has. */
async function mailTo(fixture: { email: string }, count: number) {
  await settles(`${count} message(s) to ${fixture.email}`, () =>
    Promise.resolve(harness.mailer.messagesTo(fixture.email).length >= count),
  );
  return harness.mailer.messagesTo(fixture.email);
}

/** Walls a record off straight in the column: making a record
 * confidential is not the subject of a notifications test. */
const wallOff = (contractId: string) =>
  harness.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contractId));

/** Puts somebody on a contract's team, which is what puts a Member+
 * inside a walled record's audience. */
async function addToTeam(number: number, userId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: as(MEMBER),
    payload: { userId, role: "member" },
  });
  expect(res.statusCode, res.body).toBe(201);
}

describe("an approval request reaches its approver", () => {
  it("leaves a bell item and sends one immediate email", async () => {
    const contract = await newContract("Notify · the tracer bullet");
    await ask(contract.number, idOf(APPROVER));

    // The bell row is written inside the mutation's own transaction, so
    // it is there the moment the 201 lands — nothing to wait for.
    const page = await bell(APPROVER);
    const item = page.notifications.find((row) => row.entityId === contract.id);
    expect(item, JSON.stringify(page)).toBeDefined();
    expect(item!.eventType).toBe("approval.requested");
    expect(item!.entityType).toBe("contract");
    expect(item!.readAt).toBeNull();
    expect(item!.payload.contractNumber).toBe(contract.number);
    expect(item!.payload.contractTitle).toBe(contract.title);
    expect(item!.payload.actorName).toBe(MEMBER.displayName);
    expect(await unread(APPROVER)).toBeGreaterThanOrEqual(1);

    // The email is the queue's, so this is the one thing the suite waits
    // for. It deep-links to the record it is about (NOT-005).
    const mail = await mailTo(APPROVER, 1);
    const message = mail.find((m) => m.text.includes(contract.title));
    expect(message, JSON.stringify(mail)).toBeDefined();
    expect(message!.subject).toContain(contract.title);
    expect(message!.text).toContain(`http://localhost/contracts/${contract.number}`);
    expect(message!.text).toContain(MEMBER.displayName);

    // And the row records that the email it owed has gone.
    await settles("the notification's email", async () => {
      const rows = await rowsFor(APPROVER);
      const row = rows.find((r) => r.entityId === contract.id);
      return row?.emailedAt !== null && row?.emailedAt !== undefined;
    });
    const row = (await rowsFor(APPROVER)).find((r) => r.entityId === contract.id);
    expect(row!.emailOwed).toBe(true);
    expect(row!.emailSkippedAt).toBeNull();
  });

  it("tells the actor nothing about their own act", async () => {
    const contract = await newContract("Notify · asking myself");
    const before = await rowsFor(MEMBER);
    // CTR-012 allows self-approval, so this is a real ask and not a
    // contrivance — and it must leave the person who made it nothing.
    await ask(contract.number, idOf(MEMBER));

    const page = await bell(MEMBER);
    expect(page.notifications.filter((row) => row.entityId === contract.id)).toEqual([]);
    expect(await rowsFor(MEMBER)).toHaveLength(before.length);
    expect(harness.mailer.messagesTo(MEMBER.email)).toEqual([]);
  });
});

describe("the mutation never depends on the channels", () => {
  it("leaves no bell row when the transaction rolls back", async () => {
    const contract = await newContract("Notify · rolled back");
    const before = (await rowsFor(APPROVER)).length;

    // The seam's own transactional promise, stated where it can be
    // stated: everything the notifier writes is inside the caller's
    // transaction, so a mutation that does not commit tells nobody
    // anything. The route cannot be made to fail after its write, so
    // the failure is arranged here instead.
    const notifier = createNotifier({
      db: harness.db,
      jobs: harness.pipeline,
      log: { error: () => {} },
    });
    await expect(
      notifier.notifying(async (tx) => {
        await notifier.approvalRequested(tx, {
          contractId: contract.id,
          contractNumber: contract.number,
          contractTitle: contract.title,
          actorId: idOf(MEMBER),
          actorName: MEMBER.displayName,
          approvals: [{ approvalId: "never-committed", approverId: idOf(APPROVER) }],
        });
        throw new Error("the mutation failed after it had told somebody");
      }),
    ).rejects.toThrow("the mutation failed");

    expect((await rowsFor(APPROVER)).length).toBe(before);
    const page = await bell(APPROVER);
    expect(page.notifications.filter((row) => row.entityId === contract.id)).toEqual([]);
  });

  it("still completes the mutation when the queue cannot be reached", async () => {
    // The M12 shape said for mail: the row is the record of the work
    // owed and the queue send is only the wake-up, so a queue that is
    // down costs a delay and never a mutation.
    // The overrides go in rather than over: the notifier is built from
    // whichever database and queue the app ends up with, so handing
    // them in is what makes this app's seam speak to a queue that is
    // genuinely down.
    const app = await buildApp(testDeps({ db: harness.db, jobs: createUnconfiguredJobQueue() }));
    try {
      await app.ready();
      const contract = await newContract("Notify · no queue");
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/contracts/${contract.number}/approvals`,
        cookies: as(MEMBER),
        payload: { approverIds: [idOf(APPROVER)] },
      });
      expect(res.statusCode, res.body).toBe(201);

      const rows = await rowsFor(APPROVER);
      const row = rows.find((r) => r.entityId === contract.id);
      expect(row, "the bell row lands whatever the queue does").toBeDefined();
      // Owed, and nobody has answered for it: exactly the state the
      // scheduled round re-asks from.
      expect(row!.emailOwed).toBe(true);
      expect(row!.emailedAt).toBeNull();
      expect(row!.emailSkippedAt).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("the wall has no cracks", () => {
  it("reaches an approver inside a confidential record's audience", async () => {
    const contract = await newContract("Notify · confidential");
    await addToTeam(contract.number, idOf(INSIDER));
    await wallOff(contract.id);

    await ask(contract.number, idOf(INSIDER));
    const page = await bell(INSIDER);
    expect(page.notifications.map((row) => row.entityId)).toContain(contract.id);
    const mail = await mailTo(INSIDER, 1);
    expect(mail.some((m) => m.text.includes(contract.title))).toBe(true);
  });

  it("takes an item out of the list and the count when the record is walled off afterwards", async () => {
    const contract = await newContract("Notify · walled off later");
    // Asked while the record is open, which is what makes the outsider
    // a legitimate approver at the moment of the ask.
    await ask(contract.number, idOf(OUTSIDER));
    const beforeList = await bell(OUTSIDER);
    expect(beforeList.notifications.map((row) => row.entityId)).toContain(contract.id);
    const beforeCount = await unread(OUTSIDER);
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    await wallOff(contract.id);

    // The row is still in the table; the reads simply stop answering
    // with it. Silently — no gap, no tombstone, and no number that says
    // something was left out (M10).
    const afterList = await bell(OUTSIDER);
    expect(afterList.notifications.map((row) => row.entityId)).not.toContain(contract.id);
    expect(await unread(OUTSIDER)).toBe(beforeCount - 1);
    expect((await rowsFor(OUTSIDER)).some((row) => row.entityId === contract.id)).toBe(true);
  });
});

describe("the reads answer for the signed-in person", () => {
  it("never shows one person another person's bell", async () => {
    const contract = await newContract("Notify · not yours");
    await ask(contract.number, idOf(APPROVER));

    const page = await bell(INSIDER);
    expect(page.notifications.map((row) => row.entityId)).not.toContain(contract.id);
  });

  it("refuses a caller who is not signed in", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/notifications" });
    expect(res.statusCode).toBe(401);
    const count = await harness.app.inject({
      method: "GET",
      url: "/api/v1/notifications/unread-count",
    });
    expect(count.statusCode).toBe(401);
  });

  it("answers an empty page for a cursor that names nothing in this bell", async () => {
    // Two ways a cursor can be a stranger here, and both answer the
    // same way. A cursor is a place in one person's bell, not a
    // timestamp in the table — so one that names nothing must not be a
    // way to ask whether an item exists.
    const contract = await newContract("Notify · a stranger's cursor");
    await ask(contract.number, idOf(APPROVER));
    const theirs = await bell(APPROVER);
    const cursor = theirs.notifications[0]?.id;
    expect(cursor, JSON.stringify(theirs)).toBeDefined();

    const withTheirCursor = await bell(INSIDER, cursor!);
    expect(withTheirCursor.notifications).toEqual([]);
    expect(withTheirCursor.nextCursor).toBeNull();

    const withNothing = await bell(INSIDER, "no-such-notification-id");
    expect(withNothing.notifications).toEqual([]);
    expect(withNothing.nextCursor).toBeNull();
  });

  it("pages, oldest behind the cursor", async () => {
    const contract = await newContract("Notify · a long bell");
    // Seeded straight into the table: what is under test here is the
    // read's paging, and thirty round trips through the approval route
    // would be thirty emails to prove one keyset.
    const seeded = 30;
    await harness.db.insert(notifications).values(
      Array.from({ length: seeded }, (_, index) => ({
        userId: idOf(INSIDER),
        eventType: "approval.requested",
        entityType: "contract" as const,
        entityId: contract.id,
        payload: { contractNumber: contract.number, contractTitle: contract.title, seq: index },
        emailOwed: false,
      })),
    );

    const first = await bell(INSIDER);
    expect(first.notifications.length).toBeLessThan(seeded);
    expect(first.nextCursor).not.toBeNull();
    const second = await bell(INSIDER, first.nextCursor!);
    const firstIds = new Set(first.notifications.map((row) => row.id));
    expect(second.notifications.some((row) => firstIds.has(row.id))).toBe(false);
    // Newest first, as a feed is read.
    const times = first.notifications.map((row) => Date.parse(row.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe("an unconfigured relay", () => {
  it("skips the email, records the skip, keeps the bell row, and says so loudly", async () => {
    // No SMTP in the environment and none saved in the app: the
    // production resolver then answers `unset`, which is what a
    // self-hosted install that has not been through the wizard looks
    // like.
    const previous = harness.smtpEnv;
    harness.smtpEnv = null;
    try {
      const contract = await newContract("Notify · no relay");
      await ask(contract.number, idOf(APPROVER));

      await settles("the skipped email", async () => {
        const rows = await rowsFor(APPROVER);
        return rows.some((row) => row.entityId === contract.id && row.emailSkippedAt !== null);
      });

      const row = (await rowsFor(APPROVER)).find((r) => r.entityId === contract.id);
      // The bell row is intact and unread: one channel is degraded, and
      // nothing is hidden.
      expect(row!.readAt).toBeNull();
      expect(row!.emailOwed).toBe(true);
      expect(row!.emailedAt).toBeNull();
      const page = await bell(APPROVER);
      expect(page.notifications.map((r) => r.entityId)).toContain(contract.id);

      // And the operator is told, in the pipeline's own log, that mail
      // is unconfigured rather than merely that something failed.
      const loud = harness.jobLog.filter(
        (line) => line.level === "error" && JSON.stringify(line).includes("unconfigured"),
      );
      expect(loud.length, JSON.stringify(harness.jobLog)).toBeGreaterThanOrEqual(1);

      // Terminal, not a retry: the skip settles the row, so a second
      // look finds no further attempt pending.
      expect(
        await harness.db
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.entityId, contract.id), eq(notifications.userId, idOf(APPROVER))),
          ),
      ).toHaveLength(1);
    } finally {
      harness.smtpEnv = previous;
    }
  });
});
