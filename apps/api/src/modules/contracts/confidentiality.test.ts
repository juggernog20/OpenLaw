// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Confidential flag as a gate on every read (M10/1, DD-014) at the
 * HTTP seam.
 *
 * The viewer this suite is about is new: a **Legal Team Member who is
 * not on the contract's team**. Until M10 that person read every
 * contract in the company, and the flag is the one thing that takes a
 * record away from them.
 *
 * The suite is written the way the M9 comment-visibility tests are —
 * two real viewers read the same record and their two answers are
 * compared. The excluded viewer's answer must show not the text, not an
 * id, not a gap, and no count: the contract is absent from their list,
 * its record URL answers exactly like a contract nobody ever made, and
 * its comments, activity, unread badge, and mention candidates answer
 * the same way.
 *
 * Reach is the whole subject here. Confidentiality narrows **who**
 * reaches the record; the DD-016 tiers then answer for whoever is left,
 * and this suite changes nothing about them. An Administrator always
 * reaches. Anyone else reaches a confidential contract when they hold a
 * `contract_team` row on it or are its Owner — and a Contributor still
 * needs the row either way, because the flag never widens access.
 *
 * The write path is the second subject (M10/2). Three actors set and
 * clear the flag — an Administrator, the contract's creator, and its
 * Owner — at creation and on the record. Two refusals sit behind it and
 * the difference is the point: a viewer who reaches the record but is
 * none of the three is refused with a plain 403, because their sight of
 * it is not a secret; a viewer who does not reach it at all is answered
 * with the missing-record 404.
 *
 * The read tests below the write ones seed the flag straight into the
 * column, because a fixture that walls a record off is not the subject
 * of a read test.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** On the contract's team, so the included side has a real second
 * viewer beside the Administrator. */
const MEMBER = {
  email: "confi-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** The viewer M10 is about: a Legal Team Member with no team row, who
 * read every contract in the company until the flag was set. */
const OUTSIDER = {
  email: "confi-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
/** The Owner (CTR-004) with no team row: the flag must never take a
 * contract away from its own accountable person. */
const OWNER = {
  email: "confi-owner@example.com",
  displayName: "Priya Owner",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member on the team who made nothing and owns nothing:
 * the viewer the write path answers 403, not 404. They can see the
 * record, so nothing about it is a secret from them — they simply may
 * not decide its audience. */
const TEAMMATE = {
  email: "confi-teammate@example.com",
  displayName: "Tomas Teammate",
  password: "correct-horse-battery",
} as const;
/** A Contributor on the team — their M9 access must survive the flag
 * untouched. */
const CONTRIBUTOR = {
  email: "confi-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** A Contributor on no team: as invisible after the flag as before it. */
const STRANGER = {
  email: "confi-stranger@example.com",
  displayName: "Sam Stranger",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let ownerCookies: Record<string, string>;
let teammateCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let strangerCookies: Record<string, string>;
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};

interface ContractRow {
  id: string;
  number: number;
  title: string;
  isConfidential: boolean;
}

interface MentionCandidateRow {
  id: string;
  displayName: string;
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
    [OUTSIDER, "legal_team_member"],
    [OWNER, "legal_team_member"],
    [TEAMMATE, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [STRANGER, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  ownerCookies = await signInCookies(harness.app, OWNER.email, OWNER.password);
  teammateCookies = await signInCookies(harness.app, TEAMMATE.email, TEAMMATE.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  strangerCookies = await signInCookies(harness.app, STRANGER.email, STRANGER.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

/** Creates a contract as the Administrator, requiring success. The
 * creator takes the `creator` team row, which is how every contract in
 * the product is born. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

/**
 * Sets the flag straight into the column. M10/1 builds no write path —
 * the route lands in M10/2 — so the fixture is the column itself.
 */
async function markConfidential(contractId: string, value = true): Promise<void> {
  await harness.db
    .update(contracts)
    .set({ isConfidential: value })
    .where(eq(contracts.id, contractId));
}

/** Creates a contract as anybody, with whatever body the test wants —
 * the raw answer, because the write tests are about the refusals too. */
const createContract = async (cookies: Record<string, string>, body: Record<string, unknown>) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies,
    payload: { contractTypeId: await ndaTypeId(), ...body },
  });

/** The DES-017 per-field commit, raw. */
const patchContract = (
  cookies: Record<string, string>,
  number: number,
  payload: Record<string, unknown>,
) => harness.app.inject({ method: "PATCH", url: `/api/v1/contracts/${number}`, cookies, payload });

/** Sets or clears the flag through the record patch, requiring success. */
async function setFlag(
  cookies: Record<string, string>,
  number: number,
  isConfidential: boolean,
): Promise<void> {
  const res = await patchContract(cookies, number, { isConfidential });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().contract.isConfidential).toBe(isConfidential);
}

/** Puts somebody on a contract's team, requiring success. */
async function putOnTeam(number: number, userId: string, role: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: adminCookies,
    payload: { userId, role },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Names the Owner (CTR-004). Assigning the Owner writes no team row,
 * which is exactly why the Owner needs a clause of their own. */
async function setOwner(number: number, userId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: adminCookies,
    payload: { managerId: userId },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const listContracts = async (cookies: Record<string, string>): Promise<ContractRow[]> => {
  const res = await harness.app.inject({ method: "GET", url: "/api/v1/contracts", cookies });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contracts as ContractRow[];
};

const getContract = (cookies: Record<string, string>, number: number) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}`, cookies });

const readComments = (cookies: Record<string, string>, entityId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=contract&entityId=${entityId}`,
    cookies,
  });

const readUnread = (cookies: Record<string, string>, entityId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/unread?entityType=contract&entityId=${entityId}`,
    cookies,
  });

const readCandidates = (cookies: Record<string, string>, entityId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/mention-candidates?entityType=contract&entityId=${entityId}`,
    cookies,
  });

const readActivity = (cookies: Record<string, string>, entityId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=contract&entityId=${entityId}`,
    cookies,
  });

/** Posts a comment, requiring success. */
async function comment(
  cookies: Record<string, string>,
  entityId: string,
  body: string,
  visibility: string,
): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    payload: { entityType: "contract", entityId, body, visibility },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** The typeahead's list, requiring success. */
async function candidates(
  cookies: Record<string, string>,
  entityId: string,
): Promise<MentionCandidateRow[]> {
  const res = await readCandidates(cookies, entityId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().candidates as MentionCandidateRow[];
}

describe("the Confidential flag and the contract list (M10/1)", () => {
  it("takes a confidential contract out of a non-team Legal Team Member's list, and out of every number they could count", async () => {
    const open = await newContract("Confi list: the open one");
    const walled = await newContract("Confi list: the walled one");

    const before = await listContracts(outsiderCookies);
    expect(before.map((row) => row.number)).toEqual(
      expect.arrayContaining([open.number, walled.number]),
    );

    await markConfidential(walled.id);

    const after = await listContracts(outsiderCookies);
    expect(after.map((row) => row.number)).toContain(open.number);
    expect(after.map((row) => row.number)).not.toContain(walled.number);
    // Not a placeholder row and not a gap: the list is one row shorter,
    // so no number the client can take off it counts the record either.
    expect(after).toHaveLength(before.length - 1);
    expect(JSON.stringify(after)).not.toContain(walled.id);
    expect(JSON.stringify(after)).not.toContain("the walled one");

    // The Administrator's list is untouched — oversight has no blind
    // spots (DD-014).
    expect((await listContracts(adminCookies)).map((row) => row.number)).toContain(walled.number);
  });
});

/** A problem body with the request's own URL taken out, which is the
 * one field two different requests are entitled to differ on. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

describe("the record URL of a confidential contract (M10/1)", () => {
  it("answers a non-team Legal Team Member with the missing-record 404, body for body", async () => {
    const walled = await newContract("Confi detail: the walled one");
    await markConfidential(walled.id);

    const refused = await getContract(outsiderCookies, walled.number);
    const absent = await getContract(outsiderCookies, 999_999);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    // A shared link or a guessed number must reveal nothing. `instance`
    // is the URL each request asked for, and is the only field allowed
    // to differ.
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
    expect(refused.body).not.toContain("the walled one");
  });
});

describe("the side doors on a confidential contract (M10/1)", () => {
  it("answers a non-team Legal Team Member on comments, activity, unread, and mention candidates exactly as for a missing record", async () => {
    const walled = await newContract("Confi doors: the walled one");
    await putOnTeam(walled.number, idOf(MEMBER), "member");
    await comment(memberCookies, walled.id, "The board paper is attached.", "working_team");
    await markConfidential(walled.id);

    // The same four reads, aimed once at the walled record and once at
    // a record id that names nothing. Every pair must match.
    const missing = "00000000-0000-7000-8000-000000000000";
    const doors = [readComments, readUnread, readCandidates, readActivity] as const;
    for (const door of doors) {
      const refused = await door(outsiderCookies, walled.id);
      const absent = await door(outsiderCookies, missing);
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.headers["content-type"]).toContain("application/problem+json");
      expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
      // Not the text, not an id, and no count of what was withheld.
      // `instance` is left out: it is the URL the client itself asked
      // for, so the record id in it came from the client, not from us.
      const answer = JSON.stringify(withoutInstance(refused.json()));
      expect(answer).not.toContain("board paper");
      expect(answer).not.toContain(walled.id);
      expect(answer).not.toContain(idOf(MEMBER));
    }

    // The included viewer's answers are untouched: the flag gates the
    // audience, not the work.
    const thread = await readComments(memberCookies, walled.id);
    expect(thread.statusCode, thread.body).toBe(200);
    expect(thread.json().comments).toHaveLength(1);
    const feed = await readActivity(memberCookies, walled.id);
    expect(feed.statusCode, feed.body).toBe(200);
    expect((feed.json().entries as { action: string }[]).length).toBeGreaterThan(0);
  });
});

describe("the mention typeahead on a confidential contract (CMT-007, M10/1)", () => {
  it("offers only the named team, the Owner, and Administrators — through the same predicate", async () => {
    const walled = await newContract("Confi mentions: the walled one");
    await putOnTeam(walled.number, idOf(MEMBER), "member");
    await putOnTeam(walled.number, idOf(CONTRIBUTOR), "contributor");
    await setOwner(walled.number, idOf(OWNER));

    // Open, the typeahead offers every Member+ in the company, which is
    // the CTR-021 answer and stays untouched here.
    const open = (await candidates(memberCookies, walled.id)).map((row) => row.id);
    expect(open).toContain(idOf(OUTSIDER));

    await markConfidential(walled.id);

    const offered = await candidates(memberCookies, walled.id);
    const ids = offered.map((row) => row.id);
    expect(ids).toContain(idOf(ADMIN)); // Administrators always reach.
    expect(ids).toContain(idOf(MEMBER)); // The named team.
    expect(ids).toContain(idOf(CONTRIBUTOR)); // The named team, whatever their role.
    expect(ids).toContain(idOf(OWNER)); // The accountable person, with no team row.
    // The Legal Team Member who is not on it cannot be addressed here:
    // the typeahead must not offer somebody the record itself 404s at.
    expect(ids).not.toContain(idOf(OUTSIDER));
    expect(offered.map((row) => row.displayName)).not.toContain(OUTSIDER.displayName);
    // A Contributor with no team row was never offered, flag or no flag.
    expect(ids).not.toContain(idOf(STRANGER));

    // The tiers themselves are untouched (DD-016): confidentiality
    // narrows who reaches the record, not what they hear on it.
    expect(offered.find((row) => row.id === idOf(MEMBER))?.tiers).toEqual([
      "legal_only",
      "working_team",
      "full_thread",
    ]);
    expect(offered.find((row) => row.id === idOf(CONTRIBUTOR))?.tiers).toEqual([
      "working_team",
      "full_thread",
    ]);
  });

  it("refuses a posted mention of somebody the record cannot reach", async () => {
    const walled = await newContract("Confi mentions: the refused one");
    await putOnTeam(walled.number, idOf(MEMBER), "member");
    await markConfidential(walled.id);

    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: memberCookies,
      payload: {
        entityType: "contract",
        entityId: walled.id,
        body: "Asking somebody who cannot open this.",
        visibility: "legal_only",
        mentions: [idOf(OUTSIDER)],
      },
    });
    // The same refusal a mention of anybody unreachable already gets —
    // the typeahead's rule, held on a request no typeahead sent.
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      status: 400,
      detail: "That is not a person you can mention on this record.",
    });
    // The refusal names no one: it is the same words for a person who
    // does not exist and a person this record cannot reach.
    expect(res.body).not.toContain(OUTSIDER.displayName);
  });
});

describe("who still reaches a confidential contract (M10/1)", () => {
  it("leaves the named team, the Owner, and Administrators reading everything as before", async () => {
    const walled = await newContract("Confi reach: everyone named");
    await putOnTeam(walled.number, idOf(MEMBER), "member");
    await putOnTeam(walled.number, idOf(CONTRIBUTOR), "contributor");
    await setOwner(walled.number, idOf(OWNER));
    await comment(memberCookies, walled.id, "Only the named team hears this.", "working_team");
    await markConfidential(walled.id);

    for (const [who, cookies] of [
      ["the Administrator", adminCookies],
      ["a team Member", memberCookies],
      ["the Owner with no team row", ownerCookies],
      ["a Contributor on the team", contributorCookies],
    ] as const) {
      const record = await getContract(cookies, walled.number);
      expect(record.statusCode, `${who}: ${record.body}`).toBe(200);
      expect(record.json().contract.title).toBe("Confi reach: everyone named");
      expect((await listContracts(cookies)).map((row) => row.number)).toContain(walled.number);

      const thread = await readComments(cookies, walled.id);
      expect(thread.statusCode, `${who}: ${thread.body}`).toBe(200);
      expect(thread.json().comments).toHaveLength(1);

      const feed = await readActivity(cookies, walled.id);
      expect(feed.statusCode, `${who}: ${feed.body}`).toBe(200);

      const badge = await readUnread(cookies, walled.id);
      expect(badge.statusCode, `${who}: ${badge.body}`).toBe(200);
    }
  });

  it("keeps a Contributor's M9 access on the row they hold, and changes nothing for one with no row", async () => {
    const walled = await newContract("Confi reach: the Contributor's own");
    await putOnTeam(walled.number, idOf(CONTRIBUTOR), "contributor");
    await markConfidential(walled.id);

    // With a row, the flag is not felt at all — the record reads as it
    // did in M9.
    const held = await getContract(contributorCookies, walled.number);
    expect(held.statusCode, held.body).toBe(200);
    expect(held.json().contract.title).toBe("Confi reach: the Contributor's own");

    // With no row, a confidential contract is exactly as invisible as
    // every other contract already was: the flag widens nobody's access.
    const open = await newContract("Confi reach: not the stranger's either");
    for (const contract of [walled, open]) {
      const res = await getContract(strangerCookies, contract.number);
      expect(res.statusCode, res.body).toBe(404);
    }
    expect(await listContracts(strangerCookies)).toEqual([]);
  });

  it("revokes reach on the next request when the viewer's last team row comes off", async () => {
    const walled = await newContract("Confi reach: the row that was taken back");
    await putOnTeam(walled.number, idOf(MEMBER), "member");
    await markConfidential(walled.id);
    expect((await getContract(memberCookies, walled.number)).statusCode).toBe(200);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${walled.number}/team/${idOf(MEMBER)}/member`,
      cookies: adminCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);

    // The team list is the live truth: the predicate reads the rows on
    // every request, so the next one is already refused.
    const after = await getContract(memberCookies, walled.number);
    expect(after.statusCode, after.body).toBe(404);
    expect((await listContracts(memberCookies)).map((row) => row.number)).not.toContain(
      walled.number,
    );
    expect((await readComments(memberCookies, walled.id)).statusCode).toBe(404);
    expect((await readActivity(memberCookies, walled.id)).statusCode).toBe(404);
  });
});

/** One record's `contract.confidentiality_*` entries, as the record's
 * own feed answers them (DD-017's first surface). Read as a viewer who
 * is on the record, because the feed is gated on reach like everything
 * else. */
async function flagEntriesInFeed(
  cookies: Record<string, string>,
  entityId: string,
): Promise<{ action: string; visibility: string; actor: { id: string } | null }[]> {
  const res = await readActivity(cookies, entityId);
  expect(res.statusCode, res.body).toBe(200);
  const entries = res.json().entries as {
    action: string;
    visibility: string;
    actor: { id: string } | null;
    createdAt: string;
  }[];
  // The feed is newest first; the log's own order reads better here.
  return entries.filter((entry) => entry.action.startsWith("contract.confidentiality")).reverse();
}

/** The same entries from the Administrator-only audit log (DD-017's
 * second surface), which reads the whole table with no record scope. */
async function flagEntriesInAuditLog(
  entityId: string,
): Promise<{ action: string; actor: { id: string } | null; createdAt: string }[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/audit-log?entityType=contract",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const entries = res.json().entries as {
    action: string;
    entityId: string | null;
    actor: { id: string } | null;
    createdAt: string;
  }[];
  return entries
    .filter((entry) => entry.entityId === entityId)
    .filter((entry) => entry.action.startsWith("contract.confidentiality"))
    .reverse();
}

describe("the flag on the contract row (M10/2)", () => {
  it("rides every answer a contract comes back on, and is false until somebody sets it", async () => {
    const born = await createContract(adminCookies, { title: "Confi row: born open" });
    expect(born.statusCode, born.body).toBe(201);
    expect(born.json().contract.isConfidential).toBe(false);
    const contract = born.json().contract as ContractRow;

    await setFlag(adminCookies, contract.number, true);

    const record = await getContract(adminCookies, contract.number);
    expect(record.statusCode, record.body).toBe(200);
    expect(record.json().contract.isConfidential).toBe(true);

    const listed = (await listContracts(adminCookies)).find((row) => row.id === contract.id);
    expect(listed).toMatchObject({ isConfidential: true });
  });

  it("leaves the list its no-count shape — there is no total to scrub", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(Object.keys(res.json())).toEqual(["contracts"]);
  });
});

describe("setting the flag at creation (M10/2)", () => {
  it("makes a contract confidential from birth, so no wrong audience ever sees it", async () => {
    const created = await createContract(memberCookies, {
      title: "Confi birth: walled from the first moment",
      isConfidential: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as ContractRow;
    expect(contract.isConfidential).toBe(true);

    // The creator is the actor by definition, so nothing was refused —
    // and the record is already away from everyone else.
    expect((await getContract(outsiderCookies, contract.number)).statusCode).toBe(404);
    expect((await listContracts(outsiderCookies)).map((row) => row.id)).not.toContain(contract.id);
    expect((await getContract(memberCookies, contract.number)).statusCode).toBe(200);
  });

  it("records the set at creation, so the audit log holds every walling-off", async () => {
    const created = await createContract(memberCookies, {
      title: "Confi birth: on the record from the start",
      isConfidential: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as ContractRow;

    expect(await flagEntriesInFeed(memberCookies, contract.id)).toEqual([
      expect.objectContaining({
        action: "contract.confidentiality_set",
        visibility: "working_team",
        actor: expect.objectContaining({ id: idOf(MEMBER) }),
      }),
    ]);
  });

  it("leaves a contract created without the flag open", async () => {
    const created = await createContract(memberCookies, { title: "Confi birth: open by default" });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as ContractRow;
    expect(contract.isConfidential).toBe(false);
    expect(await flagEntriesInFeed(memberCookies, contract.id)).toEqual([]);
    expect((await getContract(outsiderCookies, contract.number)).statusCode).toBe(200);
  });
});

describe("who may set and clear the flag (M10/2, DD-014)", () => {
  /**
   * One contract with all three actors and both refused viewers on it:
   * the Administrator, the creator, the Owner, a team Member who is
   * neither, and a Legal Team Member with nothing at all.
   */
  async function contractWithEveryone(title: string): Promise<ContractRow> {
    const created = await createContract(memberCookies, { title });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as ContractRow;
    await putOnTeam(contract.number, idOf(TEAMMATE), "member");
    await setOwner(contract.number, idOf(OWNER));
    return contract;
  }

  it("lets the Administrator, the creator, and the Owner each set it and clear it again", async () => {
    const contract = await contractWithEveryone("Confi actors: the three who may");

    for (const [who, cookies] of [
      ["the Administrator", adminCookies],
      ["the creator", memberCookies],
      ["the Owner", ownerCookies],
    ] as const) {
      const set = await patchContract(adminCookies, contract.number, { isConfidential: false });
      expect(set.statusCode, `${who} setup: ${set.body}`).toBe(200);

      await setFlag(cookies, contract.number, true);
      await setFlag(cookies, contract.number, false);
    }
  });

  it("refuses a team Member who is none of the three with a plain 403 — their sight of the record is not a secret", async () => {
    const contract = await contractWithEveryone("Confi actors: on the team, not an actor");

    const refused = await patchContract(teammateCookies, contract.number, {
      isConfidential: true,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    // The refusal says who may, so the reader knows where to go — and
    // says nothing about the record, which they can see anyway.
    expect(refused.json()).toMatchObject({
      status: 403,
      detail: "Only an Administrator, the contract's creator, or its Owner can change this.",
    });
    // They still read the record they were refused the flag on.
    expect((await getContract(teammateCookies, contract.number)).statusCode).toBe(200);
    expect((await getContract(adminCookies, contract.number)).json().contract.isConfidential).toBe(
      false,
    );
  });

  it("answers a Legal Team Member who cannot reach the record with the missing-record 404, body for body", async () => {
    const contract = await contractWithEveryone("Confi actors: out of reach entirely");
    await setFlag(adminCookies, contract.number, true);

    const refused = await patchContract(outsiderCookies, contract.number, {
      isConfidential: false,
    });
    const absent = await patchContract(outsiderCookies, 999_999, { isConfidential: false });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
    expect(refused.body).not.toContain("out of reach entirely");
    // And the flag they tried to clear is still set.
    expect((await getContract(adminCookies, contract.number)).json().contract.isConfidential).toBe(
      true,
    );
  });

  it("refuses a Legal Team Member who reaches an open contract with the 403, not the 404", async () => {
    const contract = await contractWithEveryone("Confi actors: reaches it, may not flag it");

    // The contract is open, so this viewer reads it like everyone else
    // — and is refused the flag on the same terms as a team Member.
    const refused = await patchContract(outsiderCookies, contract.number, {
      isConfidential: true,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect((await getContract(outsiderCookies, contract.number)).statusCode).toBe(200);
  });

  it("keeps every other viewer refused where the contract routes already refuse them", async () => {
    const contract = await contractWithEveryone("Confi actors: below the Member+ floor");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");

    // The per-field PATCH is Member+ (CTR-021), so a Contributor is
    // refused at the guard whether they are on the record or not — the
    // flag widens nobody's reach and narrows nobody's floor.
    for (const cookies of [contributorCookies, strangerCookies]) {
      const refused = await patchContract(cookies, contract.number, { isConfidential: true });
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.headers["content-type"]).toContain("application/problem+json");
      // The route's own floor, not the flag's actor set: the words are
      // the guard's, and they name no record.
      expect(refused.json()).toMatchObject({ status: 403 });
      expect(refused.body).not.toContain("below the Member+ floor");
    }
  });

  it("refuses the flag on an archived contract, like every other edit", async () => {
    const contract = await contractWithEveryone("Confi actors: archived and inert");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const refused = await patchContract(adminCookies, contract.number, { isConfidential: true });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    // The archived refusal every other field already gets, word for
    // word — the flag is an edit, not an exception to the freeze.
    expect(refused.json()).toMatchObject({
      status: 409,
      detail: "This contract is archived. Restore it before editing.",
    });
    expect((await getContract(adminCookies, contract.number)).json().contract.isConfidential).toBe(
      false,
    );
  });
});

describe("what a set and a clear leave behind (M10/2, DD-017)", () => {
  it("narrates both in the record's own feed and holds both in the audit log with actor and timestamp", async () => {
    const created = await createContract(adminCookies, { title: "Confi log: set then cleared" });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as ContractRow;
    await putOnTeam(contract.number, idOf(MEMBER), "member");

    await setFlag(adminCookies, contract.number, true);
    await setFlag(adminCookies, contract.number, false);

    // The team's feed: one entry each, at the record-action tier, so a
    // Contributor on the team reads them exactly as a Member does.
    expect(await flagEntriesInFeed(memberCookies, contract.id)).toEqual([
      expect.objectContaining({
        action: "contract.confidentiality_set",
        visibility: "working_team",
        actor: expect.objectContaining({ id: idOf(ADMIN) }),
      }),
      expect.objectContaining({
        action: "contract.confidentiality_cleared",
        visibility: "working_team",
        actor: expect.objectContaining({ id: idOf(ADMIN) }),
      }),
    ]);

    // The Administrator's audit log: the same two rows, read from the
    // whole table with no record scope. One write serves both surfaces.
    const audited = await flagEntriesInAuditLog(contract.id);
    expect(audited.map((entry) => entry.action)).toEqual([
      "contract.confidentiality_set",
      "contract.confidentiality_cleared",
    ]);
    for (const entry of audited) {
      expect(entry.actor?.id).toBe(idOf(ADMIN));
      expect(Date.parse(entry.createdAt)).not.toBeNaN();
    }
  });

  it("writes nothing when the flag is re-sent unchanged", async () => {
    const created = await createContract(adminCookies, { title: "Confi log: nothing changed" });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as ContractRow;

    await setFlag(adminCookies, contract.number, false);
    expect(await flagEntriesInFeed(adminCookies, contract.id)).toEqual([]);
  });
});
