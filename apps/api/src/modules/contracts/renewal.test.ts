// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pending roll and its confirmation (M16/4), at the HTTP seam
 * through the real-Postgres harness — CTR-006's notify-only engine and
 * CTR-007's first renewal vehicle.
 *
 * **The pending state is a predicate over stored dates and today.** No
 * column holds it, no job sets it, and there is no clock seam to inject:
 * a test drives it by writing an expiry in the past, exactly as the
 * days-remaining tests already drive their own count. So these tests
 * assert the rule and never a schedule — nothing in this slice runs on
 * one.
 *
 * **The confirmed roll is the one act.** A Member+ user with reach sends
 * the expiry they were looking at and the expiry they want; the seam
 * compares the first under the contract's row lock and advances the
 * column to the second. Two confirms racing for one roll therefore
 * advance the term **once** — the loser is refused by name rather than
 * rolling it a second time — and a person who adjusted the proposal gets
 * the date they entered rather than the one the record offered.
 *
 * **Status and stage are untouched throughout.** The banner is a reading
 * of the record and the roll is a move of one date; neither is a
 * lifecycle transition, and CTR-006 says so in as many words.
 *
 * **The renewal history is the log.** Nothing stores a renewal, so the
 * `contract.renewal_confirmed` entries are what the record reads back —
 * the grill's G.R5 resolution — and these tests read them both through
 * the answer and straight from the table, the approvals precedent.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, eq, users } from "@openlaw/db";
import { RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who confirms the roll. */
const MEMBER = {
  email: "renewal-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

/** A Legal Team Member with no team row — the viewer a confidential
 * record has to be invisible to. */
const OUTSIDER = {
  email: "renewal-outsider@example.com",
  displayName: "Outside Counsel",
  password: "correct-horse-battery",
} as const;

/** A Contributor: reaches the record they are on, writes nothing on it
 * in M16 (DD-015). */
const CONTRIBUTOR = {
  email: "renewal-contributor@example.com",
  displayName: "Dana Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let contributorId = "";
let ndaTypeId = "";

/** One contract as the renewal surfaces read it back. */
interface ContractRow {
  id: string;
  number: number;
  termType: string;
  expiryDate: string | null;
  renewalPeriodMonths: number | null;
  daysRemaining: number | null;
  statusId: string;
  statusName: string;
  stage: string;
  /** CTR-006's derived pending state — no column, no job. */
  renewalPendingConfirmation: boolean;
  /** Where a confirmed roll would take the expiry, derived at read. */
  proposedRenewalExpiry: string | null;
}

/** One confirmed roll, as the record reads its own history back out of
 * the activity log (G.R5). */
interface ConfirmedRenewal {
  id: string;
  from: string;
  to: string;
  confirmedAt: string;
  confirmedBy: { id: string; displayName: string } | null;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const outsider = await provisionUser(harness.app.auth, OUTSIDER);
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, outsider.id));
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);

  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  contributorId = contributor.id;
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const types = res.json().contractTypes as { id: string; slug: string }[];
  ndaTypeId = types.find((row) => row.slug === "nda")!.id;
});

afterAll(async () => {
  await harness.stop();
});

async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { title, contractTypeId: ndaTypeId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

/** A term commit that must land, answering the row it produced. */
async function setTerm(number: number, payload: Record<string, unknown>): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

/** The record read's own copy of the row — the answer a reader gets, as
 * opposed to the one the writer got back. */
async function read(number: number, cookies = memberCookies): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

/** The record read's renewal history. */
async function history(number: number, cookies = memberCookies): Promise<ConfirmedRenewal[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().renewals as ConfirmedRenewal[];
}

const confirmRaw = (number: number, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/renewal`,
    cookies,
    payload,
  });

/** A roll that must land, answering the record and its whole history. */
async function confirm(
  number: number,
  payload: Record<string, unknown>,
  cookies = memberCookies,
): Promise<{ contract: ContractRow; renewals: ConfirmedRenewal[] }> {
  const res = await confirmRaw(number, payload, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { contract: ContractRow; renewals: ConfirmedRenewal[] };
}

/** Every confirmed roll written on one contract, oldest first. */
const rollsOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        eq(activityLog.action, "contract.renewal_confirmed"),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** A civil date `days` from today, in the zone the seam counts in. */
function daysFromToday(days: number): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * An auto-renewing contract whose expiry has already gone by — the
 * record the whole slice is about. The expiry is written in the past
 * and nothing else is needed: no job runs, no clock is injected, and
 * the pending state is true on the next read because the dates say so.
 */
async function lapsed(title: string, monthsPerRoll = 12): Promise<ContractRow> {
  const contract = await newContract(title);
  await setTerm(contract.number, { termType: "auto_renew" });
  return await setTerm(contract.number, {
    effectiveDate: daysFromToday(-400),
    expiryDate: daysFromToday(-10),
    renewalPeriodMonths: monthsPerRoll,
  });
}

describe("the renewal-pending predicate (CTR-006)", () => {
  it("turns on for an auto-renewing contract whose expiry has passed, with nothing scheduled", async () => {
    const contract = await lapsed("Pending roll");

    // The write's own answer and the record read agree, because both
    // read one derivation rather than a column either of them stored.
    expect(contract.renewalPendingConfirmation).toBe(true);
    expect(contract.daysRemaining).toBe(-10);
    expect(await read(contract.number)).toMatchObject({ renewalPendingConfirmation: true });
  });

  it("stays off while the term still has time to run, and on the day it expires", async () => {
    const ahead = await newContract("Pending ahead");
    await setTerm(ahead.number, { termType: "auto_renew" });
    const running = await setTerm(ahead.number, {
      expiryDate: daysFromToday(30),
      renewalPeriodMonths: 12,
    });
    expect(running.renewalPendingConfirmation).toBe(false);

    // A term expiring today has not passed its expiry. The day itself
    // still belongs to the term.
    const today = await setTerm(ahead.number, { expiryDate: daysFromToday(0) });
    expect(today.renewalPendingConfirmation).toBe(false);

    const yesterday = await setTerm(ahead.number, { expiryDate: daysFromToday(-1) });
    expect(yesterday.renewalPendingConfirmation).toBe(true);
  });

  it("never turns on for a fixed, an evergreen, or an archived contract", async () => {
    // A fixed term that ran out has ended; it does not roll, so nothing
    // is pending on it.
    const fixed = await newContract("Pending fixed");
    const ranOut = await setTerm(fixed.number, { expiryDate: daysFromToday(-10) });
    expect(ranOut.termType).toBe("fixed");
    expect(ranOut.renewalPendingConfirmation).toBe(false);

    // An evergreen contract holds no expiry at all, so there is no date
    // for the predicate to have passed.
    const evergreen = await newContract("Pending evergreen");
    const forever = await setTerm(evergreen.number, { termType: "evergreen" });
    expect(forever.expiryDate).toBeNull();
    expect(forever.renewalPendingConfirmation).toBe(false);

    // Archiving freezes a record. A frozen record is not waiting on
    // anybody.
    const archived = await lapsed("Pending archived");
    expect(archived.renewalPendingConfirmation).toBe(true);
    const froze = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${archived.number}/archive`,
      cookies: memberCookies,
    });
    expect(froze.statusCode, froze.body).toBe(200);
    expect(await read(archived.number)).toMatchObject({ renewalPendingConfirmation: false });
  });

  it("clears the moment the expiry advances, and comes back if it is moved into the past again", async () => {
    const contract = await lapsed("Pending clears");

    const advanced = await setTerm(contract.number, { expiryDate: daysFromToday(355) });
    expect(advanced.renewalPendingConfirmation).toBe(false);

    // Re-typing the term off auto-renew clears it too: nothing but an
    // auto-renewing contract rolls.
    const back = await setTerm(contract.number, { expiryDate: daysFromToday(-5) });
    expect(back.renewalPendingConfirmation).toBe(true);
    const retyped = await setTerm(contract.number, { termType: "fixed" });
    expect(retyped.renewalPendingConfirmation).toBe(false);
  });

  it("proposes the roll's new expiry from the record's own dates, clamped at a month's end", async () => {
    const contract = await newContract("Roll proposal");
    await setTerm(contract.number, { termType: "auto_renew" });

    // Nothing to propose until both halves are recorded.
    expect(
      (await setTerm(contract.number, { expiryDate: "2026-08-31" })).proposedRenewalExpiry,
    ).toBeNull();

    const yearly = await setTerm(contract.number, { renewalPeriodMonths: 12 });
    expect(yearly.proposedRenewalExpiry).toBe("2027-08-31");

    // A month is not a fixed number of days: a term ending on the 31st
    // rolled six months lands on February's last day, not on March.
    const halfYear = await setTerm(contract.number, {
      expiryDate: "2026-08-31",
      renewalPeriodMonths: 6,
    });
    expect(halfYear.proposedRenewalExpiry).toBe("2027-02-28");

    // A contract that cannot roll proposes nothing.
    const fixed = await newContract("No proposal");
    expect(
      (await setTerm(fixed.number, { expiryDate: "2026-08-31" })).proposedRenewalExpiry,
    ).toBeNull();
  });
});

describe("confirming the roll (CTR-007's first vehicle)", () => {
  it("advances the expiry to the proposal and writes its own activity action", async () => {
    const contract = await lapsed("Roll confirmed");
    const proposal = contract.proposedRenewalExpiry!;
    expect(proposal).not.toBeNull();

    const answer = await confirm(contract.number, {
      fromExpiry: contract.expiryDate,
      toExpiry: proposal,
    });

    expect(answer.contract.expiryDate).toBe(proposal);
    // The banner is a reading of the dates, so it goes out with them.
    expect(answer.contract.renewalPendingConfirmation).toBe(false);
    expect(await read(contract.number)).toMatchObject({ expiryDate: proposal });

    // One entry, on the contract, at the standing record tier (DD-017).
    const entries = await rollsOn(contract.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.visibility).toBe("working_team");
    expect(entries[0]!.payload).toMatchObject({
      number: contract.number,
      title: "Roll confirmed",
      from: contract.expiryDate,
      to: proposal,
    });
    // The roll is not a field edit, so it narrates as itself rather
    // than hiding inside a `contract.updated` changed map.
    const edits = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.entityId, contract.id), eq(activityLog.action, "contract.updated")),
      );
    expect(edits.every((entry) => !JSON.stringify(entry.payload).includes(proposal))).toBe(true);
  });

  it("commits the date the person entered, not the one the record proposed", async () => {
    const contract = await lapsed("Roll adjusted");
    const adjusted = daysFromToday(200);
    expect(adjusted).not.toBe(contract.proposedRenewalExpiry);

    const answer = await confirm(contract.number, {
      fromExpiry: contract.expiryDate,
      toExpiry: adjusted,
    });

    expect(answer.contract.expiryDate).toBe(adjusted);
    expect(answer.renewals[0]).toMatchObject({ from: contract.expiryDate, to: adjusted });
  });

  it("advances the expiry exactly once when two confirms race for one roll", async () => {
    const contract = await lapsed("Roll raced");
    const body = { fromExpiry: contract.expiryDate, toExpiry: contract.proposedRenewalExpiry };

    const [first, second] = await Promise.all([
      confirmRaw(contract.number, body),
      confirmRaw(contract.number, body),
    ]);

    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(codes, `${first.body} / ${second.body}`).toEqual([200, 409]);
    const refusal = first.statusCode === 409 ? first : second;
    expect(refusal.json().type).toBe(RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE);

    // One advance, and one entry. The loser rolled nothing.
    expect((await read(contract.number)).expiryDate).toBe(contract.proposedRenewalExpiry);
    expect(await rollsOn(contract.id)).toHaveLength(1);
  });

  it("refuses a confirm against an expiry the record no longer holds", async () => {
    const contract = await lapsed("Roll stale");
    await setTerm(contract.number, { expiryDate: daysFromToday(-3) });

    const res = await confirmRaw(contract.number, {
      fromExpiry: contract.expiryDate,
      toExpiry: daysFromToday(300),
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().type).toBe(RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE);
    // A refusal writes nothing.
    expect((await read(contract.number)).expiryDate).toBe(daysFromToday(-3));
    expect(await rollsOn(contract.id)).toHaveLength(0);
  });

  it("refuses a roll that does not move the term forward", async () => {
    const contract = await lapsed("Roll backwards");

    for (const toExpiry of [contract.expiryDate, daysFromToday(-40)]) {
      const res = await confirmRaw(contract.number, {
        fromExpiry: contract.expiryDate,
        toExpiry,
      });
      expect(res.statusCode, res.body).toBe(400);
    }
    expect(await rollsOn(contract.id)).toHaveLength(0);
  });

  it("refuses a roll on a contract that does not auto-renew, and on one with no expiry", async () => {
    const fixed = await newContract("Roll on fixed");
    await setTerm(fixed.number, { expiryDate: daysFromToday(-10) });
    const onFixed = await confirmRaw(fixed.number, {
      fromExpiry: daysFromToday(-10),
      toExpiry: daysFromToday(300),
    });
    expect(onFixed.statusCode, onFixed.body).toBe(400);

    const undated = await newContract("Roll with no expiry");
    await setTerm(undated.number, { termType: "auto_renew", renewalPeriodMonths: 12 });
    const onUndated = await confirmRaw(undated.number, {
      fromExpiry: daysFromToday(-10),
      toExpiry: daysFromToday(300),
    });
    expect(onUndated.statusCode, onUndated.body).toBe(409);
  });

  it("rolls a term that has not lapsed, because a roll is an act and not a repair", async () => {
    const contract = await newContract("Roll early");
    await setTerm(contract.number, { termType: "auto_renew" });
    const running = await setTerm(contract.number, {
      expiryDate: daysFromToday(20),
      renewalPeriodMonths: 12,
    });
    expect(running.renewalPendingConfirmation).toBe(false);

    const answer = await confirm(contract.number, {
      fromExpiry: running.expiryDate,
      toExpiry: running.proposedRenewalExpiry,
    });
    expect(answer.contract.expiryDate).toBe(running.proposedRenewalExpiry);
  });

  it("leaves the status and the stage exactly where they were", async () => {
    const contract = await lapsed("Roll leaves the lifecycle alone");
    const before = await read(contract.number);

    const answer = await confirm(contract.number, {
      fromExpiry: contract.expiryDate,
      toExpiry: contract.proposedRenewalExpiry,
    });

    expect(answer.contract.statusId).toBe(before.statusId);
    expect(answer.contract.statusName).toBe(before.statusName);
    expect(answer.contract.stage).toBe(before.stage);
    // And nothing narrated a move either.
    const moves = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, contract.id),
          eq(activityLog.action, "contract.status_changed"),
        ),
      );
    expect(moves).toHaveLength(0);
  });
});

describe("the renewal history the record reads back (G.R5)", () => {
  it("answers no renewals on a record where none has happened", async () => {
    const contract = await lapsed("History empty");
    expect(await history(contract.number)).toEqual([]);
  });

  it("answers every confirmed roll, most recent first, with who confirmed it", async () => {
    const contract = await lapsed("History of rolls", 6);

    const first = await confirm(contract.number, {
      fromExpiry: contract.expiryDate,
      toExpiry: daysFromToday(-4),
    });
    const second = await confirm(contract.number, {
      fromExpiry: daysFromToday(-4),
      toExpiry: daysFromToday(180),
    });

    expect(first.renewals).toHaveLength(1);
    expect(second.renewals).toHaveLength(2);
    // Most recent first, so the record's "Last renewal" fact is the
    // first row and nothing has to scan for a maximum.
    expect(second.renewals.map((roll) => roll.to)).toEqual([daysFromToday(180), daysFromToday(-4)]);
    expect(second.renewals[0]).toMatchObject({
      from: daysFromToday(-4),
      to: daysFromToday(180),
      confirmedBy: { displayName: MEMBER.displayName },
    });
    expect(Date.parse(second.renewals[0]!.confirmedAt)).not.toBeNaN();

    // The record read says the same as the write's own answer, because
    // both read the log rather than a stored history.
    expect((await history(contract.number)).map((roll) => roll.to)).toEqual([
      daysFromToday(180),
      daysFromToday(-4),
    ]);
  });
});

describe("who may confirm a roll (CTR-021, DD-015)", () => {
  it("lets a Contributor on the team read the record and confirm nothing on it", async () => {
    const contract = await lapsed("Roll contributor");
    const joined = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: memberCookies,
      payload: { userId: contributorId, role: "contributor" },
    });
    expect(joined.statusCode, joined.body).toBe(201);

    // They read the pending state exactly as a Member does.
    expect(await read(contract.number, contributorCookies)).toMatchObject({
      renewalPendingConfirmation: true,
    });
    // They can already see the record, so the refusal is a plain 403.
    const refused = await confirmRaw(
      contract.number,
      { fromExpiry: contract.expiryDate, toExpiry: contract.proposedRenewalExpiry },
      contributorCookies,
    );
    expect(refused.statusCode, refused.body).toBe(403);
    expect(await rollsOn(contract.id)).toHaveLength(0);
  });

  it("refuses a roll on an archived record until it is restored", async () => {
    const contract = await lapsed("Roll frozen");
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: memberCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    const refused = await confirmRaw(contract.number, {
      fromExpiry: contract.expiryDate,
      toExpiry: contract.proposedRenewalExpiry,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(await rollsOn(contract.id)).toHaveLength(0);
  });
});

describe("renewals on a confidential contract (DD-014)", () => {
  it("omits the pending state, the history, and the roll from a viewer outside the audience", async () => {
    const walled = await lapsed("Roll walled");
    await confirm(walled.number, {
      fromExpiry: walled.expiryDate,
      toExpiry: daysFromToday(-2),
    });

    // Open, the outsider reads it exactly as the Member does (CTR-021).
    expect(await read(walled.number, outsiderCookies)).toMatchObject({
      renewalPendingConfirmation: true,
    });
    expect(await history(walled.number, outsiderCookies)).toHaveLength(1);

    const flag = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${walled.number}`,
      cookies: memberCookies,
      payload: { isConfidential: true },
    });
    expect(flag.statusCode, flag.body).toBe(200);

    // The record, and the roll on it, answer exactly as they do for a
    // contract nobody ever made.
    const refusedRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${walled.number}`,
      cookies: outsiderCookies,
    });
    const absent = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/999999",
      cookies: outsiderCookies,
    });
    expect(refusedRead.statusCode).toBe(404);
    expect(refusedRead.body).not.toContain("Roll walled");
    expect(refusedRead.json().detail).toBe(absent.json().detail);

    const refusedRoll = await confirmRaw(
      walled.number,
      { fromExpiry: daysFromToday(-2), toExpiry: daysFromToday(300) },
      outsiderCookies,
    );
    expect(refusedRoll.statusCode).toBe(404);
    expect(refusedRoll.json().detail).toBe(absent.json().detail);

    // And the roll's entry leaves the record's feed with it.
    const feed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=contract&entityId=${walled.id}`,
      cookies: outsiderCookies,
    });
    expect(feed.statusCode).toBe(404);

    // The audience's own answers are untouched: the flag gates who
    // reaches the record, not the work on it.
    expect(await history(walled.number)).toHaveLength(1);
  });
});
