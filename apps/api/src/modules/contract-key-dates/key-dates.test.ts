// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-009's key dates and the deadline union (M16/3), at the HTTP seam
 * through the real-Postgres harness.
 *
 * A key date is the record's escape hatch: a date, a label, an optional
 * note, and nothing else. A Member+ user with reach adds one, moves one,
 * and takes one off, and every one of those three writes lands its own
 * closed-union activity entry — read straight from `activity_log`, the
 * approvals precedent.
 *
 * The read is the milestone's real subject. One answer carries the union
 * CTR-009 commits to — the key dates, the expiry, and the **derived**
 * notice deadline — with the earliest upcoming named as the next
 * deadline. The notice deadline is in that list and in no column: it
 * moves when either half of the subtraction moves, and it disappears
 * when either half does.
 *
 * Reach is the last subject. Nothing here holds an audience of its own
 * (DD-014, CTR-021): a viewer outside a confidential record's audience
 * is answered exactly as for a contract that was never created, on the
 * listing and on every write alike, and the entries these writes append
 * leave the record's feed with them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who records the dates. */
const MEMBER = {
  email: "keydate-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member with no team row — the viewer a confidential
 * record is invisible to (DD-014). */
const OUTSIDER = {
  email: "keydate-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
/** A Contributor on the team: reads the surface, writes nothing on it
 * (CTR-021, DD-015). */
const CONTRIBUTOR = {
  email: "keydate-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let contributorId = "";
let ndaTypeId = "";

/** One row of the CTR-009 union, as every deadline surface reads it. */
interface Deadline {
  source: "key_date" | "expiry" | "notice_deadline";
  keyDateId: string | null;
  date: string;
  label: string | null;
  note: string | null;
  daysAway: number;
  isNext: boolean;
}

interface ContractRow {
  id: string;
  number: number;
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
}, 120_000);

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

/** A term commit that must land. */
async function setTerm(number: number, payload: Record<string, unknown>): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
}

const listRaw = (number: number, cookies = memberCookies) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}/key-dates`, cookies });

async function list(number: number, cookies = memberCookies): Promise<Deadline[]> {
  const res = await listRaw(number, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().deadlines as Deadline[];
}

const addRaw = (number: number, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/key-dates`,
    cookies,
    payload,
  });

/** Adds one key date, requiring it to land, and answers its id. */
async function add(
  number: number,
  payload: Record<string, unknown>,
  cookies = memberCookies,
): Promise<string> {
  const res = await addRaw(number, payload, cookies);
  expect(res.statusCode, res.body).toBe(201);
  const rows = res.json().deadlines as Deadline[];
  // By the label **and** the date: a suite may put two dates on one
  // record under one name, and picking the first match would then hand
  // back the wrong row's id.
  const landed = rows.find((row) => row.label === payload.label && row.date === payload.date);
  expect(landed, res.body).toBeDefined();
  return landed!.keyDateId!;
}

const editRaw = (id: string, payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "PATCH", url: `/api/v1/key-dates/${id}`, cookies, payload });

async function edit(
  id: string,
  payload: Record<string, unknown>,
  cookies = memberCookies,
): Promise<Deadline[]> {
  const res = await editRaw(id, payload, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().deadlines as Deadline[];
}

const removeRaw = (id: string, cookies = memberCookies) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/key-dates/${id}`, cookies });

/** Every key-date entry on one contract, oldest first. */
const keyDateEntriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        inArray(activityLog.action, ["key_date.added", "key_date.edited", "key_date.removed"]),
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

const keyDates = (rows: Deadline[]) => rows.filter((row) => row.source === "key_date");

describe("key dates on a contract (CTR-009)", () => {
  it("starts a record with nothing on its deadline surface", async () => {
    const contract = await newContract("Key dates at birth");
    expect(await list(contract.number)).toEqual([]);
  });

  it("adds a key date and narrates it", async () => {
    const contract = await newContract("Key dates added");
    const id = await add(contract.number, {
      date: daysFromToday(30),
      label: "Price review window opens",
      note: "Both sides may re-open the rate card.",
    });

    const rows = await list(contract.number);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "key_date",
      keyDateId: id,
      date: daysFromToday(30),
      label: "Price review window opens",
      note: "Both sides may re-open the rate card.",
      daysAway: 30,
      // The only date on the record, so it is the next one.
      isNext: true,
    });

    const entries = await keyDateEntriesOn(contract.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("key_date.added");
    // Record tier, so a Contributor on the team reads it exactly as a
    // Member does (DD-017).
    expect(entries[0]!.visibility).toBe("working_team");
    expect(entries[0]!.payload).toMatchObject({
      keyDateId: id,
      label: "Price review window opens",
      date: daysFromToday(30),
    });
  });

  it("takes a key date with no note, and stores no empty string for one", async () => {
    const contract = await newContract("Key dates unnoted");
    await add(contract.number, { date: "2027-01-15", label: "Warranty expires" });
    const blank = await add(contract.number, {
      date: "2027-02-15",
      label: "Audit window closes",
      note: "   ",
    });

    const rows = keyDates(await list(contract.number));
    expect(rows.map((row) => row.note)).toEqual([null, null]);
    expect(rows.find((row) => row.keyDateId === blank)!.note).toBeNull();
  });

  it("edits one key date and narrates only what moved", async () => {
    const contract = await newContract("Key dates edited");
    const id = await add(contract.number, { date: "2027-03-01", label: "Price review" });

    const moved = await edit(id, { date: "2027-04-01", label: "Price review window opens" });
    expect(moved.find((row) => row.keyDateId === id)).toMatchObject({
      date: "2027-04-01",
      label: "Price review window opens",
    });

    const entries = await keyDateEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["key_date.added", "key_date.edited"]);
    const payload = entries[1]!.payload as {
      label: string;
      changed: Record<string, { from: unknown; to: unknown }>;
    };
    // The label as it stands after the edit, so the sentence names the
    // date the reader would go and look at.
    expect(payload.label).toBe("Price review window opens");
    expect(Object.keys(payload.changed).sort()).toEqual(["date", "label"]);
    expect(payload.changed.date).toEqual({ from: "2027-03-01", to: "2027-04-01" });
  });

  it("writes no entry when an edit changes nothing", async () => {
    const contract = await newContract("Key dates unchanged");
    const id = await add(contract.number, { date: "2027-05-01", label: "Insurance renewal" });
    await edit(id, { date: "2027-05-01", label: "Insurance renewal" });

    const entries = await keyDateEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["key_date.added"]);
  });

  it("clears a note back to nothing recorded", async () => {
    const contract = await newContract("Key dates note cleared");
    const id = await add(contract.number, {
      date: "2027-06-01",
      label: "Option exercise window",
      note: "Ninety days, on notice.",
    });
    const after = await edit(id, { note: null });

    expect(after.find((row) => row.keyDateId === id)!.note).toBeNull();
    const entries = await keyDateEntriesOn(contract.id);
    const payload = entries[1]!.payload as { changed: Record<string, { to: unknown }> };
    expect(payload.changed.note).toEqual({ from: "Ninety days, on notice.", to: null });
  });

  it("removes a key date and leaves the entry as its record", async () => {
    const contract = await newContract("Key dates removed");
    const id = await add(contract.number, { date: "2027-07-01", label: "Phase 1 acceptance" });

    const res = await removeRaw(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().deadlines).toEqual([]);
    expect(await list(contract.number)).toEqual([]);

    // The row is gone, so this entry is the only thing left that says
    // the date was ever on the record — which is why it names it.
    const entries = await keyDateEntriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["key_date.added", "key_date.removed"]);
    expect(entries[1]!.payload).toMatchObject({
      keyDateId: id,
      label: "Phase 1 acceptance",
      date: "2027-07-01",
    });

    // And it is gone for good: a second removal finds nothing.
    expect((await removeRaw(id)).statusCode).toBe(404);
  });

  it("refuses a label that is blank or too long, and writes nothing", async () => {
    const contract = await newContract("Key dates bounds");
    expect((await addRaw(contract.number, { date: "2027-08-01", label: "   " })).statusCode).toBe(
      400,
    );
    expect(
      (await addRaw(contract.number, { date: "2027-08-01", label: "x".repeat(201) })).statusCode,
    ).toBe(400);
    // And a date that is not a date.
    expect(
      (await addRaw(contract.number, { date: "the first of March", label: "Review" })).statusCode,
    ).toBe(400);

    expect(await list(contract.number)).toEqual([]);
    expect(await keyDateEntriesOn(contract.id)).toHaveLength(0);
  });
});

describe("the deadline union (CTR-009)", () => {
  it("answers the key dates, the expiry, and the derived notice deadline, next first", async () => {
    const contract = await newContract("Union of three");
    await setTerm(contract.number, { expiryDate: daysFromToday(120) });
    await setTerm(contract.number, { noticePeriodDays: 90 });
    await add(contract.number, { date: daysFromToday(60), label: "Price review window opens" });
    await add(contract.number, { date: daysFromToday(-10), label: "Phase 1 acceptance" });

    const rows = await list(contract.number);
    // Upcoming first and nearest first: the notice deadline at 30 days,
    // the key date at 60, the expiry at 120. The one date that has gone
    // by follows them.
    expect(rows.map((row) => row.source)).toEqual([
      "notice_deadline",
      "key_date",
      "expiry",
      "key_date",
    ]);
    expect(rows.map((row) => row.daysAway)).toEqual([30, 60, 120, -10]);
    // Exactly one next deadline, and it is the earliest upcoming.
    expect(rows.filter((row) => row.isNext)).toHaveLength(1);
    expect(rows[0]!.isNext).toBe(true);
    expect(rows[0]!.date).toBe(daysFromToday(30));

    // The two term-derived rows carry no key-date id, because no row
    // backs them: only the key dates can be edited or removed.
    expect(rows.filter((row) => row.source !== "key_date").map((row) => row.keyDateId)).toEqual([
      null,
      null,
    ]);
  });

  it("moves the notice deadline when either half of the subtraction moves, and stores it nowhere", async () => {
    const contract = await newContract("Union derived deadline");
    await setTerm(contract.number, { expiryDate: "2027-03-31", noticePeriodDays: 90 });

    const derived = (rows: Deadline[]) => rows.find((row) => row.source === "notice_deadline");
    expect(derived(await list(contract.number))!.date).toBe("2026-12-31");

    await setTerm(contract.number, { noticePeriodDays: 30 });
    expect(derived(await list(contract.number))!.date).toBe("2027-03-01");

    // Either half missing and there is nothing to subtract — so the
    // union loses the row rather than holding a stale one.
    await setTerm(contract.number, { noticePeriodDays: null });
    expect(derived(await list(contract.number))).toBeUndefined();
    expect((await list(contract.number)).map((row) => row.source)).toEqual(["expiry"]);
  });

  it("gives an evergreen contract its key dates and no term rows at all", async () => {
    const contract = await newContract("Union evergreen");
    await setTerm(contract.number, { termType: "evergreen", noticePeriodDays: 60 });
    await add(contract.number, { date: daysFromToday(15), label: "Rate card review" });

    const rows = await list(contract.number);
    expect(rows.map((row) => row.source)).toEqual(["key_date"]);
    expect(rows[0]!.isNext).toBe(true);
  });

  it("names no next deadline when every date has gone by", async () => {
    const contract = await newContract("Union all past");
    await add(contract.number, { date: daysFromToday(-5), label: "Delivery accepted" });
    await add(contract.number, { date: daysFromToday(-40), label: "Kick-off" });

    const rows = await list(contract.number);
    // Past dates read outward from today: the most recent one first.
    expect(rows.map((row) => row.daysAway)).toEqual([-5, -40]);
    expect(rows.some((row) => row.isNext)).toBe(false);
  });

  it("counts a date falling today as still upcoming", async () => {
    const contract = await newContract("Union today");
    await add(contract.number, { date: daysFromToday(0), label: "Notice due" });

    const rows = await list(contract.number);
    expect(rows[0]).toMatchObject({ daysAway: 0, isNext: true });
  });
});

describe("who may read and write key dates (CTR-021, DD-015)", () => {
  it("lets a Contributor on the team read the surface and write nothing on it", async () => {
    const contract = await newContract("Key dates contributor");
    const joined = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: memberCookies,
      payload: { userId: contributorId, role: "contributor" },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const id = await add(contract.number, { date: "2027-09-01", label: "Renewal talks open" });

    expect((await list(contract.number, contributorCookies)).map((row) => row.label)).toEqual([
      "Renewal talks open",
    ]);
    // They can already see the record, so the refusal is a plain 403.
    expect(
      (await addRaw(contract.number, { date: "2027-09-02", label: "Mine" }, contributorCookies))
        .statusCode,
    ).toBe(403);
    expect((await editRaw(id, { label: "Mine" }, contributorCookies)).statusCode).toBe(403);
    expect((await removeRaw(id, contributorCookies)).statusCode).toBe(403);
  });

  it("refuses every write on an archived record until it is restored", async () => {
    const contract = await newContract("Key dates frozen");
    const id = await add(contract.number, { date: "2027-10-01", label: "Renewal talks open" });
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: memberCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    // Archiving freezes a record; it does not hide it.
    expect((await list(contract.number)).map((row) => row.label)).toEqual(["Renewal talks open"]);
    expect((await addRaw(contract.number, { date: "2027-10-02", label: "Later" })).statusCode).toBe(
      409,
    );
    expect((await editRaw(id, { label: "Later" })).statusCode).toBe(409);
    expect((await removeRaw(id)).statusCode).toBe(409);
  });
});

describe("key dates on a confidential contract (DD-014)", () => {
  it("omits the listing, the union, and the activity entries from a viewer outside the audience", async () => {
    const walled = await newContract("Key dates walled");
    await setTerm(walled.number, { expiryDate: daysFromToday(200), noticePeriodDays: 30 });
    const id = await add(walled.number, {
      date: daysFromToday(20),
      label: "Board paper circulated",
      note: "Ahead of the renewal decision.",
    });
    await edit(id, { label: "Board paper circulated to the committee" });

    // Open, the outsider reads it exactly as the Member does (CTR-021).
    expect((await list(walled.number, outsiderCookies)).length).toBe(3);

    const flag = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${walled.number}`,
      cookies: memberCookies,
      payload: { isConfidential: true },
    });
    expect(flag.statusCode, flag.body).toBe(200);

    // The listing, and the writes on it, answer exactly as they do for a
    // contract nobody ever made.
    const refused = await listRaw(walled.number, outsiderCookies);
    const absent = await listRaw(999_999, outsiderCookies);
    expect(refused.statusCode).toBe(404);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.body).not.toContain("Board paper");
    expect(refused.json().detail).toBe(absent.json().detail);
    expect(
      (await addRaw(walled.number, { date: "2027-11-01", label: "Mine" }, outsiderCookies))
        .statusCode,
    ).toBe(404);
    expect((await editRaw(id, { label: "Mine" }, outsiderCookies)).statusCode).toBe(404);
    expect((await removeRaw(id, outsiderCookies)).statusCode).toBe(404);

    // And the entries the writes appended leave the record's feed with
    // it — not the label, not the note, not a count of what was withheld.
    const feed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=contract&entityId=${walled.id}`,
      cookies: outsiderCookies,
    });
    expect(feed.statusCode).toBe(404);
    expect(feed.body).not.toContain("Board paper");

    // The audience's own answers are untouched: the flag gates who
    // reaches the record, not the work on it.
    expect((await list(walled.number)).length).toBe(3);
  });
});
