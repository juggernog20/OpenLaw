// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Decline (#418): the first disposition, and the scaffold the other two
 * ride on — asserted at the HTTP seam the screen presses.
 *
 * Two subjects live here. **Decline itself**: who may press it, that the
 * reason is required and refused by name, what the Request holds
 * afterwards, what the requester is told, and what the log says. And
 * **the disposition scaffold** (INT-007): that a Request transitions
 * only from `new`, that the loser of a race is answered the recorded
 * outcome as a problem type rather than a second decline, and that a
 * refused disposition writes nothing at all.
 *
 * The race is asserted by pressing both calls at once against the real
 * database, which is the only place the row lock is real. A test that
 * declined twice in sequence would pass with no lock at all.
 *
 * What a Request *is* and what the queue shows are `requests.test.ts`'s
 * and `inbox.test.ts`'s; the notifier's fan-out is
 * `requester-events.test.ts`'s. What this suite asks of those is that
 * the decline reaches them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, requests, requestTypes, type RequestStatus } from "@openlaw/db";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE, MAX_DECLINE_REASON_LENGTH } from "@openlaw/shared";
import {
  dispositionScaffold,
  settles,
  REQUESTER,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN as ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
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

  cast = await dispositionScaffold(harness);
  ({
    adminCookies,
    memberCookies,
    otherMemberCookies,
    contributorCookies,
    requesterCookies,
    requesterId,
    memberId,
  } = cast);

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

function decline(number: number, reason: string, cookies = memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/decline`,
    cookies,
    payload: { reason },
  });
}

/** The shared reads, by their own names — the scaffold's, bound once
 * the cast is installed. */
const stored = (id: string) => cast.stored(id);
const entriesOn = (id: string) => cast.entriesOn(id);
const bellRowsOn = (userId: string, requestId: string) => cast.bellRowsOn(userId, requestId);
const mailAbout = (email: string, number: number) => cast.mailAbout(email, number);

describe("who may decline (INT-006, DD-013)", () => {
  it("answers an Administrator and a Legal Team Member", async () => {
    for (const cookies of [adminCookies, memberCookies]) {
      const request = await submit("Whoever triages may decline");
      const res = await decline(request.number, "Out of scope for Legal.", cookies);
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it("refuses a Contributor and a Business User with 403", async () => {
    // The Business User here is the Requester themselves: declining
    // their own ask is triage's act, and triage is legal's.
    const request = await submit("Not theirs to decide");
    for (const cookies of [contributorCookies, requesterCookies]) {
      const res = await decline(request.number, "Mine now.", cookies);
      expect(res.statusCode, res.body).toBe(403);
    }
    expect((await stored(request.id)).status).toBe("new");
  });

  it("refuses a caller with no session", async () => {
    const request = await submit("Needs a session");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/decline`,
      payload: { reason: "Anonymous no." },
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("answers 404 for a reference nobody has", async () => {
    const res = await decline(9_999_999, "Nothing to decline.");
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the reason (INT-006)", () => {
  it("refuses an empty reason by name", async () => {
    const request = await submit("A no with no why");
    const res = await decline(request.number, "");
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Reason");
    expect((await stored(request.id)).status).toBe("new");
  });

  it("refuses a reason of spaces the same way", async () => {
    const request = await submit("A no written in whitespace");
    const res = await decline(request.number, "   \n  ");
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Reason");
    expect((await stored(request.id)).status).toBe("new");
  });

  it("stores the reason trimmed, as written", async () => {
    const request = await submit("Duplicate of an open ask");
    const reason = "Orion's redline is already being reviewed on R-44.\nFollow the thread there.";
    const res = await decline(request.number, `  ${reason}  `);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.declinedReason).toBe(reason);
    expect((await stored(request.id)).declinedReason).toBe(reason);
  });

  it("refuses a reason past the shared ceiling", async () => {
    const request = await submit("An essay instead of an answer");
    const res = await decline(request.number, "x".repeat(MAX_DECLINE_REASON_LENGTH + 1));
    expect(res.statusCode, res.body).toBe(400);
    expect((await stored(request.id)).status).toBe("new");
  });
});

describe("what a decline writes (INT-007)", () => {
  it("moves the Request to declined and answers the staff envelope", async () => {
    const request = await submit("Ask Procurement instead");
    const res = await decline(request.number, "This one goes to Procurement, not to Legal.");
    expect(res.statusCode, res.body).toBe(200);

    const answered = res.json().request;
    expect(answered.number).toBe(request.number);
    expect(answered.status).toBe("declined");
    expect(answered.declinedReason).toBe("This one goes to Procurement, not to Legal.");
    // The whole envelope, so the screen paints the outcome from the
    // write's own reply rather than from a second read.
    expect(answered.requester.email).toBe(REQUESTER.email);
    expect(answered.requestType.displayName).toBeTruthy();
    expect(answered.convertedContract).toBeNull();

    const row = await stored(request.id);
    expect(row.status).toBe("declined");
    expect(row.convertedContractId).toBeNull();
  });

  it("narrates request.declined with the actor, and carries no reason in the payload", async () => {
    const request = await submit("Narrate who said no");
    expect((await decline(request.number, "Not a legal question.")).statusCode).toBe(200);

    const entries = await entriesOn(request.id);
    expect(entries.map((row) => row.action)).toEqual(["request.created", "request.declined"]);
    const declined = entries[1]!;
    // INT-007: who dispositioned a Request is audit data, and it is the
    // actor on the row rather than a column on the Request.
    expect(declined.actorId).toBe(memberId);
    // The log is append-only (DD-017), so the reason stays on the
    // Request where a correction can still reach it.
    expect(declined.payload).toEqual({ number: request.number });
  });

  it("shows the Request under the triaged toggle and takes it out of the queue", async () => {
    const request = await submit("Leaves the undecided queue");
    expect((await decline(request.number, "Answered by the FAQ.")).statusCode).toBe(200);

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
    expect(row?.status).toBe("declined");
  });

  it("gives the requester's own window the outcome and the reason", async () => {
    const request = await submit("The portal reads the decline");
    expect((await decline(request.number, "We do not paper NDAs under $1k.")).statusCode).toBe(200);

    const mine = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: requesterCookies,
    });
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().request.status).toBe("declined");
    expect(mine.json().request.declinedReason).toBe("We do not paper NDAs under $1k.");
  });
});

describe("what a decline tells the requester (INT-003, NOT-002 group 5)", () => {
  it("raises requestDeclined instead of the status change it also is", async () => {
    const request = await submit("One event, not two");
    expect((await decline(request.number, "Handled on the phone.")).statusCode).toBe(200);

    const rows = await bellRowsOn(requesterId, request.id);
    expect(rows.map((row) => row.eventType).sort()).toEqual([
      "request.created",
      "request.declined",
    ]);
    // The M20/8 rule, stated as an absence: two messages about one act
    // would be the same news at two volumes.
    expect(rows.some((row) => row.eventType === "request.status_changed")).toBe(false);
    expect(rows.find((row) => row.eventType === "request.declined")!.payload).toMatchObject({
      reason: "Handled on the phone.",
    });
  });

  it("mails the reason itself, not a line about a reason", async () => {
    const request = await submit("The why travels with the no");
    const reason = "Procurement owns vendor onboarding — raise it with them.";
    expect((await decline(request.number, reason)).statusCode).toBe(200);

    await settles(`the decline email about R-${request.number}`, () =>
      mailAbout(REQUESTER.email, request.number).some((m) =>
        m.subject.includes("Your request was declined"),
      ),
    );
    const messages = mailAbout(REQUESTER.email, request.number).filter((m) =>
      m.subject.includes("Your request was declined"),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain(reason);
  });

  it("tells the triager nothing about their own act", async () => {
    // Every group-5 event but the receipt excludes its actor, and the
    // decline is nobody's news but the requester's. A Member+ does hold
    // the group-4 arrival about this Request — that is their staff work,
    // and `new-requests.test.ts`'s subject — so the claim is about the
    // requester's own events.
    const request = await submit("The decliner hears nothing");
    expect((await decline(request.number, "Mine to close.")).statusCode).toBe(200);
    const rows = await bellRowsOn(memberId, request.id);
    expect(rows.map((row) => row.eventType).filter((type) => type !== "request.submitted")).toEqual(
      [],
    );
  });
});

describe("the disposition scaffold (INT-007)", () => {
  it("refuses a second decline with the recorded outcome", async () => {
    const request = await submit("Declined once, asked twice");
    expect((await decline(request.number, "The first and only no.")).statusCode).toBe(200);

    const again = await decline(request.number, "A second no.", otherMemberCookies);
    expect(again.statusCode, again.body).toBe(409);
    const problem = again.json();
    expect(problem.type).toBe(REQUEST_DISPOSITIONED_PROBLEM_TYPE);
    // The outcome is on the wire as an extension member, because it is
    // the fact the losing client acts on. `detail` is copy.
    expect(problem.outcome).toBe("declined");
  });

  it("names the recorded outcome whatever that outcome was", async () => {
    // The terminal statuses are written straight against the table
    // rather than through their own routes: this pins the scaffold's
    // refusal alone, without another disposition's side effects — a
    // contract, a comment, an event, an email — standing behind it.
    for (const outcome of ["resolved", "converted"] as const satisfies readonly RequestStatus[]) {
      const request = await submit(`Already ${outcome}`);
      await harness.db.update(requests).set({ status: outcome }).where(eq(requests.id, request.id));

      const res = await decline(request.number, "Too late.");
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().type).toBe(REQUEST_DISPOSITIONED_PROBLEM_TYPE);
      expect(res.json().outcome).toBe(outcome);
    }
  });

  it("writes no second entry, event, or reason when it refuses", async () => {
    const request = await submit("A refused second press writes nothing");
    expect((await decline(request.number, "The recorded reason.")).statusCode).toBe(200);

    // The first decline's email leaves after its transaction commits, so
    // the snapshot waits for it. Counting before it landed would credit
    // the refused press with somebody else's message.
    await settles(`the decline email about R-${request.number}`, () =>
      mailAbout(REQUESTER.email, request.number).some((m) =>
        m.subject.includes("Your request was declined"),
      ),
    );
    const entriesBefore = await entriesOn(request.id);
    const bellBefore = await bellRowsOn(requesterId, request.id);
    const mailBefore = mailAbout(REQUESTER.email, request.number).length;

    expect((await decline(request.number, "An overwriting reason.")).statusCode).toBe(409);

    expect(await entriesOn(request.id)).toHaveLength(entriesBefore.length);
    expect(await bellRowsOn(requesterId, request.id)).toHaveLength(bellBefore.length);
    expect(mailAbout(REQUESTER.email, request.number)).toHaveLength(mailBefore);
    // The stored reason is the first triager's, untouched.
    expect((await stored(request.id)).declinedReason).toBe("The recorded reason.");
  });

  it("lets exactly one of two racing triagers decline (INT-007)", async () => {
    // The whole point of the row lock, and the only assertion that
    // needs a real database: both calls are in flight before either
    // commits, so a scaffold that read the status without `FOR UPDATE`
    // would answer 200 twice.
    const request = await submit("Two triagers, one decline");
    const [first, second] = await Promise.all([
      decline(request.number, "Nadia says no.", memberCookies),
      decline(request.number, "Priya says no.", otherMemberCookies),
    ]);

    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(codes, `${first.body}\n${second.body}`).toEqual([200, 409]);

    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json().type).toBe(REQUEST_DISPOSITIONED_PROBLEM_TYPE);
    expect(loser.json().outcome).toBe("declined");

    // One decline: one entry, one bell row, one stored reason.
    const entries = await entriesOn(request.id);
    expect(entries.filter((row) => row.action === "request.declined")).toHaveLength(1);
    const bell = await bellRowsOn(requesterId, request.id);
    expect(bell.filter((row) => row.eventType === "request.declined")).toHaveLength(1);
    const winner = first.statusCode === 200 ? first : second;
    expect((await stored(request.id)).declinedReason).toBe(winner.json().request.declinedReason);
  });
});
