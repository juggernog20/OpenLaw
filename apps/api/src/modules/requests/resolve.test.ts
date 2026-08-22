// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolve (#419): the disposition that answers in the thread and closes
 * — asserted at the HTTP seam the screen presses.
 *
 * The subject is Resolve's own two halves and what separates them. The
 * **closing reply** is optional, and when it is given it is an ordinary
 * Full Thread comment: it is on the thread the next read answers, it
 * narrates as `comment.posted`, and it reaches the requester as a reply.
 * The **closure** moves the Request to `resolved`, narrates
 * `request.resolved` with its actor, and raises `requestStatusChanged` —
 * the event's first caller. Both may reach the requester, which is what
 * makes Resolve different from Decline.
 *
 * The scaffold itself — the row lock, the `new` guard, the recorded
 * outcome the loser is answered — is `decline.test.ts`'s subject and is
 * not re-proved here. What this suite asks of it is that Resolve rides
 * it: that a decided Request refuses, that the loser of a race is told
 * the outcome, and that a refused resolution writes no comment.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  comments,
  eq,
  notifications,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery",
} as const;

const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

const OTHER_MEMBER = {
  email: "other.member@example.com",
  displayName: "Priya Rao",
  password: "correct-horse-battery",
} as const;

const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let otherMemberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let requesterId: string;
let memberId: string;
let ndaTypeId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [MEMBER, "legal_team_member"],
    [OTHER_MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === REQUESTER) requesterId = user.id;
    if (fixture === MEMBER) memberId = user.id;
  }

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
  otherMemberCookies = await harnessSignInCookies(
    harness.app,
    OTHER_MEMBER.email,
    OTHER_MEMBER.password,
  );
  contributorCookies = await harnessSignInCookies(
    harness.app,
    CONTRIBUTOR.email,
    CONTRIBUTOR.password,
  );
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);

  const [type] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"))
    .limit(1);
  ndaTypeId = type!.id;
});

afterAll(async () => {
  await harness.stop();
});

/** Submits one Request as the Business User, and answers the row. */
async function submit(summary: string): Promise<{ id: string; number: number }> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId: ndaTypeId,
      summary,
      description: "For the pilot kicking off next month.",
      urgency: "high",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}

/** Presses Resolve on one Request, with or without a closing reply. */
function resolve(number: number, reply?: string, cookies = memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/resolve`,
    cookies,
    payload: reply === undefined ? {} : { reply },
  });
}

/** The stored row, for the facts the wire does not state. */
async function stored(id: string) {
  const [row] = await harness.db.select().from(requests).where(eq(requests.id, id)).limit(1);
  return row!;
}

/** Every entry on one Request, oldest first. */
async function entriesOn(id: string) {
  return harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, "request"), eq(activityLog.entityId, id)))
    .orderBy(activityLog.createdAt, activityLog.id);
}

/** Every comment on one Request's thread, oldest first. */
async function commentsOn(id: string) {
  return harness.db
    .select()
    .from(comments)
    .where(and(eq(comments.entityType, "request"), eq(comments.entityId, id)))
    .orderBy(comments.createdAt, comments.id);
}

/** Every bell row one person holds about one Request. */
async function bellRowsOn(userId: string, requestId: string) {
  return harness.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.entityType, "request"),
        eq(notifications.entityId, requestId),
      ),
    );
}

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
  throw new Error(`${what} did not settle within ${SETTLE_TIMEOUT_MS}ms`);
}

/** The messages one person has been sent about one Request, by its
 * R-### reference — which every group-5 subject line carries as
 * `R-### · summary`. The separator is part of the match, because `R-1`
 * is a prefix of `R-10`. */
const mailAbout = (email: string, number: number) =>
  harness.mailer.messagesTo(email).filter((m) => m.subject.includes(`R-${number} ·`));

describe("who may resolve (INT-006, DD-013)", () => {
  it("answers an Administrator and a Legal Team Member", async () => {
    for (const cookies of [adminCookies, memberCookies]) {
      const request = await submit("Whoever triages may resolve");
      const res = await resolve(request.number, undefined, cookies);
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it("refuses a Contributor and a Business User with 403", async () => {
    // The Business User here is the Requester themselves: closing their
    // own ask is triage's act, and triage is legal's.
    const request = await submit("Not theirs to close");
    for (const cookies of [contributorCookies, requesterCookies]) {
      const res = await resolve(request.number, "All done.", cookies);
      expect(res.statusCode, res.body).toBe(403);
    }
    expect((await stored(request.id)).status).toBe("new");
  });

  it("refuses a caller with no session", async () => {
    const request = await submit("Needs a session");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/resolve`,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("answers 404 for a reference nobody has", async () => {
    const res = await resolve(9_999_999);
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("what a resolution writes (INT-007)", () => {
  it("moves the Request to resolved and answers the staff envelope", async () => {
    const request = await submit("Answered on the thread");
    const res = await resolve(request.number, "The template is on the wiki — link on the thread.");
    expect(res.statusCode, res.body).toBe(200);

    const answered = res.json().request;
    expect(answered.number).toBe(request.number);
    expect(answered.status).toBe("resolved");
    // A resolution is not a decline, and it borrows none of its columns.
    expect(answered.declinedReason).toBeNull();
    expect(answered.convertedContract).toBeNull();
    // The whole envelope, so the screen paints the outcome from the
    // write's own reply rather than from a second read.
    expect(answered.requester.email).toBe(REQUESTER.email);
    expect(answered.requestType.displayName).toBeTruthy();

    const row = await stored(request.id);
    expect(row.status).toBe("resolved");
    expect(row.declinedReason).toBeNull();
    expect(row.convertedContractId).toBeNull();
  });

  it("narrates request.resolved with the actor, and carries no words in the payload", async () => {
    const request = await submit("Narrate who closed it");
    expect((await resolve(request.number, "Nothing to paper here.")).statusCode).toBe(200);

    const entries = await entriesOn(request.id);
    // The reply is narrated as the comment it is, and the closure as the
    // closure it is — in the order they happened.
    expect(entries.map((row) => row.action)).toEqual([
      "request.created",
      "comment.posted",
      "request.resolved",
    ]);
    const resolved = entries[2]!;
    // INT-007: who dispositioned a Request is audit data, and it is the
    // actor on the row rather than a column on the Request.
    expect(resolved.actorId).toBe(memberId);
    // The log is append-only (DD-017), so what was said stays on the
    // thread where a redact can still reach it (CMT-008).
    expect(resolved.payload).toEqual({ number: request.number });
  });

  it("narrates the closure alone when no reply was written", async () => {
    const request = await submit("The answer was already on the thread");
    expect((await resolve(request.number)).statusCode).toBe(200);

    const entries = await entriesOn(request.id);
    expect(entries.map((row) => row.action)).toEqual(["request.created", "request.resolved"]);
    expect((await stored(request.id)).status).toBe("resolved");
  });

  it("shows the Request under the triaged toggle and takes it out of the queue", async () => {
    const request = await submit("Leaves the undecided queue");
    expect((await resolve(request.number)).statusCode).toBe(200);

    const queue = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests",
      cookies: memberCookies,
    });
    expect(queue.statusCode, queue.body).toBe(200);
    expect(
      (queue.json().requests as { number: number }[]).some((row) => row.number === request.number),
    ).toBe(false);

    const triaged = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests?includeTriaged=true",
      cookies: memberCookies,
    });
    expect(triaged.statusCode, triaged.body).toBe(200);
    const row = (triaged.json().requests as { number: number; status: string }[]).find(
      (candidate) => candidate.number === request.number,
    );
    expect(row?.status).toBe("resolved");
  });

  it("reads Resolved on the requester's own window", async () => {
    const request = await submit("The portal reads the resolution");
    expect((await resolve(request.number, "Sorted — see the thread.")).statusCode).toBe(200);

    const mine = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: requesterCookies,
    });
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().request.status).toBe("resolved");
    expect(mine.json().request.declinedReason).toBeNull();
  });
});

describe("the closing reply (INT-006, CMT-010)", () => {
  it("posts it as one Full Thread comment on the Request's own thread", async () => {
    const request = await submit("The answer, written on the way out");
    const reply = "Use the short-form NDA in the templates folder.\nNo review needed under $1k.";
    expect((await resolve(request.number, reply)).statusCode).toBe(200);

    const thread = await commentsOn(request.id);
    expect(thread).toHaveLength(1);
    expect(thread[0]!.body).toBe(reply);
    // Never the triager's choice: a closing reply the requester cannot
    // read is an internal note, not a closing reply (DD-016).
    expect(thread[0]!.visibility).toBe("full_thread");
    expect(thread[0]!.authorId).toBe(memberId);
  });

  it("is on the thread the requester reads afterwards", async () => {
    const request = await submit("The requester reads the answer");
    expect((await resolve(request.number, "Answered — nothing further needed.")).statusCode).toBe(
      200,
    );

    const thread = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=request&entityId=${request.id}`,
      cookies: requesterCookies,
    });
    expect(thread.statusCode, thread.body).toBe(200);
    expect((thread.json().comments as { body: string }[]).map((row) => row.body)).toEqual([
      "Answered — nothing further needed.",
    ]);
  });

  it("writes no comment at all when none was given", async () => {
    const request = await submit("Closed in silence");
    expect((await resolve(request.number)).statusCode).toBe(200);
    expect(await commentsOn(request.id)).toEqual([]);
  });

  it("refuses a blank reply rather than posting an empty comment", async () => {
    // A box of spaces is not an answer. The screen sends no `reply` at
    // all when its box is empty, so this is the seam holding the same
    // rule against a client that did not come from it.
    const request = await submit("A reply written in whitespace");
    const res = await resolve(request.number, "   \n  ");
    expect(res.statusCode, res.body).toBe(400);
    expect((await stored(request.id)).status).toBe("new");
    expect(await commentsOn(request.id)).toEqual([]);
  });

  it("refuses an unknown key rather than dropping it", async () => {
    const request = await submit("A body nobody designed");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/resolve`,
      cookies: memberCookies,
      payload: { reason: "Wrong disposition's field." },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await stored(request.id)).status).toBe("new");
  });
});

describe("what a resolution tells the requester (INT-003, NOT-002 group 5)", () => {
  it("raises the status change, and the reply beside it when there was one", async () => {
    // The two are different news — an answer and a closure — which is
    // what separates Resolve from Decline, where the notification fires
    // instead of the status change (the M20/8 rule).
    const request = await submit("Two pieces of news");
    expect((await resolve(request.number, "Here is the answer.")).statusCode).toBe(200);

    const rows = await bellRowsOn(requesterId, request.id);
    expect(rows.map((row) => row.eventType).sort()).toEqual([
      "request.created",
      "request.replied",
      "request.status_changed",
    ]);
    expect(
      rows.find((row) => row.eventType === "request.status_changed")!.payload,
    ).toMatchObject({ from: "new", to: "resolved" });
    // A resolution is not a decline, and never borrows its event.
    expect(rows.some((row) => row.eventType === "request.declined")).toBe(false);
  });

  it("raises the status change alone when no reply was written", async () => {
    const request = await submit("One piece of news");
    expect((await resolve(request.number)).statusCode).toBe(200);

    const rows = await bellRowsOn(requesterId, request.id);
    expect(rows.map((row) => row.eventType).sort()).toEqual([
      "request.created",
      "request.status_changed",
    ]);
  });

  it("mails the closure in the requester's own words", async () => {
    const request = await submit("The closure reaches the inbox");
    expect((await resolve(request.number)).statusCode).toBe(200);

    await settles(`the resolution email about R-${request.number}`, () =>
      mailAbout(REQUESTER.email, request.number).some((m) =>
        m.subject.includes("Your request is resolved"),
      ),
    );
    const messages = mailAbout(REQUESTER.email, request.number).filter((m) =>
      m.subject.includes("Your request is resolved"),
    );
    // The requester-facing vocabulary, not the enum's (the INT-003 M21/6
    // addendum): the mail and the portal say the same word.
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain("is now resolved");
  });

  it("tells the triager nothing about their own act", async () => {
    // Every group-5 event but the receipt excludes its actor, and a
    // resolution is nobody's news but the requester's. A Member+ does
    // hold the group-4 arrival about this Request — that is their staff
    // work — so the claim is about the requester's own events.
    const request = await submit("The resolver hears nothing");
    expect((await resolve(request.number, "Closing this out.")).statusCode).toBe(200);
    const rows = await bellRowsOn(memberId, request.id);
    expect(rows.map((row) => row.eventType).filter((type) => type !== "request.submitted")).toEqual(
      [],
    );
  });
});

describe("the disposition scaffold, from Resolve (INT-007)", () => {
  it("refuses a second resolution with the recorded outcome", async () => {
    const request = await submit("Resolved once, asked twice");
    expect((await resolve(request.number, "The first and only answer.")).statusCode).toBe(200);

    const again = await resolve(request.number, "A second answer.", otherMemberCookies);
    expect(again.statusCode, again.body).toBe(409);
    const problem = again.json();
    expect(problem.type).toBe(REQUEST_DISPOSITIONED_PROBLEM_TYPE);
    // The outcome is on the wire as an extension member, because it is
    // the fact the losing client acts on. `detail` is copy.
    expect(problem.outcome).toBe("resolved");
  });

  it("refuses a resolution once the Request has been declined", async () => {
    const request = await submit("Already turned down");
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/requests/${request.number}/decline`,
          cookies: memberCookies,
          payload: { reason: "Ask Procurement." },
        })
      ).statusCode,
    ).toBe(200);

    const res = await resolve(request.number, "Too late.");
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().outcome).toBe("declined");
  });

  it("posts no closing reply when it refuses", async () => {
    // The guard throws before the outcome's work runs, so the losing
    // press leaves no comment on somebody else's decision.
    const request = await submit("A refused second press says nothing");
    expect((await resolve(request.number, "The recorded answer.")).statusCode).toBe(200);

    expect((await resolve(request.number, "An overwriting answer.")).statusCode).toBe(409);
    const thread = await commentsOn(request.id);
    expect(thread.map((row) => row.body)).toEqual(["The recorded answer."]);
    expect(
      (await entriesOn(request.id)).filter((row) => row.action === "request.resolved"),
    ).toHaveLength(1);
  });

  it("lets exactly one of two racing triagers resolve (INT-007)", async () => {
    // The row lock, from Resolve's side: both calls are in flight before
    // either commits, so a scaffold that read the status without
    // `FOR UPDATE` would answer 200 twice — and this Request would carry
    // two closing replies and two status-change bells.
    const request = await submit("Two triagers, one resolution");
    const [first, second] = await Promise.all([
      resolve(request.number, "Nadia answers.", memberCookies),
      resolve(request.number, "Priya answers.", otherMemberCookies),
    ]);

    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(codes, `${first.body}\n${second.body}`).toEqual([200, 409]);

    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json().type).toBe(REQUEST_DISPOSITIONED_PROBLEM_TYPE);
    expect(loser.json().outcome).toBe("resolved");

    expect(await commentsOn(request.id)).toHaveLength(1);
    const entries = await entriesOn(request.id);
    expect(entries.filter((row) => row.action === "request.resolved")).toHaveLength(1);
    const bell = await bellRowsOn(requesterId, request.id);
    expect(bell.filter((row) => row.eventType === "request.status_changed")).toHaveLength(1);
  });
});
