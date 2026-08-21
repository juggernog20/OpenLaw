// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-002's group 3 — the morning round and the digest (#321, M18/6) —
 * over the real-Postgres harness, the real pg-boss queue, and the real
 * notification seam.
 *
 * **The round is invoked in process, with a controlled tick.** The whole
 * of it is a function of the clock, so a suite that could not set the
 * clock could only assert it by waiting for a real morning. That is the
 * reconciliation suite's arrangement (#250) and the backfill suite's
 * before it: the handler is called directly, and the **scheduled shape**
 * — one schedule row, one singleton queue, a tick that runs a round — is
 * asserted separately against pg-boss's own tables.
 *
 * **Everything a person could observe is read the way they would read
 * it.** The bell items come back from `GET /api/v1/notifications`, the
 * briefings out of the harness's `CapturingMailer`, and the records are
 * made and edited over HTTP. Nothing asserts that the Notifier was
 * called or how the fan-out is wired.
 *
 * **The `notifications` table is read directly for two reasons only,**
 * and never where the seam can answer the question. "Nothing was
 * written" and "a row was written and the wall omitted it" are the same
 * empty bell (M10), so every case claiming a reminder told nobody has to
 * be able to tell them apart. And `email_owed` / `emailed_at` are
 * columns no endpoint exposes, which is what makes the lost-wake-up case
 * stageable at all.
 *
 * **Each block owns its own day.** A person gets one briefing per local
 * day (NOT-003), so two blocks sharing a date would have the second one
 * asserting against a gate the first one closed. The offsets match a
 * date exactly, so a contract made for one block is invisible to every
 * other block's round.
 */

import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  asc,
  contracts,
  contractStatuses,
  desc,
  eq,
  notifications,
  orgSettings,
  sql,
  users,
  type ContractStage,
  type Notification,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { JOB_QUEUES } from "../../pipeline/jobs.js";
import type { PipelineLogger } from "../../pipeline/logger.js";
import {
  runMorningRound,
  LOST_EMAIL_REASK_AFTER_MS,
  MORNING_ROUND_CRON,
  type MorningRoundSummary,
} from "../../pipeline/morning-round.js";
import { startPipeline } from "../../pipeline/pg-boss.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type JobLogLine,
  type TestHarness,
} from "../../testing/harness.js";

/** The person every record here belongs to. No profile timezone, which
 * is the state most people are in (SET-006) and which reads as UTC. */
const OWNER = {
  email: "dates-owner@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Member on no team: they reach every open record (CTR-021) and are
 * on none of them, so no date on any of them is about them. On a
 * confidential record they do not even reach it. */
const OUTSIDER = {
  email: "dates-outsider@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** Four hours ahead of UTC, and the subject of the timezone gate: their
 * morning arrives while UTC is still asleep. */
const EAST = {
  email: "dates-east@example.com",
  displayName: "Yusuf Haddad",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
const EAST_ZONE = "Asia/Dubai";

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
  entityId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
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

  for (const fixture of [OWNER, OUTSIDER, EAST] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({
        role: "legal_team_member",
        // The profile zone (SET-006). Only the eastern fixture sets one;
        // the rest are the NULL that reads as UTC.
        timezone: fixture === EAST ? EAST_ZONE : null,
      })
      .where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
});

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

/** A contract the Owner made, so they hold its `creator` team row and
 * every date on it is about them. */
async function newContract(
  title: string,
  term: Record<string, unknown> = {},
): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(OWNER),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  const contract = res.json().contract as ContractRow;
  if (Object.keys(term).length > 0) {
    const patched = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(OWNER),
      payload: term,
    });
    expect(patched.statusCode, patched.body).toBe(200);
  }
  return contract;
}

/** Puts a named date on a record (CTR-009), answering its row id. */
async function addKeyDate(number: number, date: string, label: string): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/key-dates`,
    cookies: as(OWNER),
    payload: { date, label },
  });
  expect(res.statusCode, res.body).toBe(201);
  const added = (
    res.json() as { deadlines: { keyDateId: string | null; date: string }[] }
  ).deadlines
    .filter((entry) => entry.keyDateId !== null && entry.date === date)
    .pop();
  expect(added, "the key date just added").toBeDefined();
  return added!.keyDateId!;
}

/** Moves a key date to another day. */
async function moveKeyDate(keyDateId: string, date: string): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/key-dates/${keyDateId}`,
    cookies: as(OWNER),
    payload: { date },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Puts somebody on a contract's team, which is what makes an open
 * record's dates about them and a confidential one reachable at all. */
async function addToTeam(number: number, userId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: as(OWNER),
    payload: { userId, role: "member" },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Moves a record onto the first live status at one stage — how a
 * contract really reaches the ended stage (CTR-019). */
async function moveTo(number: number, stage: ContractStage): Promise<void> {
  const [target] = await harness.db
    .select({ id: contractStatuses.id })
    .from(contractStatuses)
    .where(eq(contractStatuses.stage, stage))
    .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt));
  expect(target, `a live status at the ${stage} stage`).toBeDefined();
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: as(OWNER),
    payload: { statusId: target!.id },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Walls a record off straight in the column: making a record
 * confidential is not the subject of a reminders test. */
const wallOff = (contractId: string) =>
  harness.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contractId));

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

/** The items on one person's bell about one record, oldest first. */
async function bellFor(fixture: { email: string }, contract: ContractRow): Promise<BellItem[]> {
  const items = (await bell(fixture)).filter((row) => row.entityId === contract.id);
  return items.reverse();
}

/**
 * Every notification row one person holds, newest first.
 *
 * Read outside the HTTP seam only where the seam cannot answer: an empty
 * bell is both "nothing was written" and "a row was written and the wall
 * omitted it" (M10), and the email columns are exposed by no endpoint.
 */
const rowsFor = (fixture: { email: string }): Promise<Notification[]> =>
  harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));

/** Somewhere for one round's own lines to go. */
function recordingLog(): { lines: JobLogLine[]; log: PipelineLogger } {
  const lines: JobLogLine[] = [];
  return {
    lines,
    log: {
      info: (fields, message) => lines.push({ level: "info", message, fields }),
      warn: (fields, message) => lines.push({ level: "warn", message, fields }),
      error: (fields, message) => lines.push({ level: "error", message, fields }),
    },
  };
}

/** One round of the morning job, at a controlled instant. */
async function round(now: Date): Promise<{ summary: MorningRoundSummary; lines: JobLogLine[] }> {
  const { lines, log } = recordingLog();
  const summary = await runMorningRound(
    {
      db: harness.db,
      log,
      notifier: harness.notifier,
      resolveMailer: harness.resolveMailer,
      baseUrl: "http://localhost",
    },
    harness.pipeline,
    { now },
  );
  return { summary, lines };
}

/** The briefings one person has been sent, oldest first. The subject is
 * the whole test: no other message in this system carries it. */
const digestsTo = (fixture: { email: string }) =>
  harness.mailer.messagesTo(fixture.email).filter((m) => /on your contracts$/.test(m.subject));

/** The most recent briefing one person was sent, requiring one. */
function lastDigestTo(fixture: { email: string }) {
  const sent = digestsTo(fixture);
  expect(sent.length, `a briefing to ${fixture.email}`).toBeGreaterThan(0);
  return sent[sent.length - 1]!;
}

/** A civil date shifted by whole days — how each block names the dates
 * its offsets will land on. */
function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The instant one civil date reaches a given UTC hour. */
const at = (date: string, hour: number): Date =>
  new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);

/** How long the queue is given before the suite calls it stuck. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Waits for a condition the pipeline is expected to bring about. */
async function settles(what: string, ready: () => Promise<boolean> | boolean): Promise<void> {
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

// -------------------------------------------------------------------

describe("a notice deadline at a seeded offset", () => {
  const TODAY = "2026-03-12";
  let contract: ContractRow;
  let summary: MorningRoundSummary;

  beforeAll(async () => {
    // The expiry is 14 days out and the notice period is 7, so the
    // notice deadline is exactly 7 days away — the first seeded offset.
    // The expiry itself is 14 days away, which no offset names, so this
    // record has exactly one date due today.
    contract = await newContract("Meridian Bio supply agreement", {
      expiryDate: plusDays(TODAY, 14),
      noticePeriodDays: 7,
    });
    summary = (await round(at(TODAY, 8))).summary;
  });

  it("rings the Owner's bell once, for the deadline and not the expiry", async () => {
    const items = await bellFor(OWNER, contract);
    expect(items.map((row) => row.eventType)).toEqual(["date.notice_deadline_approaching"]);
    expect(items[0]!.readAt).toBeNull();
    expect(items[0]!.payload.contractNumber).toBe(contract.number);
    expect(items[0]!.payload.contractTitle).toBe(contract.title);
    expect(items[0]!.payload.reminderDate).toBe(plusDays(TODAY, 7));
    expect(items[0]!.payload.offsetDays).toBe(7);
    // A date arriving is nobody's act, so nobody is excluded and the
    // item names no actor.
    expect(items[0]!.payload.actorName).toBeNull();
  });

  it("sends one briefing, ordered outward from today and deep-linked", () => {
    expect(summary.reminders).toBe(1);
    expect(summary.digests).toBe(1);
    const sent = lastDigestTo(OWNER);
    expect(sent.subject).toBe("1 date on your contracts");
    expect(sent.text).toContain(OWNER.displayName);
    expect(sent.text).toContain("In 7 days");
    expect(sent.text).toContain("Notice deadline");
    expect(sent.text).toContain(contract.title);
    // DES-049 clause 9: a date's address is the record's Key dates
    // section, not the record's front page.
    expect(sent.text).toContain(`http://localhost/contracts/${contract.number}/key-dates`);
    // The way out, on the channel where the reader is not in the app.
    expect(sent.text).toContain("http://localhost/settings/notifications");
  });

  it("tells a Member who is not on the record nothing about it", async () => {
    // They reach the record (CTR-021) and are on nobody's team, so it is
    // not about them. Read from the table, because an empty bell would
    // also be what a walled-off record looks like.
    expect((await rowsFor(OUTSIDER)).filter((row) => row.entityId === contract.id)).toEqual([]);
  });
});

describe("a second round on the same tick", () => {
  const TODAY = "2026-04-14";
  let contract: ContractRow;

  beforeAll(async () => {
    contract = await newContract("Orion Cloud reseller agreement", {
      expiryDate: plusDays(TODAY, 1),
    });
    await round(at(TODAY, 8));
  });

  it("writes nothing new and sends nothing more", async () => {
    const before = await bellFor(OWNER, contract);
    expect(before.map((row) => row.eventType)).toEqual(["date.expiry_approaching"]);
    const briefings = digestsTo(OWNER).length;

    const second = await round(at(TODAY, 9));
    // The dedup identity held: the same person, event, record, date, and
    // offset is the same reminder.
    expect(second.summary.reminders).toBe(0);
    // And one person gets one briefing a day, whatever the hour.
    expect(second.summary.digests).toBe(0);

    expect(await bellFor(OWNER, contract)).toHaveLength(1);
    expect(digestsTo(OWNER)).toHaveLength(briefings);
  });
});

describe("a date that moves, and a contract that ends", () => {
  const TODAY = "2026-05-13";
  let moving: ContractRow;
  let ending: ContractRow;
  let keyDateId: string;

  beforeAll(async () => {
    moving = await newContract("Halcyon licence agreement");
    keyDateId = await addKeyDate(moving.number, plusDays(TODAY, 1), "Price review");
    ending = await newContract("Sable Trading master agreement");
    await addKeyDate(ending.number, plusDays(TODAY, 1), "Option window");
    // A dead deal (CTR-019), reached the way a person reaches it.
    await moveTo(ending.number, "ended");
    await round(at(TODAY, 8));
  });

  it("fires again at the new value, and leaves the old reminder standing", async () => {
    const first = await bellFor(OWNER, moving);
    expect(first.map((row) => row.payload.reminderDate)).toEqual([plusDays(TODAY, 1)]);

    // Somebody brings the review forward a day. The date's value is half
    // the dedup identity, so the new value is a new reminder.
    await moveKeyDate(keyDateId, TODAY);
    const again = await round(at(TODAY, 10));
    expect(again.summary.reminders).toBe(1);

    const items = await bellFor(OWNER, moving);
    expect(items.map((row) => row.payload.reminderDate)).toEqual([plusDays(TODAY, 1), TODAY]);
    expect(items.map((row) => row.payload.offsetDays)).toEqual([1, 0]);
    // The reminder that already went is history, not a mistake: it said
    // what was true when it fired.
    expect(items.every((row) => row.eventType === "date.key_date_approaching")).toBe(true);
  });

  it("says nothing at all about an ended contract", async () => {
    expect((await rowsFor(OWNER)).filter((row) => row.entityId === ending.id)).toEqual([]);
  });
});

describe("entity_type is part of the dedup identity", () => {
  it("two entity types sharing an id string produce two rows", async () => {
    const shared = { reminderDate: "2026-07-01", reminderOffsetDays: 7 };
    const base = {
      userId: idOf(OWNER),
      eventType: "date.key_date_approaching" as const,
      entityId: "same-id",
      payload: {},
      emailOwed: false,
      ...shared,
    };
    await harness.db
      .insert(notifications)
      .values([
        { ...base, entityType: "contract" as const },
        { ...base, entityType: "matter" as const },
      ])
      .onConflictDoNothing({
        target: [
          notifications.userId,
          notifications.eventType,
          notifications.entityType,
          notifications.entityId,
          notifications.reminderDate,
          notifications.reminderOffsetDays,
        ],
        where: sql`reminder_date is not null`,
      });
    const rows = await harness.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, idOf(OWNER)), eq(notifications.entityId, "same-id")));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.entityType).sort()).toEqual(["contract", "matter"]);
  });
});

describe("the timezone gate", () => {
  const TODAY = "2026-06-10";
  let contract: ContractRow;

  beforeAll(async () => {
    contract = await newContract("Caledon distribution agreement", {
      expiryDate: plusDays(TODAY, 7),
    });
    await addToTeam(contract.number, idOf(EAST));
  });

  it("serves the person whose morning has arrived, and nobody else", async () => {
    const before = digestsTo(OWNER).length;
    // 05:00 UTC is 09:00 in Dubai and five in the morning here. One of
    // these two people has had their coffee.
    const early = await round(at(TODAY, 5));
    expect(early.summary.served).toBe(1);

    const east = await bellFor(EAST, contract);
    expect(east.map((row) => row.eventType)).toEqual(["date.expiry_approaching"]);
    expect(digestsTo(EAST)).toHaveLength(1);

    // Not "an empty bell": no row exists for the Owner yet at all.
    expect((await rowsFor(OWNER)).filter((row) => row.entityId === contract.id)).toEqual([]);
    expect(digestsTo(OWNER)).toHaveLength(before);
  });

  it("serves them when their own morning arrives, on the same date", async () => {
    const before = digestsTo(OWNER).length;
    const later = await round(at(TODAY, 8));
    expect(later.summary.digests).toBe(1);

    expect((await bellFor(OWNER, contract)).map((row) => row.eventType)).toEqual([
      "date.expiry_approaching",
    ]);
    expect(digestsTo(OWNER)).toHaveLength(before + 1);
    // The person already served this morning is not served twice: their
    // local date has not changed.
    expect(digestsTo(EAST)).toHaveLength(1);
  });
});

describe("the offset list", () => {
  const TODAY = "2026-07-08";
  let near: ContractRow;
  let far: ContractRow;

  beforeAll(async () => {
    near = await newContract("Northwind services agreement", { expiryDate: plusDays(TODAY, 3) });
    far = await newContract("Vantage facilities agreement", { expiryDate: plusDays(TODAY, 7) });
  });

  afterAll(async () => {
    // Every block after this one reads the seeded list.
    await harness.db.update(orgSettings).set({ reminderOffsetDays: [7, 1, 0] });
  });

  it("is read live, so changing it changes the next round", async () => {
    // As it stands, seven days ahead is a reminder and three days ahead
    // is not.
    const seeded = await round(at(TODAY, 8));
    expect(seeded.summary.reminders).toBe(1);
    expect(seeded.summary.digests).toBe(1);
    expect((await bellFor(OWNER, far)).map((row) => row.payload.offsetDays)).toEqual([7]);
    expect(await bellFor(OWNER, near)).toEqual([]);

    // An Administrator decides the team works three days ahead. Written
    // in the column, because the pane that edits it is its own slice
    // (#322) — what is under test here is that the round reads it.
    await harness.db.update(orgSettings).set({ reminderOffsetDays: [3] });

    const changed = await round(at(TODAY, 10));
    // Same day, same records, different list: the near record's expiry
    // is three days away, and three days is now a lead time.
    expect(changed.summary.reminders).toBe(1);
    expect((await bellFor(OWNER, near)).map((row) => row.payload.offsetDays)).toEqual([3]);
    // And nothing more about the far one: seven no longer is.
    expect(await bellFor(OWNER, far)).toHaveLength(1);
  });

  it("carries a reminder that missed its briefing into the next one", async () => {
    // The reminder above was written after this person's one briefing
    // for the day had gone (NOT-003), so it is still owed. Nothing is
    // lost by that: the row is the record of the work, and the next
    // morning's briefing carries it.
    const before = digestsTo(OWNER).length;
    const next = await round(at(plusDays(TODAY, 1), 8));
    expect(next.summary.reminders).toBe(0);
    expect(next.summary.digests).toBe(1);

    const sent = digestsTo(OWNER);
    expect(sent).toHaveLength(before + 1);
    expect(sent[sent.length - 1]!.text).toContain(near.title);
    // Counted against today rather than against the offset it fired at:
    // the date is two days away by the time the briefing goes.
    expect(sent[sent.length - 1]!.text).toContain("In 2 days");
  });
});

describe("a confidential record's dates", () => {
  const TODAY = "2026-08-12";
  let contract: ContractRow;

  beforeAll(async () => {
    contract = await newContract("Ridgeline retainer", { expiryDate: TODAY });
    await wallOff(contract.id);
    await round(at(TODAY, 8));
  });

  it("reaches the record's own audience", async () => {
    const items = await bellFor(OWNER, contract);
    expect(items.map((row) => row.eventType)).toEqual(["date.expiry_approaching"]);
    const sent = lastDigestTo(OWNER);
    expect(sent.text).toContain(contract.title);
    expect(sent.text).toContain("Today");
  });

  it("carries no row a reader outside that audience could open", async () => {
    // A Legal Team Member outside a confidential record's team does not
    // reach it (DD-014), so no row was ever written — and the title
    // never left the building in their briefing either.
    expect((await rowsFor(OUTSIDER)).filter((row) => row.entityId === contract.id)).toEqual([]);
    expect(digestsTo(OUTSIDER).some((m) => m.text.includes(contract.title))).toBe(false);
  });
});

describe("an immediate email whose wake-up was lost", () => {
  const TODAY = "2026-09-09";
  let contract: ContractRow;

  beforeAll(async () => {
    contract = await newContract("Fairhaven consultancy agreement");
  });

  it("is re-asked from the row and delivered", async () => {
    // A real group-1 event, over HTTP: the record is handed to somebody.
    const handed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(OWNER),
      payload: { managerId: idOf(OUTSIDER) },
    });
    expect(handed.statusCode, handed.body).toBe(200);
    await settles("the hand-over email", () =>
      harness.mailer.messagesTo(OUTSIDER.email).some((m) => m.text.includes(contract.title)),
    );
    const delivered = harness.mailer
      .messagesTo(OUTSIDER.email)
      .filter((m) => m.text.includes(contract.title)).length;

    // Staged, in the two columns no endpoint exposes: the row still owes
    // an email, nothing was ever recorded against it, and it is old
    // enough that no attempt can still be in flight. That is exactly
    // what a wake-up lost between the commit and the queue leaves behind.
    const [row] = await harness.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, idOf(OUTSIDER)),
          eq(notifications.entityId, contract.id),
          eq(notifications.eventType, "contract.owner_assigned"),
        ),
      );
    expect(row, "the hand-over's own notification row").toBeDefined();
    await harness.db
      .update(notifications)
      .set({
        emailedAt: null,
        createdAt: new Date(Date.now() - LOST_EMAIL_REASK_AFTER_MS - 60_000),
      })
      .where(eq(notifications.id, row!.id));

    const { summary } = await round(at(TODAY, 8));
    expect(summary.reasked).toBeGreaterThanOrEqual(1);

    // The message goes a second time, because the row said it was still
    // owed. A lost wake-up costs a delay, never the message.
    await settles(
      "the re-asked hand-over email",
      () =>
        harness.mailer.messagesTo(OUTSIDER.email).filter((m) => m.text.includes(contract.title))
          .length > delivered,
    );
    const [settled] = await harness.db
      .select({ emailedAt: notifications.emailedAt })
      .from(notifications)
      .where(eq(notifications.id, row!.id));
    expect(settled!.emailedAt).not.toBeNull();
  });
});

/**
 * The round repeats, so it is on pg-boss's clock rather than on a timer
 * in the worker — the boot-versus-schedule rule (#277). Two things
 * follow and are asserted here rather than argued: **an install has one
 * schedule however many workers it runs**, and **a tick runs a round**.
 */
describe("the scheduled shape", () => {
  it("leaves one schedule and one singleton queue however many workers boot", async () => {
    // A second worker against the same database — a replica, which is
    // the whole subject. `startPipeline` is what declares the schedule,
    // so booting it twice is the experiment.
    const second = await startPipeline({
      connectionString: harness.databaseUrl,
      handlers: {
        db: harness.db,
        storage: harness.storage,
        docEngine: harness.docEngine,
        resolveSigningProvider: harness.resolveSigningProvider,
        resolveMailer: harness.resolveMailer,
        baseUrl: "http://localhost",
        log: recordingLog().log,
      },
      log: recordingLog().log,
    });
    try {
      // pg-boss's own tables are the assertion. The schedule is an
      // upsert keyed on the queue name, so two workers declaring it
      // leave one row — which is what makes the cron election produce
      // one round rather than one per replica.
      const schedules = await harness.db.execute<{ name: string; cron: string }>(
        sql`select name, cron from pgboss.schedule where name = ${JOB_QUEUES.morningRound}`,
      );
      expect(schedules.rows).toHaveLength(1);
      expect(schedules.rows[0]?.cron).toBe(MORNING_ROUND_CRON);

      // Singleton, so a tick landing while a round is still running
      // waits for it rather than joining it. Two rounds at once would be
      // two briefings for one person on one day.
      const queues = await harness.db.execute<{ policy: string }>(
        sql`select policy from pgboss.queue where name = ${JOB_QUEUES.morningRound}`,
      );
      expect(queues.rows[0]?.policy).toBe("singleton");
    } finally {
      await second.stop();
    }
  });

  it("runs a round when a tick reaches the handler", async () => {
    // The cron is hourly, which no suite may wait for. What is asserted
    // is the handler the tick reaches: a job on the queue runs a real
    // round, through the production registration and not a double.
    const boss = new PgBoss({ connectionString: harness.databaseUrl });
    try {
      await boss.start();
      await boss.send(JOB_QUEUES.morningRound, {});
    } finally {
      await boss.stop();
    }
    await settles("the scheduled round", () =>
      harness.jobLog.some((line) => line.message === "the scheduled morning round finished"),
    );
  });
});
