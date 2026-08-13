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
 * The flag has no write path yet (it lands in M10/2), so every test
 * seeds it straight into the column.
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
