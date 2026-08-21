// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record activity feed at the HTTP seam (M9/6, DD-017).
 *
 * Four things carry this suite, and each one is a promise the feed makes
 * that nothing else in the system can keep for it.
 *
 * **The tier predicate, proven against a real second audience.** A
 * Contributor on the contract's team and a Legal Team Member read the
 * same record. The Member's feed carries the Legal Only comment's entry;
 * the Contributor's carries no row for it, no gap where it was, and no
 * number that could be subtracted from another to find it. The feed is
 * filtered by the same `contractAudience` gate the thread is, so the two
 * answers cannot drift apart.
 *
 * **The tier policy change.** `contract.*` entries now write
 * `working_team`, so the working group reads the record's narrative.
 * Settings, user administration, and security entries still write
 * `admin_only`, and none of them reaches a record feed.
 *
 * **Paging.** No request answers the whole history. The page size is a
 * server constant, and the cursor walks back through the feed without
 * repeating a row or skipping one.
 *
 * **Append-only.** Nothing in application code updates or deletes an
 * `activity_log` row. That is asserted twice: as a fact about the rows
 * across a full lifecycle of mutations, and as a fact about the source,
 * because "no code path" is a claim about code and not only about one
 * run of it.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "feed-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** On the contract's team, so the DD-016 tiers have a second audience. */
const CONTRIBUTOR = {
  email: "feed-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** A Contributor deliberately left off every team. */
const OUTSIDER = {
  email: "feed-outsider@example.com",
  displayName: "Ola Outsider",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "feed-business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;
/** Somebody to move between roles, so the admin_only assertion has a
 * real change to look at without taking another test's fixture. */
const SPARE = {
  email: "feed-spare@example.com",
  displayName: "Sam Spare",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let businessCookies: Record<string, string>;
const userIds = new Map<string, string>();

interface FeedEntry {
  id: string;
  action: string;
  visibility: string;
  actor: { id: string; displayName: string; image: string | null; archived: boolean } | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface FeedPage {
  entries: FeedEntry[];
  nextCursor: string | null;
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
    [SPARE, "contributor"],
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

async function ndaTypeId(): Promise<string> {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  const nda = (options.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

async function newContract(title: string): Promise<{ id: string; number: number }> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().contract as { id: string; number: number };
}

/** A contract with the Contributor on its team — the record every tier
 * test talks about, and the only reason the tiers have two audiences. */
async function contractWithTeam(title: string): Promise<{ id: string; number: number }> {
  const contract = await newContract(title);
  const added = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/team`,
    cookies: adminCookies,
    payload: { userId: userIds.get(CONTRIBUTOR.email), role: "contributor" },
  });
  expect(added.statusCode, added.body).toBe(201);
  return contract;
}

const readFeed = (cookies: Record<string, string>, entityId: string, cursor?: string) =>
  harness.app.inject({
    method: "GET",
    url: "/api/v1/activity",
    cookies,
    query: { entityType: "contract", entityId, ...(cursor ? { cursor } : {}) },
  });

/** One page of the feed, requiring success. */
async function feed(
  cookies: Record<string, string>,
  entityId: string,
  cursor?: string,
): Promise<FeedPage> {
  const res = await readFeed(cookies, entityId, cursor);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as FeedPage;
}

/** Every page of the feed, followed to the end — what a reader who keeps
 * pressing "load more" ends up holding. */
async function wholeFeed(
  cookies: Record<string, string>,
  entityId: string,
): Promise<{ entries: FeedEntry[]; pages: number }> {
  const entries: FeedEntry[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await feed(cookies, entityId, cursor);
    entries.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
    pages += 1;
    // A feed that never ends is a bug this loop must not hang on.
    expect(pages).toBeLessThan(50);
  } while (cursor);
  return { entries, pages };
}

const comment = (
  cookies: Record<string, string>,
  entityId: string,
  body: string,
  visibility: string,
) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    payload: { entityType: "contract", entityId, body, visibility },
  });

async function postComment(
  cookies: Record<string, string>,
  entityId: string,
  body: string,
  visibility: string,
): Promise<{ id: string }> {
  const res = await comment(cookies, entityId, body, visibility);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().comment as { id: string };
}

const patchContract = (number: number, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: adminCookies,
    payload,
  });

/** Every `activity_log` row for one record, oldest first, whole. The
 * append-only assertions compare these snapshots. */
function storedRows(entityId: string) {
  return harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, entityId))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
}

describe("the record activity feed", () => {
  it("narrates the record's own actions, newest first, with the actor on each entry", async () => {
    const contract = await contractWithTeam("A contract with a history");
    await patchContract(contract.number, { title: "A contract with a longer history" });

    const { entries } = await wholeFeed(memberCookies, contract.id);
    const actions = entries.map((entry) => entry.action);
    // Newest first: the edit happened after the creation and the team
    // row, so it reads first.
    expect(actions).toEqual(["contract.updated", "contract.team_added", "contract.created"]);
    expect(entries[0]!.actor).toMatchObject({
      id: userIds.get(ADMIN.email),
      displayName: ADMIN.displayName,
      archived: false,
    });
    // The edit carries what the value was and what it became, which is
    // what the narration layer renders old and new from.
    expect(entries[0]!.payload).toMatchObject({
      changed: {
        title: { from: "A contract with a history", to: "A contract with a longer history" },
      },
    });
  });

  it("answers 404 for a record the viewer cannot reach, as though it did not exist", async () => {
    const contract = await newContract("Nobody's contract");
    const refused = await readFeed(outsiderCookies, contract.id);
    expect(refused.statusCode, refused.body).toBe(404);

    const missing = await readFeed(memberCookies, "no-such-contract");
    expect(missing.statusCode, missing.body).toBe(404);
  });

  it("refuses a Business User, who reaches no contract surface in M9", async () => {
    const contract = await contractWithTeam("Not for a requester");
    const refused = await readFeed(businessCookies, contract.id);
    expect(refused.statusCode, refused.body).toBe(403);
  });
});

describe("the tier predicate over the feed", () => {
  it("gives a Contributor the same feed as a Member minus what they cannot hear", async () => {
    const contract = await contractWithTeam("Two audiences, one record");
    const legal = await postComment(
      memberCookies,
      contract.id,
      "Our position on the indemnity cap.",
      "legal_only",
    );
    const working = await postComment(
      memberCookies,
      contract.id,
      "Redline goes back tomorrow.",
      "working_team",
    );
    const full = await postComment(
      contributorCookies,
      contract.id,
      "Confirmed with the requester.",
      "full_thread",
    );

    const member = await wholeFeed(memberCookies, contract.id);
    const contributor = await wholeFeed(contributorCookies, contract.id);

    const commentIds = (page: { entries: FeedEntry[] }) =>
      page.entries
        .filter((entry) => entry.action === "comment.posted")
        .map((entry) => entry.payload.commentId);

    // The Member is in every room on this record.
    expect(commentIds(member)).toEqual([full.id, working.id, legal.id]);
    // The Contributor is in two of them. The Legal Only comment leaves
    // no entry at all — not a row, not a placeholder, not a gap.
    expect(commentIds(contributor)).toEqual([full.id, working.id]);
    expect(contributor.entries.some((entry) => entry.visibility === "legal_only")).toBe(false);
    // And the record's own narrative is theirs to read: the working
    // group can see what happened to the contract.
    expect(contributor.entries.map((entry) => entry.action)).toContain("contract.created");

    // Every entry the Contributor sees, the Member sees too — the
    // Contributor's feed is a subset and never a different account of
    // the same record.
    const memberIds = new Set(member.entries.map((entry) => entry.id));
    expect(contributor.entries.every((entry) => memberIds.has(entry.id))).toBe(true);
    // The difference is exactly the one comment, and no number in
    // either envelope discloses it: there is no total to subtract.
    expect(member.entries.length - contributor.entries.length).toBe(1);
    expect(Object.keys(await feed(contributorCookies, contract.id))).toEqual([
      "entries",
      "nextCursor",
    ]);
  });

  it("carries each comment entry at the comment's own tier", async () => {
    const contract = await contractWithTeam("Tiers ride with their comments");
    const posted = await postComment(memberCookies, contract.id, "Privileged.", "legal_only");
    const edit = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/comments/${posted.id}`,
      cookies: memberCookies,
      payload: { body: "Privileged, restated." },
    });
    expect(edit.statusCode, edit.body).toBe(200);

    const member = await wholeFeed(memberCookies, contract.id);
    const commentEntries = member.entries.filter((entry) => entry.action.startsWith("comment."));
    expect(commentEntries.map((entry) => [entry.action, entry.visibility])).toEqual([
      ["comment.edited", "legal_only"],
      ["comment.posted", "legal_only"],
    ]);

    const contributor = await wholeFeed(contributorCookies, contract.id);
    expect(contributor.entries.some((entry) => entry.action.startsWith("comment."))).toBe(false);
  });

  it("carries no comment text into the log, so a redact leaves nothing behind", async () => {
    const contract = await contractWithTeam("Redaction reaches everything");
    const posted = await postComment(
      memberCookies,
      contract.id,
      "Text that must be removable.",
      "working_team",
    );
    const redacted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/comments/${posted.id}/redact`,
      cookies: adminCookies,
    });
    expect(redacted.statusCode, redacted.body).toBe(200);

    const { entries } = await wholeFeed(memberCookies, contract.id);
    expect(JSON.stringify(entries)).not.toContain("Text that must be removable");
  });
});

describe("the tier a record action writes", () => {
  it("records every contract.* action at working_team", async () => {
    const contract = await contractWithTeam("Working team reads its own record");
    await patchContract(contract.number, { title: "Working team reads its own record, edited" });
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const rows = await storedRows(contract.id);
    const contractRows = rows.filter((row) => row.action.startsWith("contract."));
    expect(contractRows.length).toBeGreaterThan(3);
    expect(new Set(contractRows.map((row) => row.visibility))).toEqual(new Set(["working_team"]));
  });

  it("keeps admin_only for settings, user administration, and security actions", async () => {
    const changed = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies: adminCookies,
      payload: { name: "Feed Test Org" },
    });
    expect(changed.statusCode, changed.body).toBe(200);

    const [settings] = await harness.db
      .select({ visibility: activityLog.visibility })
      .from(activityLog)
      .where(eq(activityLog.action, "org_settings.updated"))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
    expect(settings?.visibility).toBe("admin_only");

    // A real change, so a row is actually written — and on the fixture
    // that exists to be moved, so no other test loses the role it
    // depends on.
    const role = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${userIds.get(SPARE.email)}/role`,
      cookies: adminCookies,
      payload: { role: "business_user" },
    });
    expect(role.statusCode, role.body).toBe(200);
    const roleRows = await harness.db
      .select({ visibility: activityLog.visibility })
      .from(activityLog)
      .where(eq(activityLog.action, "user.role_changed"));
    expect(roleRows.length).toBeGreaterThan(0);
    for (const row of roleRows) expect(row.visibility).toBe("admin_only");
  });

  it("keeps an admin_only entry out of every record feed", async () => {
    const contract = await contractWithTeam("No admin entries here");
    // Written straight to the table: no route puts an admin_only entry
    // on a contract, and the point is that the feed would still not
    // show one if a later module did.
    await harness.db.insert(activityLog).values({
      entityType: "contract",
      entityId: contract.id,
      actorId: userIds.get(ADMIN.email),
      action: "export.performed",
      visibility: "admin_only",
      payload: {},
    });

    const { entries } = await wholeFeed(adminCookies, contract.id);
    expect(entries.some((entry) => entry.action === "export.performed")).toBe(false);
  });
});

describe("paging", () => {
  it("never answers the whole history, and the cursor walks it without gaps", async () => {
    const contract = await contractWithTeam("A long-running contract");
    // Well past one page: creation and the team row, plus enough
    // comments that the feed has to be walked to be read.
    const posted: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const row = await postComment(
        memberCookies,
        contract.id,
        `Note ${index}`,
        index % 2 === 0 ? "working_team" : "full_thread",
      );
      posted.push(row.id);
    }

    const first = await feed(memberCookies, contract.id);
    // The page is capped by the server, and the client has no way to
    // ask for more than one page at a time.
    expect(first.entries).toHaveLength(25);
    expect(first.nextCursor).toBe(first.entries.at(-1)!.id);

    const { entries, pages } = await wholeFeed(memberCookies, contract.id);
    expect(pages).toBeGreaterThan(1);
    // Every row exactly once, in one strictly descending order.
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rows = await storedRows(contract.id);
    expect(ids).toEqual([...rows].reverse().map((row) => row.id));
    // And the last page says so rather than offering a cursor onto
    // nothing.
    const last = await feed(memberCookies, contract.id, ids.at(-26));
    expect(last.nextCursor).toBeNull();
  });

  it("answers an empty page for a cursor naming no row", async () => {
    const contract = await contractWithTeam("A cursor from nowhere");
    const page = await feed(memberCookies, contract.id, "no-such-entry");
    expect(page).toEqual({ entries: [], nextCursor: null });
  });
});

describe("the append-only rule", () => {
  it("leaves every row it has already written exactly as written", async () => {
    const contract = await contractWithTeam("Nothing is rewritten");
    const posted = await postComment(memberCookies, contract.id, "First word.", "working_team");
    const before = await storedRows(contract.id);
    expect(before.length).toBeGreaterThan(0);

    // A full lifecycle of the mutations that write to the log: an edit,
    // a status move, a team change, a comment corrected three ways, an
    // archive and a restore.
    await patchContract(contract.number, { title: "Nothing is rewritten, edited" });
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: adminCookies,
      payload: { userId: userIds.get(MEMBER.email), role: "member" },
    });
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/comments/${posted.id}`,
      cookies: memberCookies,
      payload: { body: "Second word." },
    });
    await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/comments/${posted.id}`,
      cookies: memberCookies,
    });
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/comments/${posted.id}/redact`,
      cookies: adminCookies,
    });
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/restore`,
      cookies: adminCookies,
    });

    const after = await storedRows(contract.id);
    // Only appended to. The rows that were there are byte-identical,
    // and they are still the beginning of the table.
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("has no code path that updates or deletes an activity_log row", async () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const offenders: string[] = [];
    // The table is only ever reached through Drizzle's builders, so an
    // UPDATE or a DELETE against it can only read as one of these two
    // calls. Raw SQL would be a third shape, and there is none in this
    // API.
    const forbidden = [/\.update\(\s*activityLog\s*\)/, /\.delete\(\s*activityLog\s*\)/];

    async function walk(directory: string): Promise<void> {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!item.name.endsWith(".ts") || item.name.endsWith(".test.ts")) continue;
        const source = await readFile(path, "utf8");
        if (forbidden.some((pattern) => pattern.test(source))) offenders.push(path);
      }
    }

    await walk(root);
    expect(offenders).toEqual([]);
  });
});
