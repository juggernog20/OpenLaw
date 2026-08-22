// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The mention's `request` arm (#416, M21/5) at the HTTP seam, over the
 * real-Postgres harness, the real pg-boss queue, and the harness's
 * capturing mailer.
 *
 * **Nothing here looks at the Notifier.** Each case posts a real comment
 * over HTTP and then asserts what a person can observe: the rows the two
 * bells are backed by, the items each bell answers, and the mail the
 * harness caught.
 *
 * What it pins is the one rule the arm adds and the two rules it
 * inherits:
 *
 * - **A mention is done *to* you whatever record it happens on** (NOT-002
 *   M18/1). Being named on a Request thread is group 1, exactly as being
 *   named on a contract is: the bell rings and the email leaves at once,
 *   carrying R-### and the staff detail's address (#414) and no comment
 *   words (M18/3).
 * - **The audience is the staff side** (INT-006). A Member+ is named as a
 *   triager, so the mention lands on the staff centre and the wall step
 *   re-asks that they are still Member+.
 * - **The Requester is never mention-notified at Full Thread** (M18/4).
 *   The reply event already reaches them there, and one comment tells one
 *   person once. The one person who can stand on both sides — a Member+
 *   who raised the Request themselves — proves the rule is the tier's
 *   rather than the person's: named at Full Thread they get the reply,
 *   named at Legal Only they get the mention, because no reply event can
 *   reach that room.
 *
 * The fan-out cases read the `notifications` rows from the table, which
 * is the group-4 and group-5 suites' own deliberate exception: reading
 * them directly is what lets a case tell "nothing was written" from "a
 * row was written and something omitted it".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, notifications, users, type Notification } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The Business User who asks. Every Request here is theirs unless a case
 * says otherwise. */
const REQUESTER = {
  email: "isla.brenner@acme.com",
  displayName: "Isla Brenner",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** The Legal Team Member who triages, and who does the naming. */
const TRIAGER = {
  email: "omar.dib@example.com",
  displayName: "Omar Dib",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A second Legal Team Member — the person most cases name. */
const COLLEAGUE = {
  email: "yuki.tanaka@example.com",
  displayName: "Yuki Tanaka",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A Legal Team Member who raises a Request of their own, so "Requester"
 * and "Member+" are one person on one record. */
const STAFF_REQUESTER = {
  email: "lena.fors@example.com",
  displayName: "Lena Fors",
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
    [TRIAGER, "legal_team_member"],
    [COLLEAGUE, "legal_team_member"],
    [STAFF_REQUESTER, "legal_team_member"],
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
});

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

/** Posts one comment on a Request's thread, naming whoever it names. */
async function say(
  fixture: { email: string },
  request: RequestRow,
  body: string,
  visibility: "legal_only" | "working_team" | "full_thread",
  mentions: readonly { email: string }[] = [],
): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(fixture),
    payload: {
      entityType: "request",
      entityId: request.id,
      body,
      visibility,
      mentions: mentions.map((who) => idOf(who)),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().comment.id as string;
}

/** The rows one person holds about one Request, newest first. */
const rowsAbout = async (
  fixture: { email: string },
  request: RequestRow,
): Promise<Notification[]> => {
  const rows = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
  return rows.filter((row) => row.entityType === "request" && row.entityId === request.id);
};

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
 * R-### reference. The separator is part of the match, because `R-1` is a
 * prefix of `R-10` and this suite mints numbers past nine. */
const mailAbout = (fixture: { email: string }, request: RequestRow) =>
  harness.mailer
    .messagesTo(fixture.email)
    .filter((m) => m.subject.includes(`R-${request.number} ·`));

/** One item, as either bell answers it. */
interface BellItem {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

const itemsOn = async (
  surface: "staff" | "portal",
  fixture: { email: string },
): Promise<BellItem[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: surface === "portal" ? "/api/v1/portal/notifications" : "/api/v1/notifications",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { notifications: BellItem[] }).notifications;
};

describe("being named on a Request thread (NOT-002 group 1, M18/1)", () => {
  it("writes the named Member+ a mention carrying R-### and the summary", async () => {
    const request = await submit(REQUESTER, "Review the Northwind supply redline");
    const commentId = await say(
      TRIAGER,
      request,
      `Can you take this one, @${COLLEAGUE.displayName}?`,
      "legal_only",
      [COLLEAGUE],
    );

    const rows = await rowsAbout(COLLEAGUE, request);
    // The arrival is group 4's, written when the Request was submitted;
    // the mention is this slice's, and it is the newest row.
    expect(rows.map((row) => row.eventType)).toEqual(["comment.mentioned", "request.submitted"]);
    expect(rows[0]!.readAt).toBeNull();
    expect(rows[0]!.payload.requestNumber).toBe(request.number);
    expect(rows[0]!.payload.requestSummary).toBe(request.summary);
    expect(rows[0]!.payload.actorName).toBe(TRIAGER.displayName);
    expect(rows[0]!.payload.commentId).toBe(commentId);
    // The words are never in the payload: the tier is enforced on the
    // thread and a redact can still reach the text (CMT-006).
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("take this one");
  });

  it("does not tell the person who did the naming", async () => {
    const request = await submit(REQUESTER, "Review the Contoso NDA");
    await say(TRIAGER, request, "Noting this for myself.", "legal_only", [TRIAGER]);
    // Group 4's arrival and nothing else: the actor exclusion holds on
    // group 1 too, so naming yourself tells you nothing.
    expect((await rowsAbout(TRIAGER, request)).map((row) => row.eventType)).toEqual([
      "request.submitted",
    ]);
  });

  it("tells a named Member+ once, and nobody else anything about the comment", async () => {
    const request = await submit(REQUESTER, "Review the Initech order form");
    await say(TRIAGER, request, `Over to you, @${COLLEAGUE.displayName}.`, "full_thread", [
      COLLEAGUE,
    ]);

    // One row for one comment: the mention, and no second row beside it.
    // The arrival below it is a different act.
    expect((await rowsAbout(COLLEAGUE, request)).map((row) => row.eventType)).toEqual([
      "comment.mentioned",
      "request.submitted",
    ]);
    // The Requester hears the reply, because a Full Thread comment is
    // addressed to them — and that is group 5's event, not this one.
    expect((await rowsAbout(REQUESTER, request)).map((row) => row.eventType)).toEqual([
      "request.replied",
      "request.created",
    ]);
    // A Member+ nobody named hears nothing about the comment: a Request
    // raises no group-2 event, so the arrival is all they hold.
    expect((await rowsAbout(STAFF_REQUESTER, request)).map((row) => row.eventType)).toEqual([
      "request.submitted",
    ]);
  });
});

describe("the Requester and the mention (M18/4)", () => {
  it("gives a Requester named at Full Thread the reply and never the mention", async () => {
    const request = await submit(REQUESTER, "Review the Umbrella DPA");
    await say(TRIAGER, request, `Answering you, @${REQUESTER.displayName}.`, "full_thread", [
      REQUESTER,
    ]);
    expect((await rowsAbout(REQUESTER, request)).map((row) => row.eventType)).toEqual([
      "request.replied",
      "request.created",
    ]);
  });

  it("narrows the mention by the comment's tier for the one person on both sides", async () => {
    // A Member+ who raised the Request themselves stands on both sides.
    // At Full Thread the reply event already has them, so the mention is
    // dropped; at Legal Only no reply event can reach them, so the
    // mention is the only thing that can, and it does.
    const request = await submit(STAFF_REQUESTER, "Review our own vendor paper");
    await say(TRIAGER, request, `Confirming, @${STAFF_REQUESTER.displayName}.`, "full_thread", [
      STAFF_REQUESTER,
    ]);
    expect((await rowsAbout(STAFF_REQUESTER, request)).map((row) => row.eventType)).toEqual([
      "request.replied",
      "request.created",
    ]);

    await say(TRIAGER, request, `Privileged note, @${STAFF_REQUESTER.displayName}.`, "legal_only", [
      STAFF_REQUESTER,
    ]);
    expect((await rowsAbout(STAFF_REQUESTER, request)).map((row) => row.eventType)).toEqual([
      "comment.mentioned",
      "request.replied",
      "request.created",
    ]);
  });
});

describe("the mention's email (NOT-002 group 1)", () => {
  it("leaves at once, names R-### and the summary, and links to the staff detail", async () => {
    const request = await submit(REQUESTER, "Review the Aperture MSA");
    await say(TRIAGER, request, `Your call, @${COLLEAGUE.displayName}.`, "working_team", [
      COLLEAGUE,
    ]);

    const rows = await rowsAbout(COLLEAGUE, request);
    expect(rows[0]!.eventType).toBe("comment.mentioned");
    // Group 1 is on by default and interrupts: nobody had to opt in.
    expect(rows[0]!.emailOwed).toBe(true);

    await settles(
      `the mention email to ${COLLEAGUE.email}`,
      () => mailAbout(COLLEAGUE, request).length > 0,
    );
    const message = mailAbout(COLLEAGUE, request)[0]!;
    expect(message.subject).toContain(`R-${request.number} · ${request.summary}`);
    expect(message.text).toContain(TRIAGER.displayName);
    expect(message.text).toContain(`http://localhost/inbox/${request.number}`);
    // The reader is staff, so the portal address is never offered.
    expect(message.text).not.toContain("/portal/requests/");
    // No comment words in the mail (M18/3).
    expect(message.text).not.toContain("Your call");
  });
});

describe("which bell draws the mention (NOT-001, M20/9)", () => {
  it("answers it on the staff centre and never on the portal bell", async () => {
    const request = await submit(STAFF_REQUESTER, "Review the Tyrell maintenance schedule");
    await say(TRIAGER, request, `Have a look, @${STAFF_REQUESTER.displayName}.`, "legal_only", [
      STAFF_REQUESTER,
    ]);

    const staff = await itemsOn("staff", STAFF_REQUESTER);
    const mention = staff.find(
      (item) => item.entityId === request.id && item.eventType === "comment.mentioned",
    );
    expect(mention, JSON.stringify(staff)).toBeDefined();
    expect(mention!.entityType).toBe("request");
    expect(mention!.payload.requestNumber).toBe(request.number);

    const portal = await itemsOn("portal", STAFF_REQUESTER);
    expect(portal.some((item) => item.eventType === "comment.mentioned")).toBe(false);
  });
});
