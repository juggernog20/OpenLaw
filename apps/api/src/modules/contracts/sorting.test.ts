// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contracts list under a sort (DD-019 clause 2), at the HTTP seam
 * through the real-Postgres harness.
 *
 * The subject is the keyset cursor, not the ORDER BY. Ordering fifty rows
 * one page deep is easy; the thing that breaks is paging an ordering with
 * **ties and nulls** in it. `number` is monotonic and unique, so the
 * unsorted list's cursor can never skip or repeat a row (CTR-024). A sort
 * by expiry has neither property: thirty contracts can share one date,
 * and thirty more can have no date at all. So the fixture below is built
 * to be hostile on purpose — 60 contracts, three distinct dates, and half
 * the rows with nothing recorded — and every test walks the whole list
 * one page at a time and asserts the walk lost nobody and duplicated
 * nobody.
 *
 * The fixture writes its dates straight to the table rather than through
 * 60 PATCH requests. What is under test is the read; the term rules that
 * guard the write have their own tests (term.test.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "sort-member@example.com",
  displayName: "Sorina Counsel",
  password: "correct-horse-battery",
} as const;

/** More than one page, so every walk below actually pages (PAGE_SIZE is
 * 50, and the seam does not let a client ask for another size). */
const FIXTURE_SIZE = 60;

/** Three dates over thirty dated rows: ten rows per date, so every tie
 * the cursor has to break is a ten-way one. */
const DATES = ["2027-01-31", "2027-06-30", "2027-11-30"] as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let ndaTypeId = "";

/** Every contract this file made, in creation order. */
const made: { id: string; number: number; title: string }[] = [];

interface ListAnswer {
  contracts: { id: string; number: number; title: string; expiryDate: string | null }[];
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

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  const types = options.json().contractTypes as { id: string; slug: string }[];
  ndaTypeId = types.find((row) => row.slug === "nda")!.id;

  for (let index = 0; index < FIXTURE_SIZE; index += 1) {
    // Titles deliberately mix case and do not run with the reference:
    // "sort by title" folds case, and a title order that happened to
    // match the reference order would prove nothing.
    const title = `${index % 2 === 0 ? "Zeta" : "alpha"} deal ${String(FIXTURE_SIZE - index).padStart(2, "0")}`;
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: memberCookies,
      payload: { title, contractTypeId: ndaTypeId },
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = res.json().contract as { id: string; number: number };
    made.push({ ...row, title });
  }

  // Half the rows get one of three dates; the other half get none, which
  // is the trailing NULL group every walk has to arrive at last.
  await Promise.all(
    made.map((row, index) =>
      index % 2 === 0
        ? harness.db
            .update(contracts)
            .set({ expiryDate: DATES[(index / 2) % DATES.length] })
            .where(eq(contracts.id, row.id))
        : Promise.resolve(),
    ),
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

/** One page of the list, under one sort. */
async function page(
  query: Record<string, string>,
  cursor: string | null = null,
): Promise<ListAnswer> {
  const params = new URLSearchParams({ ...query, ...(cursor ? { cursor } : {}) });
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts?${params.toString()}`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ListAnswer;
}

/**
 * The whole list under one sort, walked page by page the way a reader
 * pressing "Show more" walks it — carrying the same sort on every read,
 * because a cursor is a position in one ordering.
 */
async function walk(query: Record<string, string>): Promise<ListAnswer["contracts"]> {
  const rows: ListAnswer["contracts"] = [];
  let cursor: string | null = null;
  // Bounded so a cursor that fails to advance ends the test rather than
  // the test runner.
  for (let reads = 0; reads < 10; reads += 1) {
    const answer = await page(query, cursor);
    rows.push(...answer.contracts);
    cursor = answer.nextCursor;
    if (cursor === null) return rows;
  }
  throw new Error("the walk never reached the end of the list");
}

/** The ids this file made, in the order a walk returned them. Rows from
 * other fixtures cannot appear — this harness starts empty — but the
 * filter keeps the assertions about this file's 60 either way. */
const mine = (rows: ListAnswer["contracts"]) =>
  rows.filter((row) => made.some((made) => made.id === row.id));

describe("the contracts list under no sort (CTR-024, unchanged)", () => {
  it("reads newest reference first, and pages the whole list exactly once", async () => {
    const rows = mine(await walk({}));
    expect(rows).toHaveLength(FIXTURE_SIZE);
    expect(new Set(rows.map((row) => row.id)).size).toBe(FIXTURE_SIZE);
    const numbers = rows.map((row) => row.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });
});

describe("the keyset cursor under a sort with ties and nulls", () => {
  it("walks every row once, ascending, with the undated rows last", async () => {
    const rows = mine(await walk({ sort: "expiryDate", dir: "asc" }));

    expect(rows).toHaveLength(FIXTURE_SIZE);
    expect(new Set(rows.map((row) => row.id)).size).toBe(FIXTURE_SIZE);

    // The dated rows lead, in date order; the undated ones trail. NULLS
    // LAST is not the direction's business — a contract with no expiry is
    // the one the reader did not ask about, either way round.
    const dated = rows.filter((row) => row.expiryDate !== null);
    const undated = rows.filter((row) => row.expiryDate === null);
    expect(dated).toHaveLength(FIXTURE_SIZE / 2);
    expect(undated).toHaveLength(FIXTURE_SIZE / 2);
    expect(rows.slice(0, dated.length)).toEqual(dated);

    const dates = dated.map((row) => row.expiryDate!);
    expect(dates).toEqual([...dates].sort());
  });

  it("walks every row once, descending, with the undated rows still last", async () => {
    const rows = mine(await walk({ sort: "expiryDate", dir: "desc" }));

    expect(rows).toHaveLength(FIXTURE_SIZE);
    expect(new Set(rows.map((row) => row.id)).size).toBe(FIXTURE_SIZE);

    const dated = rows.filter((row) => row.expiryDate !== null);
    expect(rows.slice(0, dated.length)).toEqual(dated);
    const dates = dated.map((row) => row.expiryDate!);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("breaks a tie by reference, descending, so a page boundary inside one cannot skip a row", async () => {
    const rows = mine(await walk({ sort: "expiryDate", dir: "asc" }));
    for (const date of DATES) {
      const tied = rows.filter((row) => row.expiryDate === date).map((row) => row.number);
      expect(tied.length).toBeGreaterThan(1);
      expect(tied).toEqual([...tied].sort((a, b) => b - a));
    }
    // The same tie-break runs the trailing NULL group, which is where a
    // cursor whose boundary row has no value has to work.
    const undated = rows.filter((row) => row.expiryDate === null).map((row) => row.number);
    expect(undated).toEqual([...undated].sort((a, b) => b - a));
  });

  it("starts a page from a cursor whose own sorted value is null", async () => {
    // The boundary row is taken from inside the trailing NULL group, so
    // the cursor exercises the branch that only more NULLs may follow.
    const all = mine(await walk({ sort: "expiryDate", dir: "asc" }));
    const firstUndated = all.findIndex((row) => row.expiryDate === null);
    expect(firstUndated).toBeGreaterThan(-1);
    const boundary = all[firstUndated]!;

    const after = await page({ sort: "expiryDate", dir: "asc" }, boundary.id);
    const following = mine(after.contracts);
    expect(following.map((row) => row.id)).toEqual(
      all.slice(firstUndated + 1).map((row) => row.id),
    );
    expect(following.every((row) => row.expiryDate === null)).toBe(true);
  });

  it("answers an empty page for a cursor naming a contract this viewer cannot reach", async () => {
    // A confidential contract nobody added this member to. The cursor
    // resolves to nothing under their scope, so the page is empty rather
    // than the whole list from the top (DD-014).
    const hidden = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: await signInCookies(harness.app, ADMIN.email, ADMIN.password),
      payload: { title: "Walled off", contractTypeId: ndaTypeId },
    });
    expect(hidden.statusCode, hidden.body).toBe(201);
    const row = hidden.json().contract as { id: string; number: number };
    const adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
    const flagged = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${row.number}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(flagged.statusCode, flagged.body).toBe(200);

    const answer = await page({ sort: "expiryDate", dir: "asc" }, row.id);
    expect(answer.contracts).toEqual([]);
    expect(answer.nextCursor).toBeNull();
  });
});

describe("what each sort key orders on", () => {
  it("folds case on a title sort, so one alphabet comes back and not two", async () => {
    const rows = mine(await walk({ sort: "title", dir: "asc" }));
    expect(rows).toHaveLength(FIXTURE_SIZE);
    const titles = rows.map((row) => row.title.toLowerCase());
    expect(titles).toEqual([...titles].sort());
    // Case-sensitive ordering would have put every "Zeta" before every
    // "alpha"; folded, the a-titles lead.
    expect(rows[0]!.title.startsWith("alpha")).toBe(true);
  });

  it("orders risk by DES-018's severity ramp, not by the slug's alphabet", async () => {
    const ramp = ["low", "medium", "high", "critical"] as const;
    const sample = made.slice(0, ramp.length);
    await Promise.all(
      sample.map((row, index) =>
        harness.db.update(contracts).set({ risk: ramp[index] }).where(eq(contracts.id, row.id)),
      ),
    );
    // Every other row's risk is cleared, so the four under test are the
    // only non-null values and lead the ascending walk.
    await harness.db
      .update(contracts)
      .set({ risk: null })
      .where(
        inArray(
          contracts.id,
          made.slice(ramp.length).map((row) => row.id),
        ),
      );

    const rows = mine(await walk({ sort: "risk", dir: "asc" }));
    expect(rows.slice(0, ramp.length).map((row) => row.id)).toEqual(sample.map((row) => row.id));
    // Alphabetically that order would be critical, high, low, medium.
    expect(rows[0]!.id).toBe(sample[0]!.id);
  });
});

describe("what the seam refuses", () => {
  it("refuses a sort key it does not know", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts?sort=noticeDeadline",
      cookies: memberCookies,
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a direction it does not know", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts?sort=title&dir=sideways",
      cookies: memberCookies,
    });
    expect(res.statusCode).toBe(400);
  });

  it("sorts ascending when a sort arrives without a direction", async () => {
    const withoutDir = await page({ sort: "expiryDate" });
    const ascending = await page({ sort: "expiryDate", dir: "asc" });
    expect(withoutDir.contracts.map((row) => row.id)).toEqual(
      ascending.contracts.map((row) => row.id),
    );
  });

  it("leaves the natural order alone when a direction arrives without a sort", async () => {
    const withDir = await page({ dir: "asc" });
    const natural = await page({});
    expect(withDir.contracts.map((row) => row.id)).toEqual(natural.contracts.map((row) => row.id));
  });
});
