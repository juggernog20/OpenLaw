// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request thread (M20/7) at the HTTP seam: the `request` arm of the
 * comments audience, proved with the four people it has to tell apart.
 *
 * The thread machinery itself is not re-asserted here. Paging, the three
 * corrections, the mention refusal, and the shape of an envelope are the
 * contract suite's subject and are one implementation whichever arm
 * resolved the audience (CMT-010). What this suite covers is the arm:
 * who is in the room on a Request, which tiers each of them hears, and
 * what everybody else is answered.
 *
 * The central assertion is the tier filter with two real viewers again,
 * on a record that has no team table and no confidentiality wall. A
 * Legal Team Member posts at all three DD-016 tiers; the Requester reads
 * the same Request and gets the Full Thread comment and nothing else —
 * not the text, not an id, and not a number, because the badge is
 * counted over the same filtered set the thread is read at (CMT-009).
 *
 * The refusals are the other half. Another requester is answered 404 on
 * every route, because to a requester another person's Request does not
 * exist (DD-013); a Contributor who did not raise it is answered the
 * same way, because a Contributor's grant is a `contract_team` row and a
 * Request has no team for one to sit on.
 *
 * The thread is live from submission (INT-007): a Request that is still
 * `new` takes the clarifying back-and-forth, and no route here consults
 * a status.
 *
 * Posting lands a `comment.posted` activity row on the **Request** at
 * the comment's own tier (DD-017), asserted by reading the table.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, requests, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who raised the Request — a Business User, as most
 * requesters are (DD-013). */
const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery",
} as const;

/** A second Business User with a Request of their own, so "another
 * requester" is a real session and not a missing row. */
const OTHER_REQUESTER = {
  email: "dana.okafor@acme.com",
  displayName: "Dana Okafor",
  password: "correct-horse-battery",
} as const;

/** Staff. Member+ hears every tier on every Request, with no team row to
 * hold and no wall to pass. */
const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

/** A Contributor who raised nothing. On a contract they would be one
 * `contract_team` row from the conversation; on a Request there is no
 * such row to hold. */
const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

interface CommentRow {
  id: string;
  entityType: string;
  entityId: string;
  author: { id: string; displayName: string };
  body: string;
  visibility: string;
  mentions: { id: string; displayName: string }[];
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let otherCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
const userIds = new Map<string, string>();
/** The Request this suite talks on, and one belonging to somebody else. */
let requestId: string;
let otherRequestId: string;
let contractReviewTypeId: string;

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
    [OTHER_REQUESTER, "business_user"],
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }

  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  requesterCookies = await signInCookies(harness.app, REQUESTER.email, REQUESTER.password);
  otherCookies = await signInCookies(harness.app, OTHER_REQUESTER.email, OTHER_REQUESTER.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: adminCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  const row = (types.json().requestTypes as { slug: string; id: string }[]).find(
    (type) => type.slug === "contract_review",
  );
  contractReviewTypeId = row!.id;

  requestId = await submit(requesterCookies, "MSA renewal with Orion Cloud");
  otherRequestId = await submit(otherCookies, "NDA for the Helix pilot");
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** One Request through the portal's own door, answered by its id — the
 * reference the thread is keyed by (CMT-010). */
async function submit(cookies: Record<string, string>, summary: string): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies,
    payload: {
      requestTypeId: contractReviewTypeId,
      summary,
      description: "They sent a redline on the liability cap.",
      urgency: "high",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request.id as string;
}

async function post(
  cookies: Record<string, string>,
  body: string,
  visibility: string,
  entityId = requestId,
) {
  return await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    payload: { entityType: "request", entityId, body, visibility },
  });
}

async function read(cookies: Record<string, string>, entityId = requestId) {
  return await harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=request&entityId=${entityId}`,
    cookies,
  });
}

async function unread(cookies: Record<string, string>, entityId = requestId) {
  return await harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/unread?entityType=request&entityId=${entityId}`,
    cookies,
  });
}

function bodies(res: { json: () => { comments: CommentRow[] } }): string[] {
  return res.json().comments.map((comment) => comment.body);
}

describe("the request arm's audience", () => {
  it("lets the Requester read the thread and reply at Full Thread", async () => {
    const id = await submit(requesterCookies, "Reply lands");
    const posted = await post(requesterCookies, "Any update on this?", "full_thread", id);
    expect(posted.statusCode, posted.body).toBe(201);
    const comment = posted.json().comment as CommentRow;
    expect(comment.visibility).toBe("full_thread");
    expect(comment.entityType).toBe("request");
    expect(comment.entityId).toBe(id);
    expect(comment.author.id).toBe(userIds.get(REQUESTER.email));

    const thread = await read(requesterCookies, id);
    expect(thread.statusCode, thread.body).toBe(200);
    expect(bodies(thread)).toEqual(["Any update on this?"]);
  });

  it("takes a reply while the Request is still new (INT-007)", async () => {
    const id = await submit(requesterCookies, "Still new");
    const stored = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/requests",
      cookies: requesterCookies,
    });
    const own = (stored.json().requests as { id: string; status: string }[]).find(
      (record) => record.id === id,
    );
    expect(own?.status).toBe("new");

    const posted = await post(requesterCookies, "Adding context.", "full_thread", id);
    expect(posted.statusCode, posted.body).toBe(201);
  });

  it("refuses the Requester every tier but Full Thread", async () => {
    for (const tier of ["legal_only", "working_team"]) {
      const refused = await post(requesterCookies, "Not my room.", tier);
      expect(refused.statusCode, refused.body).toBe(403);
    }
  });

  it("lets a Member+ post at every tier and read the whole thread", async () => {
    const id = await submit(requesterCookies, "Every tier");
    for (const [tier, body] of [
      ["legal_only", "Privileged note."],
      ["working_team", "Working note."],
      ["full_thread", "We are on it, Tom."],
    ] as const) {
      const posted = await post(memberCookies, body, tier, id);
      expect(posted.statusCode, posted.body).toBe(201);
    }

    const staffThread = await read(memberCookies, id);
    expect(bodies(staffThread)).toEqual([
      "Privileged note.",
      "Working note.",
      "We are on it, Tom.",
    ]);
  });

  it("answers a Member+ on a Request they did not raise", async () => {
    const thread = await read(memberCookies, otherRequestId);
    expect(thread.statusCode, thread.body).toBe(200);
  });

  it("answers a Member+ who raised the Request themselves as staff", async () => {
    // Staff standing wins over requester standing (the CMT-010 M20/7
    // addendum): being the Requester too does not take a room away from
    // somebody who was already in every one of them. This suite refuses
    // a Business User requester this same tier above.
    const id = await submit(memberCookies, "Raised by staff");
    const posted = await post(memberCookies, "Note to self, privileged.", "legal_only", id);
    expect(posted.statusCode, posted.body).toBe(201);

    const thread = await read(memberCookies, id);
    expect(bodies(thread)).toEqual(["Note to self, privileged."]);
  });

  it("answers 404 on an archived Request, exactly as its detail read does", async () => {
    // Archiving is the one thing that closes the thread — no status
    // does (INT-007, DD-018) — by the house rule that NULL means live.
    const id = await submit(requesterCookies, "Archived away");
    await harness.db.update(requests).set({ archivedAt: new Date() }).where(eq(requests.id, id));

    const thread = await read(requesterCookies, id);
    expect(thread.statusCode, thread.body).toBe(404);
    const staffThread = await read(memberCookies, id);
    expect(staffThread.statusCode, staffThread.body).toBe(404);
    const posted = await post(requesterCookies, "Anyone there?", "full_thread", id);
    expect(posted.statusCode, posted.body).toBe(404);
  });
});

describe("the portal read", () => {
  it("carries Full Thread only — no row, no id, and no count of the rest", async () => {
    const id = await submit(requesterCookies, "Filtered");
    await post(memberCookies, "Privileged note.", "legal_only", id);
    await post(memberCookies, "Working note.", "working_team", id);
    await post(memberCookies, "We are reviewing it now.", "full_thread", id);

    const staffThread = await read(memberCookies, id);
    expect(staffThread.json().comments).toHaveLength(3);

    const portalThread = await read(requesterCookies, id);
    expect(portalThread.statusCode, portalThread.body).toBe(200);
    expect(bodies(portalThread)).toEqual(["We are reviewing it now."]);
    // Not the text, and not an id either: the row never left the
    // database, so there is nothing here to notice it by.
    expect(portalThread.body).not.toContain("Privileged");
    expect(portalThread.body).not.toContain("Working note");

    // And the badge is counted over that same filtered set (CMT-009):
    // a "3" over a thread showing one would announce what it left out.
    const badge = await unread(requesterCookies, id);
    expect(badge.statusCode, badge.body).toBe(200);
    expect(badge.json().unread).toBe(1);
  });

  it("hides a comment the Requester is not in the room for from the corrections too", async () => {
    const id = await submit(requesterCookies, "Correction leak");
    const posted = await post(memberCookies, "Privileged note.", "legal_only", id);
    const commentId = (posted.json().comment as CommentRow).id;

    // 404 rather than 403: a refusal would say a Legal Only comment is
    // there, which is the one thing DD-016 will not have leak (CMT-008).
    const edited = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/comments/${commentId}`,
      cookies: requesterCookies,
      payload: { body: "Changed." },
    });
    expect(edited.statusCode, edited.body).toBe(404);
  });
});

describe("everybody else", () => {
  it("answers another requester 404 on the read and on the post", async () => {
    const thread = await read(otherCookies);
    expect(thread.statusCode, thread.body).toBe(404);

    const posted = await post(otherCookies, "Butting in.", "full_thread");
    expect(posted.statusCode, posted.body).toBe(404);
  });

  it("answers a Contributor who did not raise it 404 on both", async () => {
    const thread = await read(contributorCookies);
    expect(thread.statusCode, thread.body).toBe(404);

    const posted = await post(contributorCookies, "Butting in.", "full_thread");
    expect(posted.statusCode, posted.body).toBe(404);
  });

  it("keeps a Business User refused on a contract thread", async () => {
    // The reader-role guard is the union across the arms, and the
    // request arm widened it to every role. The contract arm's own list
    // is what refuses, per request, in the same words — so widening the
    // union cannot widen an existing arm (CMT-010).
    const thread = await harness.app.inject({
      method: "GET",
      url: "/api/v1/comments?entityType=contract&entityId=whatever",
      cookies: requesterCookies,
    });
    expect(thread.statusCode, thread.body).toBe(403);
  });
});

describe("who a request comment can address", () => {
  it("offers the Requester and Member+ staff, and nobody else", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments/mention-candidates?entityType=request&entityId=${requestId}`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const candidates = res.json().candidates as { id: string; tiers: string[] }[];
    const byId = new Map(candidates.map((row) => [row.id, row.tiers]));

    // The Requester hears one room; staff hear all three.
    expect(byId.get(userIds.get(REQUESTER.email)!)).toEqual(["full_thread"]);
    expect(byId.get(userIds.get(MEMBER.email)!)).toEqual([
      "legal_only",
      "working_team",
      "full_thread",
    ]);
    // Not the other requester, and not a Contributor with no standing:
    // a name no tier reaches is the trap the confirmation exists to
    // avoid (CMT-007).
    expect(byId.has(userIds.get(OTHER_REQUESTER.email)!)).toBe(false);
    expect(byId.has(userIds.get(CONTRIBUTOR.email)!)).toBe(false);
  });

  it("refuses a mention of somebody this Request does not reach", async () => {
    const refused = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: memberCookies,
      payload: {
        entityType: "request",
        entityId: requestId,
        body: `Have a look, @${CONTRIBUTOR.displayName}`,
        visibility: "full_thread",
        mentions: [userIds.get(CONTRIBUTOR.email)],
      },
    });
    expect(refused.statusCode, refused.body).toBe(400);
  });
});

describe("what the thread writes to the log", () => {
  it("narrates each comment on the Request at the comment's own tier", async () => {
    const id = await submit(requesterCookies, "Narrated");
    const posted = await post(memberCookies, "Privileged note.", "legal_only", id);
    const commentId = (posted.json().comment as CommentRow).id;

    const rows = await harness.db
      .select({
        action: activityLog.action,
        visibility: activityLog.visibility,
        payload: activityLog.payload,
      })
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "request"), eq(activityLog.entityId, id)));
    const entry = rows.find((row) => row.action === "comment.posted");
    expect(entry).toBeDefined();
    // The entry rides the comment's own tier, so it is hidden from
    // exactly the people the comment is hidden from (CMT-006).
    expect(entry!.visibility).toBe("legal_only");
    // Ids only. No comment text ever enters an activity payload.
    expect(entry!.payload).toEqual({ commentId });
    expect(JSON.stringify(entry!.payload)).not.toContain("Privileged");
  });
});
