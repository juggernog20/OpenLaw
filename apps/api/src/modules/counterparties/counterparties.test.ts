// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counterparty search (CTR-011, M8/4) at the HTTP seam — the one
 * read behind the shared typeahead, which contract intake reuses in
 * M20/M21. It finds by a fragment of the name, case-insensitively,
 * treats LIKE wildcards as literal characters, orders alphabetically,
 * leaves archived counterparties out, and answers a short list. Access
 * is Member+; Contributors and Business Users are refused.
 *
 * Counterparties are born inline on a contract, so the fixtures here go
 * in through the contract route that creates them — the same door a
 * Legal Team Member uses.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { counterparties, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS_USER = {
  email: "business@example.com",
  displayName: "Business User",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;

/** The names this suite files, in the order the search must answer. */
const FIXTURES = [
  "Helix Labs GmbH",
  "The Helix Group Ltd",
  "orion cloud ltd",
  "Zenith 50% Holdings",
  "Zenith_Underscore SA",
] as const;

/** Archived: out of the typeahead, still on every contract it signed. */
const ARCHIVED = "Helix Dissolved Ltd";

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS_USER, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  // One contract, and every fixture counterparty put on it by name —
  // inline creation is the only way a counterparty is born in M8.
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  const contractTypeId = (options.json().contractTypes as { id: string }[])[0]!.id;
  const contract = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title: "Counterparty search fixtures", contractTypeId },
  });
  expect(contract.statusCode, contract.body).toBe(201);
  const number = contract.json().contract.number as number;

  for (const name of [...FIXTURES, ARCHIVED]) {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${number}/counterparties`,
      cookies: adminCookies,
      payload: { name },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  await harness.db
    .update(counterparties)
    .set({ archivedAt: new Date() })
    .where(eq(counterparties.name, ARCHIVED));
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

const search = async (
  cookies: Record<string, string>,
  query?: string,
): Promise<{ id: string; name: string; jurisdiction: string | null }[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/counterparties${query === undefined ? "" : `?query=${encodeURIComponent(query)}`}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().counterparties;
};

describe("GET /counterparties — the shared typeahead's read", () => {
  it("finds a counterparty by any fragment of its name, ignoring case", async () => {
    // Contains, not starts-with: "Helix" has to find "The Helix Group
    // Ltd", or the typeahead invites a duplicate of it.
    expect((await search(memberCookies, "helix")).map((row) => row.name)).toEqual([
      "Helix Labs GmbH",
      "The Helix Group Ltd",
    ]);
    // The stored casing is answered back, whatever was typed.
    expect((await search(memberCookies, "ORION")).map((row) => row.name)).toEqual([
      "orion cloud ltd",
    ]);
  });

  it("orders alphabetically, whatever case the names were filed in", async () => {
    const names = (await search(memberCookies)).map((row) => row.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    );
    // "orion cloud ltd" files under O, not after every capital letter.
    expect(names.indexOf("orion cloud ltd")).toBeLessThan(names.indexOf("The Helix Group Ltd"));
  });

  it("treats LIKE wildcards in the query as ordinary characters", async () => {
    // Unescaped, "%" matches any run of characters, so a bare percent
    // sign would offer the whole book instead of the one name with a
    // percent sign in it.
    expect((await search(memberCookies, "%")).map((row) => row.name)).toEqual([
      "Zenith 50% Holdings",
    ]);
    // Unescaped, "_" matches any one character, so this would find
    // "Zenith 50% Holdings" through the space.
    expect((await search(memberCookies, "Zenith_5")).map((row) => row.name)).toEqual([]);
    // The same underscore, typed where the name really has one, finds it.
    expect((await search(memberCookies, "Zenith_U")).map((row) => row.name)).toEqual([
      "Zenith_Underscore SA",
    ]);
  });

  it("never offers an archived counterparty", async () => {
    expect((await search(adminCookies, "Helix")).map((row) => row.name)).not.toContain(ARCHIVED);
    expect((await search(adminCookies)).map((row) => row.name)).not.toContain(ARCHIVED);
  });

  it("answers an empty query with the live names in order, so the picker opens onto something", async () => {
    expect((await search(memberCookies)).map((row) => row.name)).toEqual(
      [...FIXTURES].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    );
    // A query nothing matches is an empty list, not a refusal — that is
    // what tells the typeahead to offer creating the name instead.
    expect(await search(memberCookies, "nobody by that name")).toEqual([]);
  });

  it("carries the jurisdiction that tells two same-named organizations apart", async () => {
    const [helix] = await search(memberCookies, "Helix Labs");
    // Inline creation writes a name and nothing else (CTR-011), so the
    // disambiguator is empty until an enrichment surface fills it.
    expect(helix).toEqual({ id: expect.any(String), name: "Helix Labs GmbH", jurisdiction: null });

    await harness.db
      .update(counterparties)
      .set({ jurisdiction: "Germany" })
      .where(eq(counterparties.id, helix!.id));
    expect((await search(memberCookies, "Helix Labs"))[0]!.jurisdiction).toBe("Germany");
  });

  it("holds the whole book to Member+", async () => {
    const anonymous = await harness.app.inject({ method: "GET", url: "/api/v1/counterparties" });
    expect(anonymous.statusCode, anonymous.body).toBe(401);

    const contributorCookies = await signInCookies(
      harness.app,
      CONTRIBUTOR.email,
      CONTRIBUTOR.password,
    );
    const contributorRefused = await harness.app.inject({
      method: "GET",
      url: "/api/v1/counterparties",
      cookies: contributorCookies,
    });
    expect(contributorRefused.statusCode, contributorRefused.body).toBe(403);
    expect(contributorRefused.headers["content-type"]).toContain("application/problem+json");

    const businessCookies = await signInCookies(
      harness.app,
      BUSINESS_USER.email,
      BUSINESS_USER.password,
    );
    const businessRefused = await harness.app.inject({
      method: "GET",
      url: "/api/v1/counterparties",
      cookies: businessCookies,
    });
    expect(businessRefused.statusCode, businessRefused.body).toBe(403);
    expect(businessRefused.headers["content-type"]).toContain("application/problem+json");
  });

  // Last in the file on purpose: it fills the book, and the cases above
  // assert exactly which names come back.
  it("answers at most one screenful, however many names match", async () => {
    // Bulk fixtures go straight in — creating them one contract call at
    // a time would test the add route, which has its own suite.
    await harness.db.insert(counterparties).values(
      // 30 names, all sorting after the fixtures above, so the cap is
      // what limits the answer and not the alphabet.
      Array.from({ length: 30 }, (_, index) => ({
        name: `Zzz Bulk ${String(index).padStart(2, "0")} Ltd`,
      })),
    );
    // The route's own SEARCH_LIMIT: a typeahead is read at a glance, so
    // a longer list is the same answer with more scrolling.
    expect(await search(memberCookies, "Zzz Bulk")).toHaveLength(20);
    expect(await search(memberCookies)).toHaveLength(20);
  });
});
