// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The thread follows the work (#422), at the HTTP seam every window onto
 * it reads.
 *
 * The subject is what happens to a conversation when the ask it was
 * about becomes a record. CMT-001's promise is that legal answers in
 * exactly one place from then on, so this asks the question from all
 * four sides: the rows themselves, the three addresses that read them,
 * the unread badges that must not start lying, and the reply the
 * requester was promised before anything moved.
 *
 * Three properties carry most of it. **Tiers survive the move** — a
 * Legal Only note does not become visible to the requester by changing
 * records. **The Request keeps its window** — the portal reads the
 * record's thread filtered to Full Thread and the composer still posts.
 * And **one comment tells one person once** — the record's own people
 * hear group 2 and the person who asked hears group 5, and nobody holds
 * two rows about one comment.
 *
 * A never-converted Request is the control case throughout, and its own
 * suite is `comments/request-thread.test.ts`, which this change was not
 * allowed to edit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  comments,
  commentLastRead,
  contractTypes,
  desc,
  eq,
  notifications,
  requestTypes,
  users,
  type CommentVisibility,
} from "@openlaw/db";
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
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** The triager. Every conversion here is theirs, so they are the actor
 * every exclusion rule is measured against. */
const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A second Member+, put on the record's team so that group 2 has
 * somebody left to reach once the actor is excluded. */
const TEAMMATE = {
  email: "teammate@example.com",
  displayName: "Priya Rao",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** Another Business User, who raised nothing here. To them a converted
 * Request reads exactly as an unconverted one does: as nothing. */
const OUTSIDER = {
  email: "sam.dube@acme.com",
  displayName: "Sam Dube",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A Member+ who raises Requests of their own — the one person who can
 * stand on both sides of one comment. */
const STAFF_REQUESTER = {
  email: "own.ask@example.com",
  displayName: "Ruth Adeyemi",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();
/** The seeded front door whose request type targets the NDA contract
 * type, so a conversion confirms the routing and chooses nothing. */
let ndaRequestTypeId: string;
/** The contract type the seeded front door targets — the one every
 * conversion here confirms, reused deliberately for the single record
 * that is born the ordinary way rather than by conversion. */
let targetContractTypeId: string;

const as = (fixture: { email: string }): Record<string, string> => cookies.get(fixture.email)!;
const idOf = (fixture: { email: string }): string => userIds.get(fixture.email)!;

/** One Request, as this suite refers to it afterwards. */
interface RequestRow {
  id: string;
  number: number;
}

/** One converted Request: the ask, and the record it became. */
interface Converted extends RequestRow {
  contractId: string;
  contractNumber: number;
}

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
    [OUTSIDER, "business_user"],
    [MEMBER, "legal_team_member"],
    [TEAMMATE, "legal_team_member"],
    [STAFF_REQUESTER, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(
      fixture.email,
      await harnessSignInCookies(harness.app, fixture.email, fixture.password),
    );
  }

  const [type] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"))
    .limit(1);
  ndaRequestTypeId = type!.id;
  // The seed points this door at a live contract type, which is what
  // lets every conversion below send a title and nothing else. Asserted
  // rather than assumed: a seed that stopped pointing anywhere would
  // otherwise turn every case in this file into a 400.
  const [target] = await harness.db
    .select({ id: contractTypes.id })
    .from(requestTypes)
    .innerJoin(contractTypes, eq(requestTypes.targetContractTypeId, contractTypes.id))
    .where(eq(requestTypes.id, ndaRequestTypeId))
    .limit(1);
  expect(target, "the nda_request seed's target contract type").toBeDefined();
  targetContractTypeId = target!.id;
});

afterAll(async () => {
  await harness.stop();
});

/** Submits one Request, as whoever is asking. */
async function submit(
  summary: string,
  fixture: { email: string } = REQUESTER,
): Promise<RequestRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: as(fixture),
    payload: {
      requestTypeId: ndaRequestTypeId,
      summary,
      description: "They sent a redline on the liability cap.",
      urgency: "high",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const row = res.json().request as RequestRow;
  return { id: row.id, number: row.number };
}

/** Presses Convert, and answers the ask beside the record it became. */
async function convert(request: RequestRow, title = "Northwind mutual NDA"): Promise<Converted> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${request.number}/convert`,
    cookies: as(MEMBER),
    payload: { title },
  });
  expect(res.statusCode, res.body).toBe(200);
  const contractNumber = res.json().request.convertedContract.number as number;
  const record = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${contractNumber}`,
    cookies: as(MEMBER),
  });
  expect(record.statusCode, record.body).toBe(200);
  return { ...request, contractId: record.json().contract.id as string, contractNumber };
}

/** Posts one comment at one address, and answers the raw reply so a case
 * can assert a refusal as easily as a success. */
function post(
  fixture: { email: string },
  ref: { entityType: "request" | "contract"; entityId: string },
  body: string,
  visibility: CommentVisibility = "full_thread",
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(fixture),
    payload: { ...ref, body, visibility },
  });
}

/** Posts one comment, requiring it to land. */
async function say(
  fixture: { email: string },
  ref: { entityType: "request" | "contract"; entityId: string },
  body: string,
  visibility: CommentVisibility = "full_thread",
): Promise<string> {
  const res = await post(fixture, ref, body, visibility);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().comment.id as string;
}

/** One thread as an address answers it, oldest first. */
async function read(
  fixture: { email: string },
  ref: { entityType: "request" | "contract"; entityId: string },
) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=${ref.entityType}&entityId=${ref.entityId}`,
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comments as {
    id: string;
    entityType: string;
    entityId: string;
    body: string;
    visibility: CommentVisibility;
  }[];
}

/** How many comments on this record are news to this reader. */
async function unread(
  fixture: { email: string },
  ref: { entityType: "request" | "contract"; entityId: string },
): Promise<number> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/unread?entityType=${ref.entityType}&entityId=${ref.entityId}`,
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().unread as number;
}

/** Opens the panel, which is what moves the reader's watermark. */
async function markRead(
  fixture: { email: string },
  ref: { entityType: "request" | "contract"; entityId: string },
): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments/read",
    cookies: as(fixture),
    payload: ref,
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Puts somebody on the record's team, so group 2 has an audience. */
async function addToTeam(number: number, fixture: { email: string }): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: as(MEMBER),
    payload: { userId: idOf(fixture), role: "member" },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** The stored comment rows for one thread, by the pair they hang off. */
async function rowsOn(entityType: "request" | "contract", entityId: string) {
  return harness.db
    .select({ id: comments.id, body: comments.body, visibility: comments.visibility })
    .from(comments)
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)))
    .orderBy(comments.createdAt, comments.id);
}

/** Every watermark on one pair. */
async function watermarksOn(entityType: "request" | "contract", entityId: string) {
  return harness.db
    .select({ userId: commentLastRead.userId, readAt: commentLastRead.readAt })
    .from(commentLastRead)
    .where(and(eq(commentLastRead.entityType, entityType), eq(commentLastRead.entityId, entityId)));
}

/** Every activity entry on one record, oldest first. */
async function entriesOn(entityType: "request" | "contract", entityId: string) {
  return harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
    .orderBy(activityLog.createdAt, activityLog.id);
}

/** Every notification row one person holds, newest first. Read from the
 * table rather than from either bell, which is what lets a case tell
 * "nothing was written" from "a row was written and something omitted
 * it". */
async function bellRows(fixture: { email: string }) {
  return harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

/** The rows one person holds about one comment, whichever record the
 * event named. This is the "told once" question, asked over the comment
 * rather than over a record. */
async function rowsAboutComment(fixture: { email: string }, commentId: string) {
  return (await bellRows(fixture)).filter((row) => row.payload.commentId === commentId);
}

/** How long the email is given before the suite calls the queue stuck. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Waits for a condition the pipeline is expected to bring about. */
async function settles(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((wait) => setTimeout(wait, 50));
  }
  throw new Error(`${what} did not settle within ${SETTLE_TIMEOUT_MS}ms`);
}

/** The messages one person has been sent about one Request, by the
 * R-### its group-5 subject lines carry. The separator is part of the
 * match, because `R-1` is a prefix of `R-10`. */
const mailAbout = (fixture: { email: string }, number: number) =>
  harness.mailer.messagesTo(fixture.email).filter((m) => m.subject.includes(`R-${number} ·`));

describe("the rows move with the work (CMT-001)", () => {
  it("re-parents every comment onto the record with its tier intact", async () => {
    const request = await submit("Northwind NDA, whole conversation");
    const asked = await say(REQUESTER, requestRef(request), "Can you look at clause 9?");
    const internal = await say(
      MEMBER,
      requestRef(request),
      "Their indemnity is unusual.",
      "legal_only",
    );
    const working = await say(
      MEMBER,
      requestRef(request),
      "Chasing the business owner.",
      "working_team",
    );
    const answered = await say(MEMBER, requestRef(request), "Looking at it now.");

    const converted = await convert(request);

    // The rows are the same rows: same ids, same bodies, same tiers, in
    // the order they were said. Nothing was copied and nothing re-keyed.
    expect(await rowsOn("request", request.id)).toEqual([]);
    expect(await rowsOn("contract", converted.contractId)).toEqual([
      { id: asked, body: "Can you look at clause 9?", visibility: "full_thread" },
      { id: internal, body: "Their indemnity is unusual.", visibility: "legal_only" },
      { id: working, body: "Chasing the business owner.", visibility: "working_team" },
      { id: answered, body: "Looking at it now.", visibility: "full_thread" },
    ]);
  });

  it("shows the record's own thread the pre-conversion conversation", async () => {
    const request = await submit("The record holds what was said before it");
    await say(REQUESTER, requestRef(request), "Here is the redline.");
    await say(MEMBER, requestRef(request), "Noted internally.", "legal_only");
    const converted = await convert(request);

    // Read at the contract's own address, which is where the record's
    // applet reads it — nothing about this thread says it arrived by
    // conversion.
    const thread = await read(MEMBER, contractRef(converted));
    expect(thread.map((row) => row.body)).toEqual(["Here is the redline.", "Noted internally."]);
  });

  it("narrates the move on the ask, naming the record by its C-###", async () => {
    const request = await submit("The trail says where the conversation went");
    await say(REQUESTER, requestRef(request), "Anything else you need?");
    const converted = await convert(request);

    const entry = (await entriesOn("request", request.id)).find(
      (row) => row.action === "request.thread_moved",
    );
    expect(entry, "the re-parent's entry").toBeDefined();
    expect(entry!.actorId).toBe(idOf(MEMBER));
    expect(entry!.payload).toEqual({
      number: request.number,
      contractNumber: converted.contractNumber,
    });
    // No count: how much was said is a fact at every tier, and this
    // entry is one a Contributor reads (DD-016).
    expect(Object.keys(entry!.payload)).toEqual(["number", "contractNumber"]);
  });

  it("says nothing about a conversation that was never had", async () => {
    const request = await submit("Nothing was said on this one");
    await convert(request);
    expect((await entriesOn("request", request.id)).map((row) => row.action)).not.toContain(
      "request.thread_moved",
    );
  });

  it("leaves a never-converted Request a comment target", async () => {
    const request = await submit("Still undecided, still its own thread");
    const said = await say(REQUESTER, requestRef(request), "Still waiting.");
    expect((await rowsOn("request", request.id)).map((row) => row.id)).toEqual([said]);
    // And a conversion of a different Request does not touch it.
    await convert(await submit("Somebody else's ask"));
    expect((await rowsOn("request", request.id)).map((row) => row.id)).toEqual([said]);
  });
});

describe("the three windows onto one conversation (CMT-001)", () => {
  it("answers the record's thread at the Request's own address", async () => {
    const request = await submit("One conversation, read from the ask");
    await say(MEMBER, requestRef(request), "Internal note.", "legal_only");
    await say(MEMBER, requestRef(request), "Reply to you.");
    const converted = await convert(request);

    // The staff request detail keeps its address and follows the
    // back-link, so a triager who opens the ask reads the record's
    // conversation at every tier — and the rows say which record they
    // are on now.
    const thread = await read(MEMBER, requestRef(request));
    expect(thread.map((row) => row.body)).toEqual(["Internal note.", "Reply to you."]);
    expect(new Set(thread.map((row) => row.entityType))).toEqual(new Set(["contract"]));
    expect(new Set(thread.map((row) => row.entityId))).toEqual(new Set([converted.contractId]));
  });

  it("gives the requester the record's thread filtered to Full Thread", async () => {
    const request = await submit("The window survives the conversion");
    await say(REQUESTER, requestRef(request), "Please look at clause 9.");
    await say(MEMBER, requestRef(request), "Their indemnity is unusual.", "legal_only");
    await say(MEMBER, requestRef(request), "Chasing the owner.", "working_team");
    await say(MEMBER, requestRef(request), "We are on it.");
    const converted = await convert(request);

    // Two rooms they were never in stay out of the answer entirely — no
    // row, no id, and no count of what was left out.
    const thread = await read(REQUESTER, requestRef(request));
    expect(thread.map((row) => row.body)).toEqual(["Please look at clause 9.", "We are on it."]);
    expect(JSON.stringify(thread)).not.toContain("indemnity");
    expect(JSON.stringify(thread)).not.toContain("Chasing");

    // And the record's own address stays shut to them: a Business User
    // reaches no contract (CTR-021), and their window is the Request.
    const direct = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=contract&entityId=${converted.contractId}`,
      cookies: as(REQUESTER),
    });
    expect(direct.statusCode, direct.body).toBe(403);
  });

  it("takes the requester's reply onto the record as Full Thread", async () => {
    const request = await submit("The composer still posts");
    const converted = await convert(request);

    const replied = await say(REQUESTER, requestRef(request), "Signed copy attached by email.");
    expect(await rowsOn("contract", converted.contractId)).toEqual([
      { id: replied, body: "Signed copy attached by email.", visibility: "full_thread" },
    ]);
    // And legal reads it where they are working.
    expect((await read(MEMBER, contractRef(converted))).map((row) => row.id)).toEqual([replied]);
  });

  it("refuses the requester every tier but Full Thread after the move", async () => {
    const request = await submit("One room, before and after");
    await convert(request);
    for (const tier of ["legal_only", "working_team"] as const) {
      const res = await post(REQUESTER, requestRef(request), "Not my room.", tier);
      expect(res.statusCode, res.body).toBe(403);
    }
  });

  it("answers another requester 404 on a converted Request, as it always did", async () => {
    const request = await submit("Somebody else's converted ask");
    const converted = await convert(request);
    await say(MEMBER, contractRef(converted), "Answering the person who asked.");
    // 404 through the Request's address, because to them this ask does
    // not exist (DD-013); 403 through the record's, because a Business
    // User reaches no contract thread at all (CTR-021). The conversion
    // changed neither answer.
    for (const [url, status] of [
      [`/api/v1/comments?entityType=request&entityId=${request.id}`, 404],
      [`/api/v1/comments?entityType=contract&entityId=${converted.contractId}`, 403],
    ] as const) {
      const res = await harness.app.inject({ method: "GET", url, cookies: as(OUTSIDER) });
      expect(res.statusCode, res.body).toBe(status);
    }
  });
});

describe("the unread badge across the move (CMT-009)", () => {
  it("carries each reader's place in the conversation onto the record", async () => {
    const request = await submit("The badge does not start lying");
    await say(REQUESTER, requestRef(request), "First question.");
    // The triager opens the panel: read to here.
    await markRead(MEMBER, requestRef(request));
    expect(await unread(MEMBER, requestRef(request))).toBe(0);
    await say(REQUESTER, requestRef(request), "Second question.");
    expect(await unread(MEMBER, requestRef(request))).toBe(1);

    const converted = await convert(request);

    // One comment is still news, not two: the watermark travelled with
    // the rows it was about. Both addresses answer the same number,
    // because both resolve to the same pair now.
    expect(await unread(MEMBER, contractRef(converted))).toBe(1);
    expect(await unread(MEMBER, requestRef(request))).toBe(1);

    // The row itself moved rather than being copied, and it kept its
    // time — a watermark reset to now() would have marked the second
    // question read.
    const [moved] = await watermarksOn("contract", converted.contractId);
    expect(moved?.userId).toBe(idOf(MEMBER));
    expect(await watermarksOn("request", request.id)).toEqual([]);
  });

  it("keeps the requester's own count truthful too", async () => {
    const request = await submit("The portal badge survives it as well");
    await say(MEMBER, requestRef(request), "We have it.");
    await markRead(REQUESTER, requestRef(request));
    await say(MEMBER, requestRef(request), "One more thing.");
    await say(MEMBER, requestRef(request), "Internal only.", "legal_only");

    const converted = await convert(request);

    // One unread, not two and not three: the Legal Only comment moved
    // with the rest and still contributes nothing to a count the
    // requester can see.
    expect(await unread(REQUESTER, requestRef(request))).toBe(1);
    expect(await unread(MEMBER, contractRef(converted))).toBe(0);
  });

  it("leaves a reader who never opened the panel every comment unread", async () => {
    const request = await submit("Never opened, all of it news");
    await say(REQUESTER, requestRef(request), "One.");
    await say(REQUESTER, requestRef(request), "Two.");
    const converted = await convert(request);
    expect(await unread(TEAMMATE, contractRef(converted))).toBe(2);
  });
});

describe("the reply promise follows the thread (NOT-002 group 5)", () => {
  it("reaches the Requester's bell and email from a Full Thread comment on the record", async () => {
    const request = await submit("The promise outlives the move");
    const converted = await convert(request);
    const commentId = await say(MEMBER, contractRef(converted), "We have sent the redline back.");

    const rows = await rowsAboutComment(REQUESTER, commentId);
    expect(rows.map((row) => row.eventType)).toEqual(["request.replied"]);
    // The row is about the Request, which is what keeps it on the portal
    // bell rather than in a staff notification centre a Business User
    // has no way to open.
    expect(rows[0]!.entityType).toBe("request");
    expect(rows[0]!.entityId).toBe(request.id);
    expect(rows[0]!.payload.requestNumber).toBe(request.number);
    expect(rows[0]!.payload.actorName).toBe(MEMBER.displayName);
    expect(rows[0]!.emailOwed).toBe(true);

    await settles(`the reply email about R-${request.number}`, () =>
      mailAbout(REQUESTER, request.number).some((m) => m.subject.includes("Legal replied")),
    );
    const message = mailAbout(REQUESTER, request.number).find((m) =>
      m.subject.includes("Legal replied"),
    );
    expect(message!.text).toContain(`http://localhost/portal/requests/${request.number}`);
    // The words stay on the thread (CMT-006, DD-016).
    expect(message!.text).not.toContain("redline back");
  });

  it("raises nothing at the Requester from a Legal Only or Working Team comment", async () => {
    const request = await submit("Staff talking among themselves");
    const converted = await convert(request);
    const before = (await bellRows(REQUESTER)).length;
    await say(MEMBER, contractRef(converted), "Their cap is aggressive.", "legal_only");
    await say(MEMBER, contractRef(converted), "Owner is on leave.", "working_team");
    // The row is the whole claim: the email is hung off the row it would
    // have been written on, so no row is no message.
    expect(await bellRows(REQUESTER)).toHaveLength(before);
    expect(
      mailAbout(REQUESTER, request.number).filter((m) => m.subject.includes("Legal replied")),
    ).toEqual([]);
  });

  it("excludes the poster, and tells the record's own people instead", async () => {
    const request = await submit("The poster hears nothing about posting");
    const converted = await convert(request);
    await addToTeam(converted.contractNumber, TEAMMATE);
    const commentId = await say(MEMBER, contractRef(converted), "Sending it over now.");

    expect(await rowsAboutComment(MEMBER, commentId)).toEqual([]);
    // Group 2 still fires on the record beside the reply: the record's
    // people hear that something was said on it.
    const teammate = await rowsAboutComment(TEAMMATE, commentId);
    expect(teammate.map((row) => row.eventType)).toEqual(["comment.posted"]);
    expect(teammate[0]!.entityType).toBe("contract");
  });

  it("tells nobody in group 5 when the requester replies themselves", async () => {
    const request = await submit("Their own reply is not news to them");
    const converted = await convert(request);
    await addToTeam(converted.contractNumber, TEAMMATE);
    const before = (await bellRows(REQUESTER)).length;
    const commentId = await say(REQUESTER, requestRef(request), "Here is our position.");

    expect(await bellRows(REQUESTER)).toHaveLength(before);
    // And the record's people do hear it, which is the whole point of
    // the thread having moved: a reply from the requester lands where
    // legal is working.
    expect((await rowsAboutComment(TEAMMATE, commentId)).map((row) => row.eventType)).toEqual([
      "comment.posted",
    ]);
  });

  it("gives one person one row for one comment", async () => {
    // The only person who can stand on both sides: a Member+ who raised
    // the Request and is also on the record's team. Group 5 reaches them
    // as the Requester, so group 2 must not reach them as well.
    const request = await submit("Both sides of one comment", STAFF_REQUESTER);
    const converted = await convert(request);
    await addToTeam(converted.contractNumber, STAFF_REQUESTER);

    const reply = await say(MEMBER, contractRef(converted), "Answering your own ask.");
    expect((await rowsAboutComment(STAFF_REQUESTER, reply)).map((row) => row.eventType)).toEqual([
      "request.replied",
    ]);

    // Below Full Thread no reply can reach them, so the record's own
    // event is their only news of it and they keep it. The rule is the
    // tier's, not the person's.
    const internal = await say(MEMBER, contractRef(converted), "Internally.", "legal_only");
    expect((await rowsAboutComment(STAFF_REQUESTER, internal)).map((row) => row.eventType)).toEqual(
      ["comment.posted"],
    );

    // And a Full Thread comment that names them by name is still one
    // row: the mention is the loudest of the three events on a record,
    // so the reply steps aside beside the record's own group-2 item.
    const named = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: as(MEMBER),
      payload: {
        entityType: "contract",
        entityId: converted.contractId,
        body: "Confirming with you directly.",
        visibility: "full_thread",
        mentions: [idOf(STAFF_REQUESTER)],
      },
    });
    expect(named.statusCode, named.body).toBe(201);
    const namedId = named.json().comment.id as string;
    expect((await rowsAboutComment(STAFF_REQUESTER, namedId)).map((row) => row.eventType)).toEqual([
      "comment.mentioned",
    ]);
  });

  it("raises no reply on a contract no Request converted into", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: as(MEMBER),
      payload: {
        title: "An ordinary contract nobody asked for",
        contractTypeId: targetContractTypeId,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const contractId = created.json().contract.id as string;
    const commentId = await say(MEMBER, { entityType: "contract", entityId: contractId }, "Hello.");
    expect(
      (
        await harness.db.select().from(notifications).where(eq(notifications.entityType, "request"))
      ).filter((row) => row.payload.commentId === commentId),
    ).toEqual([]);
  });
});

/** The Request's own thread address — what the portal and the staff
 * request detail both ask for. */
const requestRef = (request: RequestRow) =>
  ({ entityType: "request", entityId: request.id }) as const;

/** The record's own thread address — what the contract's applet asks
 * for. */
const contractRef = (converted: Converted) =>
  ({ entityType: "contract", entityId: converted.contractId }) as const;
