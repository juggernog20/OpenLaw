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
 *
 * M9/4 adds the three corrections. Two assertions carry that slice, and
 * both read tables rather than calls. No activity payload written by any
 * comment path contains body text, because the log is append-only and
 * text in it could never be taken out again. And a hard redact clears
 * the body **and** every revision row, so the text is genuinely gone
 * rather than moved somewhere quieter.
 *
 * M9/5 adds the unread badge, and it is the tier filter again in a
 * second shape. Two viewers with different tier reach hold different
 * counts on one record at the same time, and each count is checked
 * against the thread that viewer actually receives — a badge that
 * counted a Legal Only comment would announce the conversation the
 * thread is at pains to hide.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  commentLastRead,
  commentMentions,
  commentRevisions,
  comments,
  desc,
  eq,
  users,
} from "@openlaw/db";
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
  editedAt: string | null;
  deletedAt: string | null;
  redactedAt: string | null;
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
});

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

/** The badge (M9/5), as raw responses: what the icon shows, and what
 * opening the panel does to it. */
const readUnread = (cookies: Record<string, string>, entityId: string, entityType = "contract") =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/unread?entityType=${entityType}&entityId=${entityId}`,
    cookies,
  });

const markRead = (cookies: Record<string, string>, entityId: string, entityType = "contract") =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/comments/read",
    cookies,
    payload: { entityType, entityId },
  });

/** The badge one viewer's icon would carry, requiring success. */
async function unread(cookies: Record<string, string>, entityId: string): Promise<number> {
  const res = await readUnread(cookies, entityId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().unread as number;
}

/** Opening the panel, requiring success — it answers the count that
 * remains, which is what the badge takes. */
async function openPanel(cookies: Record<string, string>, entityId: string): Promise<number> {
  const res = await markRead(cookies, entityId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().unread as number;
}

/** The three corrections (M9/4), as raw responses. */
const patch = (cookies: Record<string, string>, commentId: string, body: unknown) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/comments/${commentId}`,
    cookies,
    payload: { body },
  });

const remove = (cookies: Record<string, string>, commentId: string) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/comments/${commentId}`, cookies });

const redact = (cookies: Record<string, string>, commentId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/comments/${commentId}/redact`,
    cookies,
  });

/** Each of the three, requiring success. */
async function edit(
  cookies: Record<string, string>,
  commentId: string,
  body: string,
): Promise<CommentRow> {
  const res = await patch(cookies, commentId, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comment as CommentRow;
}

async function softDelete(cookies: Record<string, string>, commentId: string): Promise<CommentRow> {
  const res = await remove(cookies, commentId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comment as CommentRow;
}

async function hardRedact(cookies: Record<string, string>, commentId: string): Promise<CommentRow> {
  const res = await redact(cookies, commentId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comment as CommentRow;
}

/** What a comment used to say, oldest first — the table a redact purges. */
async function revisions(commentId: string): Promise<string[]> {
  const rows = await harness.db
    .select({ body: commentRevisions.body })
    .from(commentRevisions)
    .where(eq(commentRevisions.commentId, commentId))
    .orderBy(asc(commentRevisions.replacedAt), asc(commentRevisions.id));
  return rows.map((row) => row.body);
}

/** The comment as the database holds it, which is where a tombstone has
 * to be proved: an empty body in the row is a body no read seam has. */
async function storedComment(commentId: string) {
  const [row] = await harness.db
    .select({
      body: comments.body,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      redactedAt: comments.redactedAt,
    })
    .from(comments)
    .where(eq(comments.id, commentId));
  return row;
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

  it("refuses entity types with no audience arm, though the table admits them", async () => {
    const contract = await contractWithTeam("No document arm");
    const res = await post(memberCookies, {
      entityType: "document",
      entityId: contract.id,
      body: "No thread here.",
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
    // The cursor CTR-024 added is a position, not a number: it says
    // where the page before this one starts and nothing about how many
    // comments are there. And it is null here, because both viewers'
    // threads fit one page — so it cannot differ between the two and
    // announce the row one of them was not given.
    expect(Object.keys(contributorRes.json())).toEqual(["comments", "nextCursor"]);
    expect(contributorRes.json().nextCursor).toBeNull();
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

    // The edit route is the only one that takes a body on a comment, and
    // its body is strict, so a tier cannot ride in beside the text. PUT
    // and POST on the comment reach no route at all.
    const edit = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/comments/${posted.id}`,
      cookies: memberCookies,
      payload: { body: "Moved rooms.", visibility: "full_thread" },
    });
    expect(edit.statusCode, edit.body).toBe(400);

    for (const method of ["PUT", "POST"] as const) {
      const res = await harness.app.inject({
        method,
        url: `/api/v1/comments/${posted.id}`,
        cookies: memberCookies,
        payload: { visibility: "full_thread" },
      });
      expect(res.statusCode, `${method} ${res.body}`).toBe(404);
    }

    const [stored] = await harness.db
      .select({ visibility: comments.visibility, body: comments.body })
      .from(comments)
      .where(eq(comments.id, posted.id));
    // The refused edit wrote neither the tier nor the text.
    expect(stored!.visibility).toBe("legal_only");
    expect(stored!.body).toBe("Said in one room.");
  });

  it("stays where it was posted when the author edits the text", async () => {
    const contract = await contractWithTeam("Edit keeps the room");
    const posted = await comment(memberCookies, contract.id, "First wording.", "legal_only");
    const edited = await edit(memberCookies, posted.id, "Second wording.");

    expect(edited.body).toBe("Second wording.");
    expect(edited.visibility).toBe("legal_only");

    // A Contributor on the team still gets no trace of it.
    expect(await thread(contributorCookies, contract.id)).toEqual([]);
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

/**
 * Editing, soft deleting, and hard redacting (M9/4).
 *
 * Three corrections, three owners. An edit and a soft delete belong to
 * the author, and an Administrator is no exception to that — a
 * correction to somebody else's words is a redact, not an edit. The
 * redact belongs to the Administrator alone.
 *
 * The prior text lives in `comment_revisions` and nowhere else
 * (CMT-006), which is exactly what lets a redact take it away. These
 * tests read that table, and they read `comments.body`, because the
 * point of a soft delete is that the row no longer carries the text at
 * all — a tombstone that still held it would be one query from leaking.
 */
describe("an author editing their own comment", () => {
  it("changes the text, marks the row edited, and keeps the prior body as a revision", async () => {
    const contract = await contractWithTeam("Edited by its author");
    const posted = await comment(
      memberCookies,
      contract.id,
      "Redline goes back Thusday.",
      "working_team",
    );
    expect(posted.editedAt).toBeNull();

    const edited = await edit(memberCookies, posted.id, "Redline goes back Thursday.");
    expect(edited.body).toBe("Redline goes back Thursday.");
    expect(edited.editedAt).not.toBeNull();
    expect(edited.deletedAt).toBeNull();

    // The next reader sees the new text and the marker with it.
    const [row] = await thread(memberCookies, contract.id);
    expect(row!.body).toBe("Redline goes back Thursday.");
    expect(row!.editedAt).toBe(edited.editedAt);

    expect(await revisions(posted.id)).toEqual(["Redline goes back Thusday."]);
  });

  it("keeps one revision per edit, oldest first", async () => {
    const contract = await contractWithTeam("Edited twice");
    const posted = await comment(memberCookies, contract.id, "First.", "working_team");
    await edit(memberCookies, posted.id, "Second.");
    await edit(memberCookies, posted.id, "Third.");

    expect(await revisions(posted.id)).toEqual(["First.", "Second."]);
    expect((await storedComment(posted.id))!.body).toBe("Third.");
  });

  it("writes nothing when the text is saved unchanged", async () => {
    const contract = await contractWithTeam("Saved unchanged");
    const posted = await comment(memberCookies, contract.id, "As it was.", "working_team");
    const same = await edit(memberCookies, posted.id, "As it was.");

    // No marker, because nothing was edited.
    expect(same.editedAt).toBeNull();
    expect(await revisions(posted.id)).toEqual([]);
    expect(
      await harness.db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(
          and(eq(activityLog.action, "comment.edited"), eq(activityLog.entityId, contract.id)),
        ),
    ).toEqual([]);
  });

  it("refuses a non-author, including an Administrator, and writes nothing", async () => {
    const contract = await contractWithTeam("Not yours to edit");
    const posted = await comment(memberCookies, contract.id, "My own words.", "working_team");

    for (const cookies of [adminCookies, contributorCookies]) {
      const res = await patch(cookies, posted.id, "Words I am putting in your mouth.");
      expect(res.statusCode, res.body).toBe(403);
    }

    const stored = await storedComment(posted.id);
    expect(stored!.body).toBe("My own words.");
    expect(stored!.editedAt).toBeNull();
    expect(await revisions(posted.id)).toEqual([]);
  });

  it("refuses an empty body", async () => {
    const contract = await contractWithTeam("Edited to nothing");
    const posted = await comment(memberCookies, contract.id, "Something.", "working_team");
    const res = await patch(memberCookies, posted.id, "   ");
    expect(res.statusCode, res.body).toBe(400);
    expect((await storedComment(posted.id))!.body).toBe("Something.");
  });

  it("answers 404 on a comment the viewer is not in the room for", async () => {
    const contract = await contractWithTeam("Legal only, out of reach");
    const posted = await comment(memberCookies, contract.id, "Privileged.", "legal_only");

    // 404 and not 403: a refusal would tell a Contributor that a Legal
    // Only comment is there, which is the leak DD-016 exists to prevent.
    for (const res of await Promise.all([
      patch(contributorCookies, posted.id, "Not mine to touch."),
      remove(contributorCookies, posted.id),
    ])) {
      expect(res.statusCode, res.body).toBe(404);
    }
  });

  it("answers 404 on a comment id that names nothing", async () => {
    const res = await patch(
      memberCookies,
      "01890000-0000-7000-8000-000000000000",
      "Into the void.",
    );
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("an author soft-deleting their own comment", () => {
  it("leaves a tombstone in place with no body, and moves the text to a revision", async () => {
    const contract = await contractWithTeam("Tombstone holds its place");
    const first = await comment(memberCookies, contract.id, "Before.", "working_team");
    const doomed = await comment(memberCookies, contract.id, "Said in error.", "working_team");
    const last = await comment(memberCookies, contract.id, "After.", "working_team");

    const tombstone = await softDelete(memberCookies, doomed.id);
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.body).toBe("");

    // Nothing above or below shifted: the thread still reads.
    const rows = await thread(memberCookies, contract.id);
    expect(rows.map((row) => row.id)).toEqual([first.id, doomed.id, last.id]);
    expect(rows.map((row) => row.body)).toEqual(["Before.", "", "After."]);

    expect((await storedComment(doomed.id))!.body).toBe("");
    expect(await revisions(doomed.id)).toEqual(["Said in error."]);
  });

  it("puts the body beyond every read seam, raw response included", async () => {
    const contract = await contractWithTeam("Unreadable once deleted");
    const posted = await comment(
      memberCookies,
      contract.id,
      "The number nobody should have seen.",
      "working_team",
    );
    await softDelete(memberCookies, posted.id);

    for (const cookies of [memberCookies, adminCookies, contributorCookies]) {
      const res = await read(cookies, contract.id);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain("nobody should have seen");
    }
  });

  it("refuses a non-author, including an Administrator", async () => {
    const contract = await contractWithTeam("Not yours to delete");
    const posted = await comment(memberCookies, contract.id, "Mine to take back.", "working_team");

    for (const cookies of [adminCookies, contributorCookies]) {
      const res = await remove(cookies, posted.id);
      expect(res.statusCode, res.body).toBe(403);
    }
    expect((await storedComment(posted.id))!.deletedAt).toBeNull();
  });

  it("refuses an edit of a comment already deleted", async () => {
    const contract = await contractWithTeam("Edited after the fact");
    const posted = await comment(memberCookies, contract.id, "Gone.", "working_team");
    await softDelete(memberCookies, posted.id);

    const res = await patch(memberCookies, posted.id, "Back again.");
    expect(res.statusCode, res.body).toBe(409);
    expect((await storedComment(posted.id))!.body).toBe("");
  });

  it("writes nothing on a second delete", async () => {
    const contract = await contractWithTeam("Deleted twice");
    const posted = await comment(memberCookies, contract.id, "Once said.", "working_team");
    const first = await softDelete(memberCookies, posted.id);
    const second = await softDelete(memberCookies, posted.id);

    expect(second.deletedAt).toBe(first.deletedAt);
    expect(await revisions(posted.id)).toEqual(["Once said."]);
    expect(
      await harness.db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(
          and(eq(activityLog.action, "comment.deleted"), eq(activityLog.entityId, contract.id)),
        ),
    ).toHaveLength(1);
  });
});

describe("an Administrator hard-redacting a comment", () => {
  it("clears the body and every revision row, so the text is genuinely gone", async () => {
    const contract = await contractWithTeam("Redacted for good");
    const posted = await comment(
      memberCookies,
      contract.id,
      "Patient record pasted into the wrong contract.",
      "working_team",
    );
    // Edited and then deleted first, so there is more than one place the
    // text could still be sitting when the redact runs.
    await edit(memberCookies, posted.id, "Patient record, second paste.");
    await softDelete(memberCookies, posted.id);
    expect(await revisions(posted.id)).toEqual([
      "Patient record pasted into the wrong contract.",
      "Patient record, second paste.",
    ]);

    const redacted = await hardRedact(adminCookies, posted.id);
    expect(redacted.redactedAt).not.toBeNull();
    expect(redacted.body).toBe("");

    // The two places the text lived, both empty.
    expect((await storedComment(posted.id))!.body).toBe("");
    expect(await revisions(posted.id)).toEqual([]);

    // And nowhere else in the system either.
    const seam = await read(memberCookies, contract.id);
    expect(seam.body).not.toContain("Patient record");
    const log = await harness.db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.entityId, contract.id));
    expect(JSON.stringify(log)).not.toContain("Patient record");
  });

  it("redacts a live comment too, and keeps the row as a tombstone", async () => {
    const contract = await contractWithTeam("Redacted while live");
    const first = await comment(memberCookies, contract.id, "Before.", "working_team");
    const posted = await comment(memberCookies, contract.id, "Wrong record.", "working_team");

    const redacted = await hardRedact(adminCookies, posted.id);
    // An author's tombstone and an Administrator's are different acts,
    // so the row says which one happened.
    expect(redacted.deletedAt).toBeNull();
    expect(redacted.redactedAt).not.toBeNull();

    expect((await thread(memberCookies, contract.id)).map((row) => row.id)).toEqual([
      first.id,
      posted.id,
    ]);
  });

  it("takes the list of who the text named away with it", async () => {
    const contract = await contractWithTeam("Redacted with its mentions");
    const posted = await comment(
      memberCookies,
      contract.id,
      `@${CONTRIBUTOR.displayName} see the note above.`,
      "working_team",
      [userIds.get(CONTRIBUTOR.email)!],
    );

    const redacted = await hardRedact(adminCookies, posted.id);
    expect(redacted.mentions).toEqual([]);
    expect(
      await harness.db
        .select({ userId: commentMentions.userId })
        .from(commentMentions)
        .where(eq(commentMentions.commentId, posted.id)),
    ).toEqual([]);
  });

  it("refuses a Legal Team Member, a Contributor, and a Business User, and writes nothing", async () => {
    const contract = await contractWithTeam("Redact refused");
    const posted = await comment(memberCookies, contract.id, "Still here.", "working_team");

    for (const cookies of [memberCookies, contributorCookies, businessCookies]) {
      const res = await redact(cookies, posted.id);
      expect(res.statusCode, res.body).toBe(403);
    }
    const stored = await storedComment(posted.id);
    expect(stored!.body).toBe("Still here.");
    expect(stored!.redactedAt).toBeNull();
  });

  it("writes nothing on a second redact", async () => {
    const contract = await contractWithTeam("Redacted twice");
    const posted = await comment(memberCookies, contract.id, "Once.", "working_team");
    const first = await hardRedact(adminCookies, posted.id);
    const second = await hardRedact(adminCookies, posted.id);

    expect(second.redactedAt).toBe(first.redactedAt);
    expect(
      await harness.db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(
          and(eq(activityLog.action, "comment.redacted"), eq(activityLog.entityId, contract.id)),
        ),
    ).toHaveLength(1);
  });
});

/**
 * The tier predicate does not loosen because a comment was corrected.
 * A tombstone is still the comment it stands for, so it reaches exactly
 * the audience the comment reached and no wider one.
 */
describe("a corrected comment's audience", () => {
  it("keeps a deleted and a redacted Legal Only comment out of a Contributor's thread", async () => {
    const contract = await contractWithTeam("Tombstones obey the tier");
    const deleted = await comment(memberCookies, contract.id, "Strategy one.", "legal_only");
    const redacted = await comment(memberCookies, contract.id, "Strategy two.", "legal_only");
    const seen = await comment(memberCookies, contract.id, "Coordination.", "working_team");
    await softDelete(memberCookies, deleted.id);
    await hardRedact(adminCookies, redacted.id);

    // The Member still has all three, two of them as tombstones.
    expect((await thread(memberCookies, contract.id)).map((row) => row.id)).toEqual([
      deleted.id,
      redacted.id,
      seen.id,
    ]);

    // The Contributor has the one they were always in the room for.
    const contributorRes = await read(contributorCookies, contract.id);
    expect(contributorRes.statusCode, contributorRes.body).toBe(200);
    expect((contributorRes.json().comments as CommentRow[]).map((row) => row.id)).toEqual([
      seen.id,
    ]);
    expect(contributorRes.body).not.toContain(deleted.id);
    expect(contributorRes.body).not.toContain(redacted.id);
  });

  it("logs each correction at the comment's own tier", async () => {
    const contract = await contractWithTeam("Corrections keep the room");
    const posted = await comment(memberCookies, contract.id, "First.", "legal_only");
    await edit(memberCookies, posted.id, "Second.");
    await softDelete(memberCookies, posted.id);
    await hardRedact(adminCookies, posted.id);

    const rows = await harness.db
      .select({
        action: activityLog.action,
        visibility: activityLog.visibility,
        actorId: activityLog.actorId,
        payload: activityLog.payload,
      })
      .from(activityLog)
      .where(eq(activityLog.entityId, contract.id))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

    expect(rows.filter((row) => row.action.startsWith("comment."))).toEqual([
      {
        action: "comment.posted",
        visibility: "legal_only",
        actorId: userIds.get(MEMBER.email),
        payload: { commentId: posted.id },
      },
      {
        action: "comment.edited",
        visibility: "legal_only",
        actorId: userIds.get(MEMBER.email),
        payload: { commentId: posted.id },
      },
      {
        action: "comment.deleted",
        visibility: "legal_only",
        actorId: userIds.get(MEMBER.email),
        payload: { commentId: posted.id },
      },
      {
        action: "comment.redacted",
        visibility: "legal_only",
        actorId: userIds.get(ADMIN.email),
        payload: { commentId: posted.id },
      },
    ]);
  });
});

/**
 * The load-bearing assertion of this slice, and the reason
 * `comment_revisions` exists (CMT-006).
 *
 * DD-017 forbids `UPDATE` and `DELETE` on `activity_log`. Text that
 * enters a payload can therefore never leave it, and a redact would
 * remove the comment while leaving what it said sitting in the log. So
 * no comment body text ever enters a payload — asserted by reading every
 * row the table holds for the record, not by watching what a call was
 * given.
 */
describe("no comment path writes body text into an activity payload", () => {
  it("keeps every distinctive word of every version out of the log", async () => {
    const contract = await contractWithTeam("Nothing quotable in the log");
    const words = ["zephyrine", "quartzose", "brumalis", "halcyonic"];

    // Every comment path in the module, each with its own word.
    const posted = await comment(
      memberCookies,
      contract.id,
      `A ${words[0]} first draft.`,
      "working_team",
    );
    await edit(memberCookies, posted.id, `A ${words[1]} second draft.`);
    const deleted = await comment(
      memberCookies,
      contract.id,
      `A ${words[2]} mistake.`,
      "legal_only",
    );
    await softDelete(memberCookies, deleted.id);
    const wrong = await comment(
      contributorCookies,
      contract.id,
      `A ${words[3]} paste into the wrong record.`,
      "full_thread",
    );
    await hardRedact(adminCookies, wrong.id);

    const rows = await harness.db
      .select({ action: activityLog.action, payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.entityId, contract.id));

    // Every comment verb this slice adds is in the log, so the assertion
    // below is over a set that actually contains them.
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set([
        "contract.created",
        "contract.team_added",
        "comment.posted",
        "comment.edited",
        "comment.deleted",
        "comment.redacted",
      ]),
    );
    const payloads = JSON.stringify(rows.map((row) => row.payload));
    for (const word of words) expect(payloads).not.toContain(word);
  });
});

/**
 * The unread badge (M9/5, CMT-004, CMT-009).
 *
 * The load-bearing test is two viewers with different tier reach holding
 * different counts on the same record at the same time. A count is a
 * leak like any other: if the Contributor's badge counted the Legal Only
 * comment, the badge would announce a conversation the thread is at
 * pains to hide. So each viewer's count is compared against the thread
 * that viewer actually receives, and the two are compared against each
 * other.
 */
describe("the unread badge", () => {
  it("gives two viewers with different tier reach different counts on one record", async () => {
    const contract = await contractWithTeam("Two badges, one record");
    // Posted by the Administrator, so neither viewer below is the author
    // of any of them — their own comments would not be news.
    await comment(adminCookies, contract.id, "Working team first.", "working_team");
    await comment(adminCookies, contract.id, "Legal only second.", "legal_only");
    await comment(adminCookies, contract.id, "Full thread third.", "full_thread");

    const memberUnread = await unread(memberCookies, contract.id);
    const contributorUnread = await unread(contributorCookies, contract.id);

    // Neither has opened the panel, so everything each can see is
    // unread — which makes the count exactly the size of their thread.
    expect(memberUnread).toBe(3);
    expect(contributorUnread).toBe(2);
    expect(memberUnread).toBe((await thread(memberCookies, contract.id)).length);
    expect(contributorUnread).toBe((await thread(contributorCookies, contract.id)).length);
  });

  it("never counts the viewer's own comments", async () => {
    const contract = await contractWithTeam("Own words are not news");
    await comment(memberCookies, contract.id, "Mine, and I know it.", "working_team");
    await comment(memberCookies, contract.id, "Mine again.", "legal_only");
    await comment(adminCookies, contract.id, "Somebody else's.", "working_team");

    // The Member wrote two of the three and hears all three.
    expect(await unread(memberCookies, contract.id)).toBe(1);
    // The Administrator wrote one of the three and hears all three.
    expect(await unread(adminCookies, contract.id)).toBe(2);
  });

  it("clears when the panel is opened, and counts what is said afterwards", async () => {
    const contract = await contractWithTeam("Open, then something new");
    await comment(adminCookies, contract.id, "Before you looked.", "working_team");
    expect(await unread(memberCookies, contract.id)).toBe(1);

    // Opening the panel answers the count that remains, and it is the
    // count the next read agrees with.
    expect(await openPanel(memberCookies, contract.id)).toBe(0);
    expect(await unread(memberCookies, contract.id)).toBe(0);

    await comment(adminCookies, contract.id, "After you looked.", "legal_only");
    expect(await unread(memberCookies, contract.id)).toBe(1);

    // Opening it a second time moves the same watermark rather than
    // adding a second one — the reader has one place in one conversation.
    expect(await openPanel(memberCookies, contract.id)).toBe(0);
    const rows = await harness.db
      .select({ readAt: commentLastRead.readAt })
      .from(commentLastRead)
      .where(
        and(
          eq(commentLastRead.userId, userIds.get(MEMBER.email)!),
          eq(commentLastRead.entityId, contract.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("clears one viewer's badge without touching the other's", async () => {
    const contract = await contractWithTeam("Two watermarks");
    await comment(adminCookies, contract.id, "Working team first.", "working_team");
    await comment(adminCookies, contract.id, "Legal only second.", "legal_only");

    expect(await openPanel(contributorCookies, contract.id)).toBe(0);

    // One reader's place in the conversation is their own.
    expect(await unread(contributorCookies, contract.id)).toBe(0);
    expect(await unread(memberCookies, contract.id)).toBe(2);

    const rows = await harness.db
      .select({ userId: commentLastRead.userId })
      .from(commentLastRead)
      .where(eq(commentLastRead.entityId, contract.id));
    expect(rows.map((row) => row.userId)).toEqual([userIds.get(CONTRIBUTOR.email)]);
  });

  it("does not let a soft-deleted or redacted comment inflate the count", async () => {
    const contract = await contractWithTeam("Tombstones count for nothing");
    const withdrawn = await comment(adminCookies, contract.id, "Said in error.", "working_team");
    const misplaced = await comment(adminCookies, contract.id, "Wrong record.", "working_team");
    const standing = await comment(adminCookies, contract.id, "Still stands.", "working_team");

    // The author takes one back; an Administrator removes another for
    // good. Both keep their place in the thread as tombstones.
    await softDelete(adminCookies, withdrawn.id);
    await hardRedact(adminCookies, misplaced.id);

    expect((await thread(memberCookies, contract.id)).map((row) => row.id)).toEqual([
      withdrawn.id,
      misplaced.id,
      standing.id,
    ]);
    // Three rows in the thread, one thing left to read.
    expect(await unread(memberCookies, contract.id)).toBe(1);
  });

  it("answers 404 on a record the viewer cannot reach, and 403 to a Business User", async () => {
    const contract = await contractWithoutTeam("No badge for the outsider");
    await comment(adminCookies, contract.id, "Nothing for you here.", "working_team");

    expect((await readUnread(outsiderCookies, contract.id)).statusCode).toBe(404);
    expect((await markRead(outsiderCookies, contract.id)).statusCode).toBe(404);
    expect((await readUnread(businessCookies, contract.id)).statusCode).toBe(403);
    expect((await markRead(businessCookies, contract.id)).statusCode).toBe(403);

    // And a record that cannot be reached leaves no watermark behind.
    const rows = await harness.db
      .select({ userId: commentLastRead.userId })
      .from(commentLastRead)
      .where(eq(commentLastRead.entityId, contract.id));
    expect(rows).toEqual([]);
  });
});

/**
 * The bound on one thread (CTR-024).
 *
 * A thread grows for as long as the record lives, so it is paged like
 * the lists it hangs beside. The direction is the difference: a page is
 * the **newest** end, answered oldest-first inside itself, and the
 * cursor walks backwards. The panel opens on the conversation as it
 * stands, and a two-year thread does not arrive in one response.
 */
describe("the bounded comment thread (CTR-024)", () => {
  const PAGE = 50;

  const readPage = (cookies: Record<string, string>, entityId: string, cursor?: string) =>
    harness.app.inject({
      method: "GET",
      url:
        `/api/v1/comments?entityType=contract&entityId=${entityId}` +
        (cursor === undefined ? "" : `&cursor=${cursor}`),
      cookies,
    });

  let contract: { id: string; number: number };
  /** Every comment on it, oldest first, as they were posted. */
  const posted: CommentRow[] = [];

  beforeAll(async () => {
    contract = await contractWithTeam("Paging: the long conversation");
    for (let said = 0; said < 55; said += 1) {
      posted.push(await comment(memberCookies, contract.id, `Point ${said}.`, "working_team"));
    }
  });

  it("opens on the newest end, in the order the conversation was had", async () => {
    const first = await readPage(memberCookies, contract.id);
    expect(first.statusCode, first.body).toBe(200);
    const rows = first.json().comments as CommentRow[];
    expect(rows).toHaveLength(PAGE);
    // The last thing said is the last row: this is the end of the
    // thread, not the start of it.
    expect(rows.at(-1)!.id).toBe(posted.at(-1)!.id);
    // And inside the page it still reads oldest to newest (CMT-002).
    expect(rows.map((row) => row.id)).toEqual(posted.slice(-PAGE).map((row) => row.id));
    // The cursor is the oldest row of the page — the boundary for the
    // page before it.
    expect(first.json().nextCursor).toBe(rows[0]!.id);
  });

  it("walks backwards through the whole thread, each comment once", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await readPage(memberCookies, contract.id, cursor ?? undefined);
      expect(res.statusCode, res.body).toBe(200);
      // Each page goes in front of the ones already read, which is how
      // the panel prepends them.
      seen.unshift(...(res.json().comments as CommentRow[]).map((row) => row.id));
      cursor = res.json().nextCursor as string | null;
    } while (cursor !== null);
    expect(seen).toEqual(posted.map((row) => row.id));
  });

  it("answers an empty page for a cursor naming a comment in a room the viewer is not in", async () => {
    const hidden = await comment(memberCookies, contract.id, "Board only.", "legal_only");
    // The Contributor is not in the Legal Only room, so the comment is
    // not theirs to page from — a cursor that resolved outside the tier
    // filter would confirm that a Legal Only comment is there, which is
    // the one thing DD-016 will not have leak.
    const refused = await readPage(contributorCookies, contract.id, hidden.id);
    expect(refused.statusCode, refused.body).toBe(200);
    expect(refused.json().comments).toEqual([]);
    expect(refused.json().nextCursor).toBeNull();

    // The Member is in that room, so the same cursor pages for them.
    const allowed = await readPage(memberCookies, contract.id, hidden.id);
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((allowed.json().comments as CommentRow[]).length).toBeGreaterThan(0);
  });

  it("refuses a cursor outside its own bound before it reaches the database", async () => {
    // A cursor the reader cannot reach is a page of nothing; a cursor
    // that is not a cursor at all is a bad request.
    for (const shape of ["", "x".repeat(65)]) {
      const bad = await readPage(memberCookies, contract.id, shape);
      expect(bad.statusCode, bad.body).toBe(400);
      expect(bad.headers["content-type"]).toContain("application/problem+json");
    }
  });
});
