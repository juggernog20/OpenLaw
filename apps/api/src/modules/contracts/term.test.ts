// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-006's term on the contract record (M16/1), at the HTTP seam
 * through the real-Postgres harness.
 *
 * Five columns are five ordinary fields: the term type, the effective
 * date, the expiry, the renewal period in months, and the notice period
 * in days. Each commits on its own through the record's per-field PATCH
 * (DES-017) and each write lands its own activity entry, read straight
 * from the table as the approvals and status suites already do.
 *
 * The rule between them is what these tests pin hardest. The term data
 * cannot contradict its own type: an expiry on an evergreen contract
 * and a renewal period on a contract that does not auto-renew are
 * refused, each with its own RFC 9457 type (TECH-020), and a refusal
 * writes nothing at all. A type change goes the other way — it **clears**
 * what the new type cannot hold, and each clear is narrated as the edit
 * it is rather than left for a reader to infer from the type change
 * beside it.
 *
 * Two dates ride out of every answer that no column holds: the notice
 * deadline (expiry minus the notice period) and the days remaining
 * (expiry minus today). Neither needs a clock seam — both are functions
 * of one column and the calendar, so a test controls them by writing a
 * date on either side of now.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, eq, users } from "@openlaw/db";
import {
  TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE,
  TERM_RENEWAL_PERIOD_PROBLEM_TYPE,
} from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "term-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let ndaTypeId = "";

interface ContractRow {
  id: string;
  number: number;
  termType: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalPeriodMonths: number | null;
  noticePeriodDays: number | null;
  noticeDeadline: string | null;
  daysRemaining: number | null;
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

const patch = (number: number, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });

async function commit(number: number, payload: Record<string, unknown>): Promise<ContractRow> {
  const res = await patch(number, payload);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

async function read(number: number): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

const editsOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, contractId), eq(activityLog.action, "contract.updated")))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

function changedIn(entry: { payload: unknown }): Record<string, { from: unknown; to: unknown }> {
  const payload = entry.payload as { changed?: Record<string, { from: unknown; to: unknown }> };
  expect(payload.changed).toBeDefined();
  return payload.changed!;
}

/** A civil date `days` from today, in the zone the seam counts in. */
function daysFromToday(days: number): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

describe("the term on the contract record", () => {
  it("starts every contract on the least-asserting term and nothing else", async () => {
    const contract = await newContract("Term at birth");

    // `fixed` claims no automatic roll and no perpetual life — it is
    // the default and the backfill both.
    expect(contract.termType).toBe("fixed");
    expect(contract.effectiveDate).toBeNull();
    expect(contract.expiryDate).toBeNull();
    expect(contract.renewalPeriodMonths).toBeNull();
    expect(contract.noticePeriodDays).toBeNull();
    // Nothing to subtract from, and nothing to subtract.
    expect(contract.noticeDeadline).toBeNull();
    expect(contract.daysRemaining).toBeNull();
  });

  it("commits each term field on its own and writes each one its own entry", async () => {
    const contract = await newContract("Term field by field");

    await commit(contract.number, { termType: "auto_renew" });
    await commit(contract.number, { effectiveDate: "2026-01-01" });
    await commit(contract.number, { expiryDate: "2026-12-31" });
    await commit(contract.number, { renewalPeriodMonths: 12 });
    const after = await commit(contract.number, { noticePeriodDays: 90 });

    expect(after.termType).toBe("auto_renew");
    expect(after.effectiveDate).toBe("2026-01-01");
    expect(after.expiryDate).toBe("2026-12-31");
    expect(after.renewalPeriodMonths).toBe(12);
    expect(after.noticePeriodDays).toBe(90);
    expect(await read(contract.number)).toMatchObject({
      termType: "auto_renew",
      effectiveDate: "2026-01-01",
      expiryDate: "2026-12-31",
      renewalPeriodMonths: 12,
      noticePeriodDays: 90,
    });

    // Five commits, five entries, each naming exactly the one field it
    // committed (DES-017, DD-017).
    const entries = await editsOn(contract.id);
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => Object.keys(changedIn(entry)))).toEqual([
      ["termType"],
      ["effectiveDate"],
      ["expiryDate"],
      ["renewalPeriodMonths"],
      ["noticePeriodDays"],
    ]);
    expect(changedIn(entries[3]!).renewalPeriodMonths).toEqual({ from: null, to: 12 });
  });

  it("writes no entry when a term field is re-sent unchanged", async () => {
    const contract = await newContract("Term unchanged");
    await commit(contract.number, { noticePeriodDays: 30 });
    await commit(contract.number, { noticePeriodDays: 30 });

    expect(await editsOn(contract.id)).toHaveLength(1);
  });

  it("clears a term field back to nothing recorded", async () => {
    const contract = await newContract("Term cleared");
    await commit(contract.number, { effectiveDate: "2026-02-01" });
    const after = await commit(contract.number, { effectiveDate: null });

    expect(after.effectiveDate).toBeNull();
    const entries = await editsOn(contract.id);
    expect(changedIn(entries[1]!).effectiveDate).toEqual({ from: "2026-02-01", to: null });
  });

  it("derives the notice deadline from the expiry and the notice period", async () => {
    const contract = await newContract("Notice deadline");

    // One half alone derives nothing: there is nothing to subtract.
    const dated = await commit(contract.number, { expiryDate: "2027-03-31" });
    expect(dated.noticeDeadline).toBeNull();

    const both = await commit(contract.number, { noticePeriodDays: 90 });
    expect(both.noticeDeadline).toBe("2026-12-31");
    expect(await read(contract.number)).toMatchObject({ noticeDeadline: "2026-12-31" });

    // It moves with either half, because it is a subtraction and not a
    // stored date.
    const shorter = await commit(contract.number, { noticePeriodDays: 30 });
    expect(shorter.noticeDeadline).toBe("2027-03-01");
    const cleared = await commit(contract.number, { expiryDate: null });
    expect(cleared.noticeDeadline).toBeNull();
  });

  it("counts the days remaining from the expiry, on both sides of today", async () => {
    const ahead = await newContract("Days ahead");
    expect((await commit(ahead.number, { expiryDate: daysFromToday(45) })).daysRemaining).toBe(45);

    const today = await newContract("Days today");
    expect((await commit(today.number, { expiryDate: daysFromToday(0) })).daysRemaining).toBe(0);

    // A term that ran out says so, rather than reading as none left.
    const past = await newContract("Days behind");
    expect((await commit(past.number, { expiryDate: daysFromToday(-10) })).daysRemaining).toBe(-10);
  });

  it("leaves an evergreen contract with no expiry, no deadline, and no count", async () => {
    const contract = await newContract("Evergreen blanks");
    const after = await commit(contract.number, {
      termType: "evergreen",
      noticePeriodDays: 60,
    });

    expect(after.termType).toBe("evergreen");
    expect(after.expiryDate).toBeNull();
    // A notice period is legal on any type; the deadline simply derives
    // only when there is an expiry to subtract it from.
    expect(after.noticePeriodDays).toBe(60);
    expect(after.noticeDeadline).toBeNull();
    expect(after.daysRemaining).toBeNull();
  });

  it("refuses an expiry on an evergreen contract, and names the refusal", async () => {
    const contract = await newContract("Evergreen expiry");
    await commit(contract.number, { termType: "evergreen" });

    const res = await patch(contract.number, { expiryDate: "2027-01-01" });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().type).toBe(TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE);
    expect((await read(contract.number)).expiryDate).toBeNull();
    expect(await editsOn(contract.id)).toHaveLength(1);
  });

  it("refuses a renewal period on a contract that does not auto-renew", async () => {
    const fixed = await newContract("Fixed renewal period");
    const refusedOnFixed = await patch(fixed.number, { renewalPeriodMonths: 12 });
    expect(refusedOnFixed.statusCode, refusedOnFixed.body).toBe(400);
    expect(refusedOnFixed.json().type).toBe(TERM_RENEWAL_PERIOD_PROBLEM_TYPE);

    const evergreen = await newContract("Evergreen renewal period");
    await commit(evergreen.number, { termType: "evergreen" });
    const refusedOnEvergreen = await patch(evergreen.number, { renewalPeriodMonths: 12 });
    expect(refusedOnEvergreen.statusCode, refusedOnEvergreen.body).toBe(400);
    expect(refusedOnEvergreen.json().type).toBe(TERM_RENEWAL_PERIOD_PROBLEM_TYPE);
    expect((await read(evergreen.number)).renewalPeriodMonths).toBeNull();
  });

  it("refuses a value sent in the same breath as the type that forbids it", async () => {
    const contract = await newContract("Contradiction in one request");
    await commit(contract.number, { expiryDate: "2027-06-30" });

    const res = await patch(contract.number, {
      termType: "evergreen",
      expiryDate: "2027-06-30",
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().type).toBe(TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE);
    // Neither half committed: a contradiction is refused whole.
    expect(await read(contract.number)).toMatchObject({
      termType: "fixed",
      expiryDate: "2027-06-30",
    });
  });

  it("clears the expiry when the term type becomes evergreen, and says so", async () => {
    const contract = await newContract("Re-typed to evergreen");
    await commit(contract.number, { expiryDate: "2027-09-30" });
    await commit(contract.number, { noticePeriodDays: 45 });

    const after = await commit(contract.number, { termType: "evergreen" });
    expect(after.termType).toBe("evergreen");
    expect(after.expiryDate).toBeNull();
    // The notice period survives: it is legal on any type.
    expect(after.noticePeriodDays).toBe(45);
    expect(after.noticeDeadline).toBeNull();

    // The clear is narrated as the edit it is, in the same entry as the
    // type change that forced it.
    const entries = await editsOn(contract.id);
    expect(changedIn(entries.at(-1)!)).toEqual({
      termType: { from: "fixed", to: "evergreen" },
      expiryDate: { from: "2027-09-30", to: null },
    });
  });

  it("clears the renewal period when the term type leaves auto-renew, and says so", async () => {
    const contract = await newContract("Re-typed off auto-renew");
    await commit(contract.number, { termType: "auto_renew" });
    await commit(contract.number, { renewalPeriodMonths: 24 });
    await commit(contract.number, { expiryDate: "2028-01-31" });

    const after = await commit(contract.number, { termType: "fixed" });
    expect(after.termType).toBe("fixed");
    expect(after.renewalPeriodMonths).toBeNull();
    // A fixed contract still ends, so its expiry stays where it is.
    expect(after.expiryDate).toBe("2028-01-31");

    const entries = await editsOn(contract.id);
    expect(changedIn(entries.at(-1)!)).toEqual({
      termType: { from: "auto_renew", to: "fixed" },
      renewalPeriodMonths: { from: 24, to: null },
    });
  });

  it("clears both fields when an auto-renewing contract becomes evergreen", async () => {
    const contract = await newContract("Auto-renew to evergreen");
    await commit(contract.number, { termType: "auto_renew" });
    await commit(contract.number, { renewalPeriodMonths: 12, expiryDate: "2027-12-31" });

    const after = await commit(contract.number, { termType: "evergreen" });
    expect(after.expiryDate).toBeNull();
    expect(after.renewalPeriodMonths).toBeNull();

    const entries = await editsOn(contract.id);
    expect(Object.keys(changedIn(entries.at(-1)!)).sort()).toEqual([
      "expiryDate",
      "renewalPeriodMonths",
      "termType",
    ]);
  });

  it("takes a term type and the fields that suit it in one commit", async () => {
    const contract = await newContract("Type and dates together");
    const after = await commit(contract.number, {
      termType: "auto_renew",
      effectiveDate: "2026-04-01",
      expiryDate: "2027-03-31",
      renewalPeriodMonths: 12,
      noticePeriodDays: 60,
    });

    expect(after).toMatchObject({
      termType: "auto_renew",
      effectiveDate: "2026-04-01",
      expiryDate: "2027-03-31",
      renewalPeriodMonths: 12,
      noticePeriodDays: 60,
      noticeDeadline: "2027-01-30",
    });
  });

  it("refuses a period that is not a period", async () => {
    const contract = await newContract("Period bounds");
    await commit(contract.number, { termType: "auto_renew" });

    // A roll of zero months would advance an expiry to itself.
    const zero = await patch(contract.number, { renewalPeriodMonths: 0 });
    expect(zero.statusCode, zero.body).toBe(400);
    // A negative notice period would put the deadline after the date it
    // warns about.
    const negative = await patch(contract.number, { noticePeriodDays: -1 });
    expect(negative.statusCode, negative.body).toBe(400);
    // Neither refusal names a type: a client prints them (TECH-020).
    expect(zero.json().type).toBe("about:blank");
    expect(negative.json().type).toBe("about:blank");
  });

  it("refuses a term type that is not one of the three", async () => {
    const contract = await newContract("Unknown term type");
    const res = await patch(contract.number, { termType: "rolling" });
    expect(res.statusCode, res.body).toBe(400);
  });
});
