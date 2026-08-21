// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-002's group 5 (#382, M20/8) at the HTTP seam, over the real-Postgres
 * harness, the real pg-boss queue, and the harness's capturing mailer.
 *
 * **Nothing here looks at the Notifier.** Each case performs the real act
 * over HTTP — submits a Request (INT-001), replies on its thread
 * (INT-007), switches a channel off on the preferences pane (NOT-001) —
 * and then asserts what a person can observe: the rows their portal bell
 * is backed by, and the mail the harness caught. No test asserts that the
 * seam was called or how the fan-out is wired.
 *
 * **The rows are read from the table rather than from `GET
 * /notifications`, and that is the one deliberate exception to the rule
 * above.** That endpoint is the **staff** notification centre, whose
 * predicate answers about contracts alone; group 5's surface is the
 * **portal** bell (NOT-001), which is its own slice of M20. So this suite
 * reads the rows the way the send job does — and every claim it makes
 * about email is made against the captured mailer, which is the seam a
 * requester actually experiences.
 *
 * What it pins is the four events and the three rules that shape them:
 *
 * - **The receipt is the one event addressed to its actor** (INT-001). A
 *   receipt addressed to nobody is not a receipt.
 * - **Every other group-5 event excludes its actor**, which is what makes
 *   a staff reply reach the Requester and not the poster, and a
 *   requester's own reply reach nobody.
 * - **A Requester is in one room** (DD-016), so a Legal Only or Working
 *   Team comment raises nothing at them at all.
 *
 * The two events with no caller in this milestone — the status change and
 * the decline (M21's disposition routes) — are exercised through the seam
 * itself, because there is no route to press. That is what "the catalog is
 * complete before the Inbox lands" has to mean: the copy exists, the rows
 * are written, and M21 adds a call rather than a mechanism.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, notifications, users, type Notification } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import type { NotifyingTransaction } from "../../lib/notifications/notifier.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who asks. Every Request here is theirs. */
const REQUESTER = {
  email: "priya.raman@acme.com",
  displayName: "Priya Raman",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A second requester, who turns group 5 email off. */
const QUIET = {
  email: "sam.dube@acme.com",
  displayName: "Sam Dube",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** Legal, who answers on the thread. */
const STAFF = {
  email: "legal@example.com",
  displayName: "Rita Okonjo",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();
/** The seeded "Contract review" front door, which every Request here is
 * submitted through. */
let contractReviewTypeId: string;

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

/** One Request, as this suite refers to it afterwards. */
interface RequestRow {
  id: string;
  number: number;
  summary: string;
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

  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [QUIET, "business_user"],
    [STAFF, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: as(ADMIN),
  });
  expect(types.statusCode, types.body).toBe(200);
  const found = (types.json().requestTypes as { slug: string; id: string }[]).find(
    (row) => row.slug === "contract_review",
  );
  expect(found, "the contract_review seed type").toBeDefined();
  contractReviewTypeId = found!.id;
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** Submits a Request through the portal form, as a requester does. */
async function submit(fixture: { email: string }, summary: string): Promise<RequestRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: as(fixture),
    payload: {
      requestTypeId: contractReviewTypeId,
      summary,
      description: "They sent a redline on the liability cap.",
      urgency: "high",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const row = res.json().request as RequestRow;
  return { id: row.id, number: row.number, summary: row.summary };
}

/** Posts one comment on a Request's thread, at a tier. */
async function reply(
  fixture: { email: string },
  request: RequestRow,
  body: string,
  visibility: "full_thread" | "working_team" | "legal_only" = "full_thread",
): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(fixture),
    payload: { entityType: "request", entityId: request.id, body, visibility },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/**
 * Every notification row one person holds, newest first.
 *
 * The portal bell is its own slice, so the rows are read here rather
 * than through the staff centre — see the file header. Reading them
 * directly is also what lets a case tell "nothing was written" from "a
 * row was written and something omitted it", which every claim that an
 * event told nobody has to be able to do.
 */
const rowsFor = (fixture: { email: string }): Promise<Notification[]> =>
  harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));

/** The rows one person holds about one Request. */
const rowsAbout = async (
  fixture: { email: string },
  request: RequestRow,
): Promise<Notification[]> =>
  (await rowsFor(fixture)).filter(
    (row) => row.entityType === "request" && row.entityId === request.id,
  );

/** How long the email is given before the suite calls the queue stuck.
 * The mailer is a capture, so this is slack for pg-boss, not for SMTP. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Waits for a condition the pipeline is expected to bring about. */
async function settles(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${what} did not settle within ${SETTLE_TIMEOUT_MS}ms\n` +
      JSON.stringify(harness.jobLog, null, 2),
  );
}

/** The messages this person has been sent about this Request, by its
 * R-### reference — which every group-5 subject line carries as
 * `R-### · summary`. The separator is part of the match, because `R-1`
 * is a prefix of `R-10` and this suite mints numbers past nine. */
const mailAbout = (fixture: { email: string }, request: RequestRow) =>
  harness.mailer
    .messagesTo(fixture.email)
    .filter((m) => m.subject.includes(`R-${request.number} ·`));

/** The one message an event has just sent about a Request, once the
 * queue has delivered it. */
async function oneMailAbout(fixture: { email: string }, request: RequestRow, subject: string) {
  await settles(`the email to ${fixture.email} about R-${request.number}`, () =>
    mailAbout(fixture, request).some((m) => m.subject.includes(subject)),
  );
  const message = mailAbout(fixture, request).find((m) => m.subject.includes(subject));
  expect(message).toBeDefined();
  return message!;
}

/** The portal address every group-5 message deep-links to. */
const portalLink = (request: RequestRow) => `http://localhost/portal/requests/${request.number}`;

/** Runs one event through the seam itself, for the two the Inbox has not
 * arrived to fire yet. `notifying` is what mints the transaction the
 * methods take, so this is the same commit-then-queue path a route
 * takes — only without a route to press. */
const raise = (work: (tx: NotifyingTransaction) => Promise<unknown>) =>
  harness.app.notifier.notifying(work);

describe("submitting a Request (INT-001)", () => {
  it("writes the requester a receipt and mails it with a portal deep link", async () => {
    const request = await submit(REQUESTER, "Review the Northwind supply redline");

    // The row is written inside the submission's own transaction, so it
    // is there the moment the 201 lands — nothing to wait for.
    const rows = await rowsAbout(REQUESTER, request);
    expect(rows.map((row) => row.eventType)).toEqual(["request.created"]);
    expect(rows[0]!.readAt).toBeNull();
    expect(rows[0]!.emailOwed).toBe(true);
    expect(rows[0]!.payload.requestNumber).toBe(request.number);
    expect(rows[0]!.payload.requestSummary).toBe(request.summary);
    expect(rows[0]!.payload.actorName).toBe(REQUESTER.displayName);

    // The email is the queue's, so this is the one thing to wait for. It
    // deep-links into the portal, not into the staff application.
    const message = await oneMailAbout(REQUESTER, request, "We have your request");
    expect(message.text).toContain(portalLink(request));
    expect(message.text).toContain(request.summary);
    expect(message.text).toContain(REQUESTER.displayName);
  });

  it("tells nobody else, including the staff who will triage it", async () => {
    const request = await submit(REQUESTER, "Review the Contoso NDA");
    expect(await rowsAbout(STAFF, request)).toEqual([]);
    expect(mailAbout(STAFF, request)).toEqual([]);
  });

  it("gives a Member+ who submits one the same receipt", async () => {
    // Staff ask legal questions too (user story 7), and on this surface
    // they are a Requester like anybody else. The receipt exception is
    // about the act, not about the role.
    const request = await submit(STAFF, "Review our own vendor paper");
    const rows = await rowsAbout(STAFF, request);
    expect(rows.map((row) => row.eventType)).toEqual(["request.created"]);
    await oneMailAbout(STAFF, request, "We have your request");
  });
});

describe("a reply on the thread (INT-007)", () => {
  it("reaches the Requester at Full Thread and never the staff poster", async () => {
    const request = await submit(REQUESTER, "Review the Aperture MSA");
    await reply(STAFF, request, "Can you send the counterparty's paper?");

    const rows = await rowsAbout(REQUESTER, request);
    expect(rows.map((row) => row.eventType)).toEqual(["request.replied", "request.created"]);
    expect(rows[0]!.emailOwed).toBe(true);
    expect(rows[0]!.payload.actorName).toBe(STAFF.displayName);

    const message = await oneMailAbout(REQUESTER, request, "Legal replied");
    expect(message.text).toContain(STAFF.displayName);
    expect(message.text).toContain(portalLink(request));
    // The words stay on the thread (CMT-006, DD-016).
    expect(message.text).not.toContain("counterparty's paper");

    // The actor exclusion, from the other end: the person who wrote it
    // hears nothing about having written it.
    expect(await rowsAbout(STAFF, request)).toEqual([]);
    expect(mailAbout(STAFF, request)).toEqual([]);
  });

  it("raises nothing at the requester from a Legal Only or Working Team comment", async () => {
    const request = await submit(REQUESTER, "Review the Initech order form");
    const before = (await rowsAbout(REQUESTER, request)).length;
    await reply(STAFF, request, "Their indemnity is unusual.", "legal_only");
    await reply(STAFF, request, "Chasing the business owner.", "working_team");

    // A Requester is in one room (DD-016), so neither of those was said
    // anywhere they can hear. The row is the whole claim: the email is
    // hung off the row it would have been written on, so no row is no
    // message — there is no state where one leaves without the other.
    expect(await rowsAbout(REQUESTER, request)).toHaveLength(before);
  });

  it("raises nothing when the requester replies themselves", async () => {
    const request = await submit(REQUESTER, "Review the Umbrella DPA");
    const before = (await rowsAbout(REQUESTER, request)).length;
    await reply(REQUESTER, request, "Adding the counterparty's redline.");

    expect(await rowsAbout(REQUESTER, request)).toHaveLength(before);
    // And it does not reach staff either: what tells the staff side that
    // a Request wants attention is group 4, the Inbox's own group.
    expect(await rowsAbout(STAFF, request)).toEqual([]);
  });
});

describe("a requester who has switched group 5 email off (NOT-001)", () => {
  it("keeps the bell row and is owed no email", async () => {
    const saved = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      cookies: as(QUIET),
      payload: { eventGroup: "requester_events", channel: "email", enabled: false },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const request = await submit(QUIET, "Review the Stark licensing terms");
    const rows = await rowsAbout(QUIET, request);
    expect(rows.map((row) => row.eventType)).toEqual(["request.created"]);
    // Never owed, rather than owed and unsent: the difference is what
    // lets the morning round re-ask for lost mail without writing to
    // everybody who turned it off (NOT-001's M18/1 refinement).
    expect(rows[0]!.emailOwed).toBe(false);
    expect(rows[0]!.emailedAt).toBeNull();
    expect(rows[0]!.emailSkippedAt).toBeNull();

    // A staff reply lands the same way: the bell row, and no message.
    await reply(STAFF, request, "Looking at it now.");
    expect((await rowsAbout(QUIET, request)).map((row) => row.eventType)).toEqual([
      "request.replied",
      "request.created",
    ]);
    expect(mailAbout(QUIET, request)).toEqual([]);
  });
});

describe("the two events the Inbox will fire (INT-006, INT-007)", () => {
  it("tells the requester their Request has moved", async () => {
    const request = await submit(REQUESTER, "Review the Wayne services agreement");
    await raise((tx) =>
      harness.app.notifier.requestStatusChanged(tx, {
        requestId: request.id,
        actorId: idOf(STAFF),
        actorName: STAFF.displayName,
        from: "new",
        to: "resolved",
      }),
    );

    const rows = await rowsAbout(REQUESTER, request);
    expect(rows.map((row) => row.eventType)).toEqual(["request.status_changed", "request.created"]);
    expect(rows[0]!.payload.from).toBe("new");
    expect(rows[0]!.payload.to).toBe("resolved");

    const message = await oneMailAbout(REQUESTER, request, "Your request is resolved");
    expect(message.text).toContain(portalLink(request));
  });

  it("tells the requester why their Request was declined", async () => {
    const request = await submit(REQUESTER, "Review the Cyberdyne research pact");
    await raise((tx) =>
      harness.app.notifier.requestDeclined(tx, {
        requestId: request.id,
        actorId: idOf(STAFF),
        actorName: STAFF.displayName,
        reason: "This one goes to Procurement, not to Legal.",
      }),
    );

    const rows = await rowsAbout(REQUESTER, request);
    expect(rows.map((row) => row.eventType)).toEqual(["request.declined", "request.created"]);

    // INT-006: "no" arrives with a why, so the reason is in the message
    // rather than a line about a reason.
    const message = await oneMailAbout(REQUESTER, request, "Your request was declined");
    expect(message.text).toContain("This one goes to Procurement, not to Legal.");
    expect(message.text).toContain(portalLink(request));
  });

  it("tells the person who dispositioned it nothing about their own act", async () => {
    // Every group-5 event but the receipt excludes its actor. Staff will
    // rarely be the Requester too, so this is the case that proves the
    // exception did not leak into the other three methods.
    const request = await submit(STAFF, "Our own renewal, self-served");
    await raise((tx) =>
      harness.app.notifier.requestStatusChanged(tx, {
        requestId: request.id,
        actorId: idOf(STAFF),
        actorName: STAFF.displayName,
        from: "new",
        to: "converted",
      }),
    );
    expect((await rowsAbout(STAFF, request)).map((row) => row.eventType)).toEqual([
      "request.created",
    ]);
  });
});
