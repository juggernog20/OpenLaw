// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The comment thread (M9/2) at the HTTP seam: posting at each of the
 * DD-016 tiers, and reading a thread back filtered to what the viewer is
 * in the room for.
 *
 * The central assertion of this suite is the tier filter proved with two
 * real viewers. A Legal Team Member and a Contributor on the same
 * contract read the same record, and their two answers are compared. The
 * Contributor gets no trace of a Legal Only comment — not the text, not
 * an id, not a gap, and no count of what was withheld, because the
 * envelope carries no total at all. Filtering is at query time; the row
 * never leaves the database.
 *
 * The same fact refuses the write: a Contributor is answered 403 on a
 * Legal Only post whatever their client sends, and a Contributor with no
 * `contract_team` row on the record is answered 404, exactly as they
 * would be for a record that does not exist.
 *
 * The tier is immutable after posting (CMT-005), asserted the only way
 * an absence can be: no route on this module accepts a change to one.
 *
 * Posting lands a `comment.posted` activity row at the comment's own
 * tier in the same transaction, asserted by reading the table — the log
 * has no read routes until M9/6.
 *
 * M9/3 adds mentions to the same seam: who a comment addresses is a
 * `comment_mentions` row, and a comment whose mentions outrun its tier
 * is refused here, on a request no confirmation dialog ever saw.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, commentMentions, comments, desc, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** On the contract's team, so the DD-016 tiers have a second audience. */
const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** A Contributor deliberately left off every team. */
const OUTSIDER = {
  email: "outsider@example.com",
  displayName: "Ola Outsider",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let businessCookies: Record<string, string>;
const userIds = new Map<string, string>();

interface CommentRow {
  id: string;
  entityType: string;
  entityId: string;
  author: { id: string; displayName: string; image: string | null; archived: boolean };
  body: string;
  visibility: string;
  mentions: { id: string; displayName: string }[];
  createdAt: string;
}

interface MentionCandidateRow {
  id: string;
  displayName: string;
  image: string | null;
  tiers: string[];
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

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [OUTSIDER, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** A contract with the Contributor on its team — the record every test
 * here talks about, and the only reason the tiers have two audiences. */
async function contractWithTeam(title: string): Promise<{ id: string; number: number }> {
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  const nda = (types.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();

  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: nda!.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract as { id: string; number: number };

  const added = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/team`,
    cookies: adminCookies,
    payload: { userId: userIds.get(CONTRIBUTOR.email), role: "contributor" },
  });
  expect(added.statusCode, added.body).toBe(201);
  return contract;
}

/** A contract nobody but Member+ can reach. */
async function contractWithoutTeam(title: string): Promise<{ id: string; number: number }> {
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  const nda = (types.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  )!;
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: nda.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().contract as { id: string; number: number };
}

const post = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
  harness.app.inject({ method: "POST", url: "/api/v1/comments", cookies, payload });

const readCandidates = (cookies: Record<string, string>, entityId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/mention-candidates?entityType=contract&entityId=${entityId}`,
    cookies,
  });

/** The typeahead's list, requiring success. */
async function candidates(
  cookies: Record<string, string>,
  entityId: string,
): Promise<MentionCandidateRow[]> {
  const res = await readCandidates(cookies, entityId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().candidates as MentionCandidateRow[];
}

const read = (cookies: Record<string, string>, entityId: string, entityType = "contract") =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=${entityType}&entityId=${entityId}`,
    cookies,
  });

/** Posts a comment, requiring success. */
async function comment(
  cookies: Record<string, string>,
  entityId: string,
  body: string,
  visibility: string,
  mentions?: readonly string[],
): Promise<CommentRow> {
  const res = await post(cookies, {
    entityType: "contract",
    entityId,
    body,
    visibility,
    ...(mentions ? { mentions } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().comment as CommentRow;
}

/** The thread as one viewer receives it, requiring success. */
async function thread(cookies: Record<string, string>, entityId: string): Promise<CommentRow[]> {
  const res = await read(cookies, entityId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comments as CommentRow[];
}

describe("posting a comment at a tier", () => {
  it("takes a comment at each of the three tiers and reads them back flat and oldest first", async () => {
    const contract = await contractWithTeam("Tiered thread");
    await comment(memberCookies, contract.id, "Working team first.", "working_team");
    await comment(memberCookies, contract.id, "Legal only second.", "legal_only");
    await comment(memberCookies, contract.id, "Full thread third.", "full_thread");

    const rows = await thread(memberCookies, contract.id);
    expect(rows.map((row) => [row.body, row.visibility])).toEqual([
      ["Working team first.", "working_team"],
      ["Legal only second.", "legal_only"],
      ["Full thread third.", "full_thread"],
    ]);
    expect(rows[0]!.author).toMatchObject({
      id: userIds.get(MEMBER.email),
      displayName: MEMBER.displayName,
      archived: false,
    });
    expect(rows[0]!.entityType).toBe("contract");
    expect(rows[0]!.entityId).toBe(contract.id);
  });

  it("answers an empty thread as an empty list, not as a refusal", async () => {
    const contract = await contractWithTeam("Nothing said yet");
    expect(await thread(memberCookies, contract.id)).toEqual([]);
  });

  it("keeps one record's thread out of another's", async () => {
    const one = await contractWithTeam("Thread one");
    const other = await contractWithTeam("Thread two");
    await comment(memberCookies, one.id, "Only on one.", "working_team");

    expect((await thread(memberCookies, one.id)).map((row) => row.body)).toEqual(["Only on one."]);
    expect(await thread(memberCookies, other.id)).toEqual([]);
  });

  it("refuses an empty body and an unknown tier", async () => {
    const contract = await contractWithTeam("Refused bodies");
    const empty = await post(memberCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "   ",
      visibility: "working_team",
    });
    expect(empty.statusCode, empty.body).toBe(400);

    const tier = await post(memberCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Into a room that does not exist.",
      visibility: "admin_only",
    });
    expect(tier.statusCode, tier.body).toBe(400);
  });

  it("accepts contracts only, though the table admits the full vocabulary", async () => {
    const contract = await contractWithTeam("Contracts only");
    const res = await post(memberCookies, {
      entityType: "matter",
      entityId: contract.id,
      body: "Not yet.",
      visibility: "working_team",
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("answers 404 on a record that does not exist", async () => {
    const missing = await read(memberCookies, "01890000-0000-7000-8000-000000000000");
    expect(missing.statusCode, missing.body).toBe(404);

    const posted = await post(memberCookies, {
      entityType: "contract",
      entityId: "01890000-0000-7000-8000-000000000000",
      body: "Into the void.",
      visibility: "working_team",
    });
    expect(posted.statusCode, posted.body).toBe(404);
  });
});

describe("the DD-016 tier filter, proved with two viewers on one record", () => {
  it("gives a Contributor no trace of a Legal Only comment the Member sees", async () => {
    const contract = await contractWithTeam("Two audiences");
    const working = await comment(
      memberCookies,
      contract.id,
      "Redline goes back Friday.",
      "working_team",
    );
    const legal = await comment(
      memberCookies,
      contract.id,
      "Do not concede past a 1x cap without board sign-off.",
      "legal_only",
    );
    const full = await comment(
      memberCookies,
      contract.id,
      "Signature date is the 14th.",
      "full_thread",
    );

    const memberThread = await thread(memberCookies, contract.id);
    const contributorRes = await read(contributorCookies, contract.id);
    expect(contributorRes.statusCode, contributorRes.body).toBe(200);
    const contributorThread = contributorRes.json().comments as CommentRow[];

    // The same record, read by two people, compared.
    expect(memberThread.map((row) => row.id)).toEqual([working.id, legal.id, full.id]);
    expect(contributorThread.map((row) => row.id)).toEqual([working.id, full.id]);

    // No text, no id, no gap, and no total: the raw body of the answer
    // carries nothing of the withheld comment, and the envelope has no
    // count for a hidden row to be missing from.
    expect(contributorRes.body).not.toContain(legal.id);
    expect(contributorRes.body).not.toContain("board sign-off");
    expect(Object.keys(contributorRes.json())).toEqual(["comments"]);
    expect(contributorThread.every((row) => row.visibility !== "legal_only")).toBe(true);
  });

  it("shows an Administrator every tier, as it shows a Legal Team Member", async () => {
    const contract = await contractWithTeam("Administrator hears all");
    await comment(memberCookies, contract.id, "Strategy.", "legal_only");
    await comment(memberCookies, contract.id, "Coordination.", "working_team");

    expect((await thread(adminCookies, contract.id)).map((row) => row.visibility)).toEqual([
      "legal_only",
      "working_team",
    ]);
  });

  it("lets a Contributor post at Working Team and Full Thread", async () => {
    const contract = await contractWithTeam("Contributor speaks");
    const working = await comment(
      contributorCookies,
      contract.id,
      "Procurement has the PO ready.",
      "working_team",
    );
    const full = await comment(
      contributorCookies,
      contract.id,
      "Sent to the requester.",
      "full_thread",
    );

    expect(working.author.displayName).toBe(CONTRIBUTOR.displayName);
    expect((await thread(contributorCookies, contract.id)).map((row) => row.id)).toEqual([
      working.id,
      full.id,
    ]);
  });

  it("refuses a Contributor the Legal Only tier and writes nothing", async () => {
    const contract = await contractWithTeam("Contributor refused the room");
    const res = await post(contributorCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Into a room I am not in.",
      visibility: "legal_only",
    });
    expect(res.statusCode, res.body).toBe(403);

    const rows = await harness.db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.entityId, contract.id));
    expect(rows).toEqual([]);
  });

  it("answers a Contributor with no team row 404 on both routes", async () => {
    const contract = await contractWithoutTeam("Not their contract");
    await comment(memberCookies, contract.id, "Nothing to see.", "working_team");

    const got = await read(outsiderCookies, contract.id);
    expect(got.statusCode, got.body).toBe(404);

    const posted = await post(outsiderCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Let me in.",
      visibility: "working_team",
    });
    expect(posted.statusCode, posted.body).toBe(404);
  });

  it("refuses a Business User and an unauthenticated request", async () => {
    const contract = await contractWithTeam("Refused outright");
    for (const res of await Promise.all([
      read(businessCookies, contract.id),
      post(businessCookies, {
        entityType: "contract",
        entityId: contract.id,
        body: "Hello?",
        visibility: "full_thread",
      }),
    ])) {
      expect(res.statusCode, res.body).toBe(403);
    }

    const anonymous = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=contract&entityId=${contract.id}`,
    });
    expect(anonymous.statusCode, anonymous.body).toBe(401);
  });
});

describe("a posted comment's tier", () => {
  it("has no route that changes it (CMT-005)", async () => {
    const contract = await contractWithTeam("Immutable tier");
    const posted = await comment(memberCookies, contract.id, "Said in one room.", "legal_only");

    for (const method of ["PATCH", "PUT", "POST"] as const) {
      const res = await harness.app.inject({
        method,
        url: `/api/v1/comments/${posted.id}`,
        cookies: memberCookies,
        payload: { visibility: "full_thread" },
      });
      expect(res.statusCode, `${method} ${res.body}`).toBe(404);
    }

    const [stored] = await harness.db
      .select({ visibility: comments.visibility })
      .from(comments)
      .where(eq(comments.id, posted.id));
    expect(stored!.visibility).toBe("legal_only");
  });

  it("refuses an unknown field on the post body", async () => {
    const contract = await contractWithTeam("Strict body");
    const res = await post(memberCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Sneaking a field in.",
      visibility: "working_team",
      editedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("the activity log", () => {
  it("records comment.posted at the comment's own tier, in the same transaction", async () => {
    const contract = await contractWithTeam("Logged conversation");
    const legal = await comment(memberCookies, contract.id, "Privileged thinking.", "legal_only");
    const full = await comment(
      contributorCookies,
      contract.id,
      "Update for the requester.",
      "full_thread",
    );

    const rows = await harness.db
      .select({
        action: activityLog.action,
        visibility: activityLog.visibility,
        actorId: activityLog.actorId,
        entityType: activityLog.entityType,
        entityId: activityLog.entityId,
        payload: activityLog.payload,
      })
      .from(activityLog)
      .where(eq(activityLog.action, "comment.posted"))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
    const forThisContract = rows.filter((row) => row.entityId === contract.id);

    expect(forThisContract).toEqual([
      {
        action: "comment.posted",
        visibility: "legal_only",
        actorId: userIds.get(MEMBER.email),
        entityType: "contract",
        entityId: contract.id,
        payload: { commentId: legal.id },
      },
      {
        action: "comment.posted",
        visibility: "full_thread",
        actorId: userIds.get(CONTRIBUTOR.email),
        entityType: "contract",
        entityId: contract.id,
        payload: { commentId: full.id },
      },
    ]);
  });

  it("keeps comment text out of the payload, so a redact can remove it", async () => {
    const contract = await contractWithTeam("No text in the log");
    await comment(memberCookies, contract.id, "Text that must stay redactable.", "working_team");

    const [row] = await harness.db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.entityId, contract.id))
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    expect(JSON.stringify(row!.payload)).not.toContain("redactable");
  });

  it("writes no activity row when the post is refused", async () => {
    const contract = await contractWithTeam("Refused, unlogged");
    const res = await post(contributorCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Refused.",
      visibility: "legal_only",
    });
    expect(res.statusCode, res.body).toBe(403);

    // Creating the contract and adding the Contributor are logged; a
    // refused post is not, because nothing was said.
    const posted = await harness.db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(and(eq(activityLog.action, "comment.posted"), eq(activityLog.entityId, contract.id)));
    expect(posted).toEqual([]);
  });
});

describe("the entity reference", () => {
  it("refuses an empty or oversized id before it reaches a query", async () => {
    for (const entityId of ["", "x".repeat(65)]) {
      const res = await read(memberCookies, encodeURIComponent(entityId));
      expect(res.statusCode, res.body).toBe(400);
    }
    const posted = await post(memberCookies, {
      entityType: "contract",
      entityId: "",
      body: "Nowhere to put this.",
      visibility: "working_team",
    });
    expect(posted.statusCode, posted.body).toBe(400);
  });

  it("answers a well-formed id for a record that does not exist with 404, not 400", async () => {
    // The bound refuses junk; it does not rule on what an id looks like,
    // so an unknown one is still "no record here".
    const res = await read(memberCookies, "not-a-uuid-but-plausible");
    expect(res.statusCode, res.body).toBe(404);
  });
});

/**
 * Mentions and tier promotion (M9/3).
 *
 * The mentioned people are a list, so these tests read the
 * `comment_mentions` table rather than the body. And the promotion rule
 * is proved where it has to hold: at the seam, on a request no dialog
 * ever saw. A Legal Only comment naming a Contributor is refused,
 * whatever the client sends — the confirmation in the composer explains
 * the promotion, it does not enforce it.
 *
 * The typeahead's list is the tier predicate run over people instead of
 * rows (CMT-007). Somebody no tier on the record reaches — a Contributor
 * with no team row, a Business User, an archived person — is left out of
 * it, because offering a name a mention cannot reach is the trap the
 * confirmation exists to avoid.
 */
describe("who a comment on a record can address", () => {
  it("offers Member+ and the Contributors on the team, each with the tiers they hear", async () => {
    const contract = await contractWithTeam("Who can be named");
    const list = await candidates(memberCookies, contract.id);

    expect(list.map((row) => [row.displayName, row.tiers])).toEqual([
      [ADMIN.displayName, ["legal_only", "working_team", "full_thread"]],
      [CONTRIBUTOR.displayName, ["working_team", "full_thread"]],
      [MEMBER.displayName, ["legal_only", "working_team", "full_thread"]],
    ]);
  });

  it("leaves out a Contributor with no team row, and a Business User", async () => {
    const contract = await contractWithTeam("Nobody a mention can reach");
    const named = (await candidates(memberCookies, contract.id)).map((row) => row.id);

    // Read out first: `not.toContain(undefined)` would pass on a
    // fixture that never got provisioned, which is not the assertion.
    const outsider = userIds.get(OUTSIDER.email);
    const business = userIds.get(BUSINESS.email);
    expect(outsider).toBeDefined();
    expect(business).toBeDefined();
    expect(named).not.toContain(outsider);
    expect(named).not.toContain(business);
  });

  it("gives a Contributor on the team the same list, all of it reachable at Working Team", async () => {
    const contract = await contractWithTeam("Contributor's typeahead");
    const theirs = await candidates(contributorCookies, contract.id);
    const ours = await candidates(memberCookies, contract.id);
    expect(theirs).toEqual(ours);
    // Which is why a Contributor's typeahead can never produce a mention
    // that would need Legal Only: everyone it offers hears Working Team,
    // and Working Team is a segment their composer has.
    expect(theirs.every((row) => row.tiers.includes("working_team"))).toBe(true);
  });

  it("answers 404 on a record the viewer cannot reach", async () => {
    const contract = await contractWithoutTeam("Not their record");
    const res = await readCandidates(outsiderCookies, contract.id);
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("posting a comment that names someone", () => {
  it("writes one comment_mentions row per person, keyed on comment and user", async () => {
    const contract = await contractWithTeam("Named on the record");
    const posted = await comment(
      memberCookies,
      contract.id,
      `@${CONTRIBUTOR.displayName} @${ADMIN.displayName} can one of you take the redline?`,
      "working_team",
      [userIds.get(CONTRIBUTOR.email)!, userIds.get(ADMIN.email)!],
    );

    const rows = await harness.db
      .select({ commentId: commentMentions.commentId, userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, posted.id))
      .orderBy(asc(commentMentions.userId));
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [userIds.get(CONTRIBUTOR.email)!, userIds.get(ADMIN.email)!].sort(),
    );
    expect(rows.every((row) => row.commentId === posted.id)).toBe(true);
  });

  it("collapses a repeated name into one row", async () => {
    const contract = await contractWithTeam("Named twice");
    const casey = userIds.get(CONTRIBUTOR.email)!;
    const posted = await comment(
      memberCookies,
      contract.id,
      `@${CONTRIBUTOR.displayName}, and again @${CONTRIBUTOR.displayName}.`,
      "working_team",
      [casey, casey],
    );

    const rows = await harness.db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, posted.id));
    expect(rows).toEqual([{ userId: casey }]);
  });

  it("carries the mentioned people out on the post and on the next read", async () => {
    const contract = await contractWithTeam("Mentions come back");
    const posted = await comment(
      memberCookies,
      contract.id,
      `@${CONTRIBUTOR.displayName} over to you.`,
      "working_team",
      [userIds.get(CONTRIBUTOR.email)!],
    );
    expect(posted.mentions).toEqual([
      { id: userIds.get(CONTRIBUTOR.email), displayName: CONTRIBUTOR.displayName },
    ]);

    const [row] = await thread(memberCookies, contract.id);
    expect(row!.mentions).toEqual(posted.mentions);
  });

  it("carries an empty list for a comment that names nobody", async () => {
    const contract = await contractWithTeam("Nobody named");
    const posted = await comment(memberCookies, contract.id, "Just thinking aloud.", "legal_only");
    expect(posted.mentions).toEqual([]);
  });
});

describe("the promotion rule, enforced at the seam", () => {
  it("refuses a Legal Only comment that names a Contributor, and writes nothing", async () => {
    const contract = await contractWithTeam("Mention outruns the tier");
    // Posted straight at the seam. No confirmation was shown, and none
    // is what makes this refusal hold.
    const res = await post(memberCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: `@${CONTRIBUTOR.displayName} what did procurement say?`,
      visibility: "legal_only",
      mentions: [userIds.get(CONTRIBUTOR.email)],
    });
    expect(res.statusCode, res.body).toBe(403);
    // The refusal names the person, so the client can say who.
    expect(res.json().detail).toContain(CONTRIBUTOR.displayName);

    expect(
      await harness.db
        .select({ id: comments.id })
        .from(comments)
        .where(eq(comments.entityId, contract.id)),
    ).toEqual([]);
    expect(
      await harness.db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(
          and(eq(activityLog.action, "comment.posted"), eq(activityLog.entityId, contract.id)),
        ),
    ).toEqual([]);
  });

  it("takes the same comment at the narrowest tier that includes them", async () => {
    const contract = await contractWithTeam("Promoted and posted");
    const posted = await comment(
      memberCookies,
      contract.id,
      `@${CONTRIBUTOR.displayName} what did procurement say?`,
      "working_team",
      [userIds.get(CONTRIBUTOR.email)!],
    );
    expect(posted.visibility).toBe("working_team");

    const [stored] = await harness.db
      .select({ visibility: comments.visibility })
      .from(comments)
      .where(eq(comments.id, posted.id));
    expect(stored!.visibility).toBe("working_team");
  });

  it("takes a Legal Only comment that names a Legal Team Member", async () => {
    const contract = await contractWithTeam("Both in the room");
    const posted = await comment(
      memberCookies,
      contract.id,
      `@${ADMIN.displayName} hold the 1x cap.`,
      "legal_only",
      [userIds.get(ADMIN.email)!],
    );
    expect(posted.visibility).toBe("legal_only");
  });

  it("refuses a mention of somebody no tier on the record reaches", async () => {
    const contract = await contractWithTeam("Unreachable name");
    for (const stranger of [OUTSIDER, BUSINESS]) {
      const res = await post(memberCookies, {
        entityType: "contract",
        entityId: contract.id,
        body: `@${stranger.displayName} are you across this?`,
        visibility: "full_thread",
        mentions: [userIds.get(stranger.email)],
      });
      expect(res.statusCode, res.body).toBe(400);
    }

    expect(
      await harness.db
        .select({ id: comments.id })
        .from(comments)
        .where(eq(comments.entityId, contract.id)),
    ).toEqual([]);
  });

  it("refuses a mention of an id that names nobody", async () => {
    const contract = await contractWithTeam("Ghost mention");
    const res = await post(memberCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Addressed to nobody.",
      visibility: "working_team",
      mentions: ["01890000-0000-7000-8000-000000000000"],
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses more names than one comment may carry", async () => {
    const contract = await contractWithTeam("Too many names");
    const res = await post(memberCookies, {
      entityType: "contract",
      entityId: contract.id,
      body: "Everyone.",
      visibility: "working_team",
      mentions: Array.from({ length: 21 }, () => userIds.get(CONTRIBUTOR.email)),
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});
