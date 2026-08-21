// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Inbox list (#413): the staff read of the Requests whose fate is
 * undecided, at the seam the Inbox screen calls.
 *
 * What a Request *is* — how it is submitted, what a form collects — is
 * the `requests.test.ts` suite's subject and is not re-asserted here.
 * This suite covers the four things the staff read answers for: who may
 * ask (Member+ and nobody else, INT-006), which Requests are in the
 * answer (`new` alone, until the triaged toggle widens it, INT-007),
 * what order they come in (urgency rank then age, INT-006), and how a
 * long queue is paged (the house keyset pattern).
 *
 * Rows are arranged straight against the table where the ask is about a
 * status no route writes yet — disposition is #418's and #419's — so
 * the suite can pin the scope rule before the routes that reach it
 * exist.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractTeam,
  contractTypes,
  eq,
  requests,
  requestTypes,
  users,
  type RequestStatus,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery",
} as const;

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

/** One row of the Inbox, as the staff read answers it. */
interface InboxRow {
  id: string;
  number: number;
  status: RequestStatus;
  summary: string;
  urgency: string;
  requestType: {
    id: string;
    displayName: string;
    targetModule: "matter" | "contract" | null;
    targetTypeName: string | null;
  };
  requester: { id: string; displayName: string };
  createdAt: string;
  convertedContract: { number: number } | null;
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let requesterId: string;
/** The INT-002 seeds, by slug. */
let typeIds: Map<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === REQUESTER) requesterId = user.id;
  }

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await harnessSignInCookies(
    harness.app,
    CONTRIBUTOR.email,
    CONTRIBUTOR.password,
  );
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);

  const rows = await harness.db
    .select({ id: requestTypes.id, slug: requestTypes.slug })
    .from(requestTypes);
  typeIds = new Map(rows.map((row) => [row.slug, row.id]));
});

afterAll(async () => {
  await harness.stop();
});

/** Every Request this suite planted, cleared between cases so each one
 * states its own queue. */
async function clearRequests() {
  await harness.db.delete(requests);
}

/**
 * One Request on the table.
 *
 * Written straight rather than submitted, because most of what this
 * suite asks about is a status or an age no route can set: disposition
 * lands in #418, and a submission is always born `new` and always born
 * now.
 */
async function plant(row: {
  summary: string;
  urgency: "low" | "medium" | "high" | "critical";
  createdAt: Date;
  status?: RequestStatus;
  slug?: string;
  convertedContractId?: string;
  archivedAt?: Date;
}) {
  const [planted] = await harness.db
    .insert(requests)
    .values({
      requestTypeId: typeIds.get(row.slug ?? "nda_request")!,
      requesterId,
      summary: row.summary,
      description: "The ask, in full.",
      urgency: row.urgency,
      status: row.status ?? "new",
      createdAt: row.createdAt,
      convertedContractId: row.convertedContractId,
      archivedAt: row.archivedAt,
    })
    .returning();
  return planted!;
}

/** The Inbox as one caller reads it. */
async function readInbox(
  cookies: Record<string, string>,
  query: Record<string, string> = {},
): Promise<{ statusCode: number; requests: InboxRow[]; nextCursor: string | null; body: string }> {
  const search = new URLSearchParams(query).toString();
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/requests${search === "" ? "" : `?${search}`}`,
    cookies,
  });
  const parsed: { requests?: InboxRow[]; nextCursor?: string | null } =
    res.statusCode === 200 ? res.json() : {};
  return {
    statusCode: res.statusCode,
    requests: parsed.requests ?? [],
    nextCursor: parsed.nextCursor ?? null,
    body: res.body,
  };
}

/** Fixed points on the clock, so "oldest first" is a fact rather than a
 * race with the insert. */
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-20T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe("who may open the Inbox (INT-006, DD-013)", () => {
  it("answers an Administrator and a Legal Team Member", async () => {
    await clearRequests();
    for (const cookies of [adminCookies, memberCookies]) {
      const read = await readInbox(cookies);
      expect(read.statusCode, read.body).toBe(200);
    }
  });

  it("refuses a Contributor and a Business User with 403", async () => {
    for (const cookies of [contributorCookies, requesterCookies]) {
      const read = await readInbox(cookies);
      expect(read.statusCode, read.body).toBe(403);
    }
  });

  it("refuses a caller with no session", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/requests" });
    expect(res.statusCode, res.body).toBe(401);
  });
});

describe("what is in the queue (INT-007)", () => {
  it("answers exactly the `new` Requests by default", async () => {
    await clearRequests();
    await plant({ summary: "Still open", urgency: "medium", createdAt: ago(2) });
    for (const status of ["converted", "resolved", "declined"] as const) {
      await plant({ summary: `Already ${status}`, urgency: "medium", createdAt: ago(1), status });
    }

    const read = await readInbox(memberCookies);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.requests.map((row) => row.summary)).toEqual(["Still open"]);
  });

  it("reveals the triaged Requests with their outcome when asked", async () => {
    await clearRequests();
    await plant({ summary: "Still open", urgency: "medium", createdAt: ago(2) });
    for (const status of ["converted", "resolved", "declined"] as const) {
      await plant({ summary: `Already ${status}`, urgency: "medium", createdAt: ago(1), status });
    }

    const read = await readInbox(memberCookies, { includeTriaged: "true" });
    expect(read.statusCode, read.body).toBe(200);
    const outcomes = new Map(read.requests.map((row) => [row.summary, row.status]));
    expect(outcomes.get("Still open")).toBe("new");
    expect(outcomes.get("Already converted")).toBe("converted");
    expect(outcomes.get("Already resolved")).toBe("resolved");
    expect(outcomes.get("Already declined")).toBe("declined");
  });

  it("leaves an archived Request out of both views", async () => {
    await clearRequests();
    await plant({
      summary: "Archived away",
      urgency: "critical",
      createdAt: ago(1),
      archivedAt: NOW,
    });
    for (const query of [{}, { includeTriaged: "true" }] as Record<string, string>[]) {
      const read = await readInbox(memberCookies, query);
      expect(read.requests).toEqual([]);
    }
  });

  it("renders an empty queue as an empty list, never a refusal", async () => {
    await clearRequests();
    const read = await readInbox(memberCookies);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.requests).toEqual([]);
    expect(read.nextCursor).toBeNull();
  });
});

describe("the order the queue reads in (INT-006)", () => {
  it("puts the hottest first, and the oldest first inside one urgency", async () => {
    await clearRequests();
    // Planted out of order on both axes, so neither insertion order nor
    // the reference sequence could produce the expected answer.
    await plant({ summary: "medium, 1h", urgency: "medium", createdAt: ago(1) });
    await plant({ summary: "critical, 1h", urgency: "critical", createdAt: ago(1) });
    await plant({ summary: "low, 100h", urgency: "low", createdAt: ago(100) });
    await plant({ summary: "critical, 5h", urgency: "critical", createdAt: ago(5) });
    await plant({ summary: "high, 2h", urgency: "high", createdAt: ago(2) });
    await plant({ summary: "medium, 50h", urgency: "medium", createdAt: ago(50) });

    const read = await readInbox(memberCookies);
    expect(read.requests.map((row) => row.summary)).toEqual([
      "critical, 5h",
      "critical, 1h",
      "high, 2h",
      "medium, 50h",
      "medium, 1h",
      "low, 100h",
    ]);
  });
});

describe("paging the queue (the house keyset pattern)", () => {
  it("carries the ordering across pages, skipping and repeating nothing", async () => {
    await clearRequests();
    // Two urgencies, so the boundary is crossed inside a page rather
    // than only between them.
    const planted: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const summary = `Queued ${String(index).padStart(2, "0")}`;
      await plant({
        summary,
        urgency: index < 30 ? "high" : "low",
        createdAt: ago(200 - index),
      });
      planted.push(summary);
    }

    const first = await readInbox(memberCookies);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.requests).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await readInbox(memberCookies, { cursor: first.nextCursor! });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.requests).toHaveLength(10);
    expect(second.nextCursor).toBeNull();

    const read = [...first.requests, ...second.requests].map((row) => row.summary);
    expect(new Set(read).size).toBe(60);
    // The whole queue, in the one ordering: the thirty `high` rows
    // oldest first, then the thirty `low` ones.
    expect(read).toEqual([...planted.slice(0, 30), ...planted.slice(30)]);
  });

  it("refuses a cursor that names nothing with an empty page, not an error", async () => {
    await clearRequests();
    await plant({ summary: "Still open", urgency: "medium", createdAt: ago(2) });

    // The boundary is read out of the table; a cursor naming no Request
    // resolves every comparison to NULL and the answer is a page of
    // nothing — the house rule the contract list already pins.
    const nowhere = await readInbox(memberCookies, {
      cursor: "00000000-0000-7000-8000-000000000000",
    });
    expect(nowhere.statusCode, nowhere.body).toBe(200);
    expect(nowhere.requests).toEqual([]);
    expect(nowhere.nextCursor).toBeNull();
  });

  it("refuses a cursor outside its own bound before it reaches the database", async () => {
    for (const shape of ["", "x".repeat(65)]) {
      const bad = await readInbox(memberCookies, { cursor: shape });
      expect(bad.statusCode, bad.body).toBe(400);
    }
  });
});

describe("what one row carries (INT-007, I1)", () => {
  it("names the reference, the ask, the type and its target, the requester, and the age", async () => {
    await clearRequests();
    const stored = await plant({
      summary: "NDA with Northwind Labs",
      urgency: "high",
      createdAt: ago(3),
      slug: "nda_request",
    });

    const read = await readInbox(memberCookies);
    const row = read.requests[0]!;
    expect(row).toMatchObject({
      id: stored.id,
      number: stored.number,
      status: "new",
      summary: "NDA with Northwind Labs",
      urgency: "high",
      requestType: { displayName: "NDA request", targetModule: "contract", targetTypeName: "NDA" },
      requester: { id: requesterId, displayName: REQUESTER.displayName },
      convertedContract: null,
    });
    expect(new Date(row.createdAt).toISOString()).toBe(ago(3).toISOString());
  });

  it("reads a module-only target as the module alone, and no target as neither", async () => {
    await clearRequests();
    await plant({
      summary: "Redline review",
      urgency: "high",
      createdAt: ago(2),
      slug: "contract_review",
    });
    await plant({
      summary: "One-off question",
      urgency: "high",
      createdAt: ago(1),
      slug: "legal_question",
    });

    const read = await readInbox(memberCookies);
    expect(read.requests.map((row) => row.requestType)).toMatchObject([
      { displayName: "Contract review", targetModule: "contract", targetTypeName: null },
      { displayName: "Legal question", targetModule: null, targetTypeName: null },
    ]);
  });
});

describe("the trail from ask to work (DD-014, CTR-018)", () => {
  /** One contract, created through the ordinary create door. */
  async function createContract(title: string, isConfidential: boolean) {
    const [type] = await harness.db.select().from(contractTypes).limit(1);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: adminCookies,
      payload: { title, contractTypeId: type!.id, isConfidential },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().contract as { id: string; number: number };
  }

  it("links a converted Request to the record it became", async () => {
    await clearRequests();
    const contract = await createContract("Northwind Labs NDA", false);
    await plant({
      summary: "NDA with Northwind Labs",
      urgency: "high",
      createdAt: ago(3),
      status: "converted",
      convertedContractId: contract.id,
    });

    const read = await readInbox(memberCookies, { includeTriaged: "true" });
    expect(read.requests[0]?.convertedContract).toEqual({ number: contract.number });
  });

  it("draws no link when the viewer cannot reach the record, and still shows the row", async () => {
    await clearRequests();
    // Confidential and created by the Administrator, so the Legal Team
    // Member is neither its Owner nor on its team (DD-014).
    const contract = await createContract("Project Cormorant", true);
    await plant({
      summary: "Something quiet",
      urgency: "high",
      createdAt: ago(3),
      status: "converted",
      convertedContractId: contract.id,
    });

    const withheld = await readInbox(memberCookies, { includeTriaged: "true" });
    expect(withheld.requests).toHaveLength(1);
    expect(withheld.requests[0]).toMatchObject({
      summary: "Something quiet",
      status: "converted",
      // The withholding is the server's decision, and the row survives
      // it: the Request is still triage's business.
      convertedContract: null,
    });

    // The same row, for a viewer who does reach the record.
    const reached = await readInbox(adminCookies, { includeTriaged: "true" });
    expect(reached.requests[0]?.convertedContract).toEqual({ number: contract.number });
  });

  it("links for a Member+ named on an otherwise confidential record", async () => {
    await clearRequests();
    const contract = await createContract("Project Kestrel", true);
    const [member] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, MEMBER.email));
    await harness.db
      .insert(contractTeam)
      .values({ contractId: contract.id, userId: member!.id, role: "member" });
    await plant({
      summary: "Something quiet, shared",
      urgency: "high",
      createdAt: ago(3),
      status: "converted",
      convertedContractId: contract.id,
    });

    const read = await readInbox(memberCookies, { includeTriaged: "true" });
    expect(read.requests[0]?.convertedContract).toEqual({ number: contract.number });
  });

  it("draws no link once the record is archived, and still shows the row", async () => {
    await clearRequests();
    const contract = await createContract("Northwind Labs NDA, retired", false);
    await plant({
      summary: "NDA that ran its course",
      urgency: "high",
      createdAt: ago(3),
      status: "converted",
      convertedContractId: contract.id,
    });
    // An archived contract is no trail: the link would open on a record
    // the Contracts destination hides.
    await harness.db
      .update(contracts)
      .set({ archivedAt: NOW })
      .where(eq(contracts.id, contract.id));

    const read = await readInbox(memberCookies, { includeTriaged: "true" });
    expect(read.requests).toHaveLength(1);
    expect(read.requests[0]).toMatchObject({
      summary: "NDA that ran its course",
      status: "converted",
      convertedContract: null,
    });
  });
});
