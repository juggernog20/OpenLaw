// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's approvals (#233): CTR-012's manual sign-off at the HTTP
 * seam, through the real-Postgres harness.
 *
 * Four acts and their refusals. **Asking** — several colleagues at
 * once, in parallel, with a Contributor, a Business User, an archived
 * person, and somebody outside a confidential record's audience each
 * refused by name, and a second pending ask at the same person refused
 * too. **Deciding** — only the named approver, with an optional note,
 * once and once only. **Re-asking** — a rejection does not block, so a
 * fixed draft goes back to the same person as a new row beneath the old
 * one. **Cancelling** — the requester, the Owner, and an Administrator
 * may; a teammate may not; a decided request never is.
 *
 * Reach is asserted the way the confidentiality suite asserts it: a
 * viewer outside a walled record's audience gets the missing-record
 * 404 on the roster and on every write, so a request leaks no more than
 * a read.
 *
 * Activity is read straight from the table, as the contract-statuses
 * and approver-group suites already do — the record feed has its own
 * tests, and what is asserted here is that the four verbs land with the
 * right actor, tier, and payload.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, contracts, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who asks, on the team of every record here. */
const MEMBER = {
  email: "appr-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** The first approver. */
const FIRST = {
  email: "appr-first@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery",
} as const;
/** The second, so parallel means something. */
const SECOND = {
  email: "appr-second@example.com",
  displayName: "Marcus Webb",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member who neither asked nor owns: the viewer
 * cancellation answers 403. */
const TEAMMATE = {
  email: "appr-teammate@example.com",
  displayName: "Tomas Teammate",
  password: "correct-horse-battery",
} as const;
/** The Owner (CTR-004) — one of cancellation's three actors. */
const OWNER = {
  email: "appr-owner@example.com",
  displayName: "Priya Owner",
  password: "correct-horse-battery",
} as const;
/** Never an approver (DD-013), and the record's read-only viewer. */
const CONTRIBUTOR = {
  email: "appr-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** Never an approver either, and reaches no contract at all. */
const BUSINESS = {
  email: "appr-business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;
/** Has left (SET-005): a request addressed to them reaches nobody. */
const DEPARTED = {
  email: "appr-departed@example.com",
  displayName: "Sam Gone",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};
const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

interface ApprovalRow {
  id: string;
  approver: { id: string; displayName: string; image: string | null };
  requestedBy: { id: string; displayName: string; image: string | null };
  source: string;
  groupName: string | null;
  status: string;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
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
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [FIRST, "legal_team_member"],
    [SECOND, "legal_team_member"],
    [TEAMMATE, "legal_team_member"],
    [OWNER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
    [DEPARTED, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
  // Archived after the sign-in, so the fixture still has a session to
  // be refused with rather than one it could never have had.
  await harness.db
    .update(users)
    .set({ archivedAt: new Date() })
    .where(eq(users.id, idOf(DEPARTED)));
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(ADMIN),
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

/** A contract the asking Member made, so they hold its `creator` row. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(MEMBER),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

const listApprovals = (jar: Record<string, string>, number: number) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}/approvals`, cookies: jar });

const requestApprovals = (jar: Record<string, string>, number: number, approverIds: string[]) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/approvals`,
    cookies: jar,
    payload: { approverIds },
  });

const decide = (
  jar: Record<string, string>,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string,
) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/approvals/${approvalId}/decision`,
    cookies: jar,
    payload: note === undefined ? { decision } : { decision, note },
  });

const cancel = (jar: Record<string, string>, approvalId: string) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/approvals/${approvalId}`, cookies: jar });

/** The roster, requiring success. */
async function roster(jar: Record<string, string>, number: number): Promise<ApprovalRow[]> {
  const res = await listApprovals(jar, number);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().approvals as ApprovalRow[];
}

/** Asks for approvals, requiring success, and answers the roster. */
async function ask(number: number, approverIds: string[]): Promise<ApprovalRow[]> {
  const res = await requestApprovals(as(MEMBER), number, approverIds);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approvals as ApprovalRow[];
}

const APPROVAL_ACTIONS = [
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.cancelled",
] as const;

/** Every approval entry on one contract, oldest first. */
const entriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(eq(activityLog.entityId, contractId), inArray(activityLog.action, [...APPROVAL_ACTIONS])),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** Walls a record off straight in the column: a fixture that makes a
 * record confidential is not the subject of an approvals test. */
const wallOff = (contractId: string) =>
  harness.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contractId));

/** Puts somebody on a contract's team, which is what grants a
 * Contributor their reach and what puts a Member+ inside a walled
 * record's audience. */
const addToTeam = (number: number, userId: string, role = "member") =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: as(MEMBER),
    payload: { userId, role },
  });

describe("requesting approvals", () => {
  it("asks several Member+ colleagues at once, and every one of them is pending", async () => {
    const contract = await newContract("Parallel asks");
    const rows = await ask(contract.number, [idOf(FIRST), idOf(SECOND)]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.approver.displayName).sort()).toEqual(
      [SECOND.displayName, FIRST.displayName].sort(),
    );
    for (const row of rows) {
      expect(row.status).toBe("pending");
      expect(row.source).toBe("manual");
      expect(row.groupName).toBeNull();
      expect(row.note).toBeNull();
      expect(row.decidedAt).toBeNull();
      expect(row.requestedBy.id).toBe(idOf(MEMBER));
    }
  });

  it("refuses a Contributor and a Business User as approvers, by name", async () => {
    const contract = await newContract("Not approvers");

    const contributor = await requestApprovals(as(MEMBER), contract.number, [idOf(CONTRIBUTOR)]);
    expect(contributor.statusCode, contributor.body).toBe(422);
    expect(contributor.json().detail).toContain(CONTRIBUTOR.displayName);

    const business = await requestApprovals(as(MEMBER), contract.number, [idOf(BUSINESS)]);
    expect(business.statusCode, business.body).toBe(422);
    expect(business.json().detail).toContain(BUSINESS.displayName);

    expect(await roster(as(MEMBER), contract.number)).toEqual([]);
  });

  it("refuses an archived person, because the ask would reach nobody", async () => {
    const contract = await newContract("Archived approver");
    const res = await requestApprovals(as(MEMBER), contract.number, [idOf(DEPARTED)]);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain(DEPARTED.displayName);
  });

  it("refuses an approver who cannot see a confidential contract", async () => {
    const contract = await newContract("Walled record");
    await wallOff(contract.id);

    // FIRST holds no team row and is not the Owner, so the record is
    // not theirs to see — and therefore not theirs to approve.
    const refused = await requestApprovals(as(MEMBER), contract.number, [idOf(FIRST)]);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().detail).toContain(FIRST.displayName);

    // Put them on the team and the same ask lands.
    expect((await addToTeam(contract.number, idOf(FIRST))).statusCode).toBe(201);
    const allowed = await requestApprovals(as(MEMBER), contract.number, [idOf(FIRST)]);
    expect(allowed.statusCode, allowed.body).toBe(201);
  });

  it("refuses a second pending request for the same approver", async () => {
    const contract = await newContract("One ask at a time");
    await ask(contract.number, [idOf(FIRST)]);

    const again = await requestApprovals(as(MEMBER), contract.number, [idOf(FIRST)]);
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().detail).toContain(FIRST.displayName);
    expect(await roster(as(MEMBER), contract.number)).toHaveLength(1);
  });

  it("refuses the whole ask when one named person is refused", async () => {
    const contract = await newContract("All or nothing");
    const res = await requestApprovals(as(MEMBER), contract.number, [
      idOf(FIRST),
      idOf(CONTRIBUTOR),
    ]);
    expect(res.statusCode, res.body).toBe(422);
    // Nothing was written: the eligible half of the list must not land
    // while the other half is refused.
    expect(await roster(as(MEMBER), contract.number)).toEqual([]);
  });

  it("takes no request on an archived contract", async () => {
    const contract = await newContract("Frozen record");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: as(MEMBER),
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await requestApprovals(as(MEMBER), contract.number, [idOf(FIRST)]);
    expect(res.statusCode, res.body).toBe(409);
  });

  it("refuses a Contributor's ask and a Business User's alike, both plainly", async () => {
    const contract = await newContract("Who may ask");
    expect((await addToTeam(contract.number, idOf(CONTRIBUTOR), "contributor")).statusCode).toBe(
      201,
    );

    const onTeam = await requestApprovals(as(CONTRIBUTOR), contract.number, [idOf(FIRST)]);
    expect(onTeam.statusCode, onTeam.body).toBe(403);

    const stranger = await requestApprovals(as(BUSINESS), contract.number, [idOf(FIRST)]);
    expect(stranger.statusCode, stranger.body).toBe(403);
  });
});

describe("deciding an approval", () => {
  it("lets the named approver approve with a note, and nobody else decide", async () => {
    const contract = await newContract("Approve with a note");
    const [row] = await ask(contract.number, [idOf(FIRST)]);

    const impostor = await decide(as(SECOND), row!.id, "approved");
    expect(impostor.statusCode, impostor.body).toBe(403);
    const requester = await decide(as(MEMBER), row!.id, "approved");
    expect(requester.statusCode, requester.body).toBe(403);
    const administrator = await decide(as(ADMIN), row!.id, "approved");
    expect(administrator.statusCode, administrator.body).toBe(403);

    const decided = await decide(as(FIRST), row!.id, "approved", "Clear on commercials.");
    expect(decided.statusCode, decided.body).toBe(200);
    const [after] = decided.json().approvals as ApprovalRow[];
    expect(after).toMatchObject({
      status: "approved",
      note: "Clear on commercials.",
    });
    expect(after!.decidedAt).not.toBeNull();
  });

  it("takes a rejection with no note at all", async () => {
    const contract = await newContract("Reject without a note");
    const [row] = await ask(contract.number, [idOf(FIRST)]);

    const res = await decide(as(FIRST), row!.id, "rejected");
    expect(res.statusCode, res.body).toBe(200);
    const [after] = res.json().approvals as ApprovalRow[];
    expect(after).toMatchObject({ status: "rejected", note: null });
    expect(after!.decidedAt).not.toBeNull();
  });

  it("never re-decides a decided request", async () => {
    const contract = await newContract("Decisions are final");
    const [row] = await ask(contract.number, [idOf(FIRST)]);
    expect((await decide(as(FIRST), row!.id, "approved")).statusCode).toBe(200);

    const again = await decide(as(FIRST), row!.id, "rejected");
    expect(again.statusCode, again.body).toBe(409);
    expect((await roster(as(MEMBER), contract.number))[0]).toMatchObject({ status: "approved" });
  });

  it("takes the same person again after a rejection, as a new row", async () => {
    const contract = await newContract("Re-request after a rejection");
    const [first] = await ask(contract.number, [idOf(FIRST)]);
    expect((await decide(as(FIRST), first!.id, "rejected", "Fix clause 7.")).statusCode).toBe(200);

    const rows = await ask(contract.number, [idOf(FIRST)]);
    expect(rows).toHaveLength(2);
    // Oldest ask first, so the rejection reads above the ask that
    // answers it.
    expect(rows[0]).toMatchObject({ id: first!.id, status: "rejected", note: "Fix clause 7." });
    expect(rows[1]).toMatchObject({ status: "pending", note: null });
    expect(rows[1]!.id).not.toBe(first!.id);
  });

  it("lets an approver approve a contract they asked about themselves", async () => {
    const contract = await newContract("Self-approval is allowed");
    const [row] = await ask(contract.number, [idOf(MEMBER)]);
    const res = await decide(as(MEMBER), row!.id, "approved");
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe("cancelling an approval", () => {
  it("lets the requester, the Owner, and an Administrator cancel, and nobody else", async () => {
    const contract = await newContract("Who may cancel");
    const owned = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(MEMBER),
      payload: { managerId: idOf(OWNER) },
    });
    expect(owned.statusCode, owned.body).toBe(200);

    const [byTeammate] = await ask(contract.number, [idOf(FIRST)]);
    const refused = await cancel(as(TEAMMATE), byTeammate!.id);
    expect(refused.statusCode, refused.body).toBe(403);
    // The approver is not one of the three either: their answer is a
    // decision, not a withdrawal.
    expect((await cancel(as(FIRST), byTeammate!.id)).statusCode).toBe(403);
    expect((await cancel(as(MEMBER), byTeammate!.id)).statusCode).toBe(200);

    const [byOwner] = await ask(contract.number, [idOf(FIRST)]);
    expect((await cancel(as(OWNER), byOwner!.id)).statusCode).toBe(200);

    const [byAdmin] = await ask(contract.number, [idOf(FIRST)]);
    expect((await cancel(as(ADMIN), byAdmin!.id)).statusCode).toBe(200);

    expect(await roster(as(MEMBER), contract.number)).toEqual([]);
  });

  it("never cancels a decided request", async () => {
    const contract = await newContract("Decided rows stay");
    const [row] = await ask(contract.number, [idOf(FIRST)]);
    expect((await decide(as(FIRST), row!.id, "approved")).statusCode).toBe(200);

    const res = await cancel(as(MEMBER), row!.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(await roster(as(MEMBER), contract.number)).toHaveLength(1);
  });

  it("frees the approver for a fresh ask", async () => {
    const contract = await newContract("Cancel then ask again");
    const [row] = await ask(contract.number, [idOf(FIRST)]);
    expect((await cancel(as(MEMBER), row!.id)).statusCode).toBe(200);

    const again = await ask(contract.number, [idOf(FIRST)]);
    expect(again).toHaveLength(1);
    expect(again[0]!.status).toBe("pending");
  });
});

describe("who reaches the roster", () => {
  it("shows a Contributor on the team who was asked, and refuses one who is not", async () => {
    const contract = await newContract("Roster reach");
    await ask(contract.number, [idOf(FIRST)]);
    expect((await addToTeam(contract.number, idOf(CONTRIBUTOR), "contributor")).statusCode).toBe(
      201,
    );

    expect(await roster(as(CONTRIBUTOR), contract.number)).toHaveLength(1);

    const business = await listApprovals(as(BUSINESS), contract.number);
    expect(business.statusCode, business.body).toBe(403);
  });

  it("hides a confidential record's roster, and every write on it, from outsiders", async () => {
    const contract = await newContract("Walled roster");
    expect((await addToTeam(contract.number, idOf(FIRST))).statusCode).toBe(201);
    const [row] = await ask(contract.number, [idOf(FIRST)]);
    await wallOff(contract.id);

    // TEAMMATE reaches every open contract and none of this one.
    const read = await listApprovals(as(TEAMMATE), contract.number);
    expect(read.statusCode, read.body).toBe(404);
    const asked = await requestApprovals(as(TEAMMATE), contract.number, [idOf(SECOND)]);
    expect(asked.statusCode, asked.body).toBe(404);
    const decided = await decide(as(TEAMMATE), row!.id, "approved");
    expect(decided.statusCode, decided.body).toBe(404);
    const cancelled = await cancel(as(TEAMMATE), row!.id);
    expect(cancelled.statusCode, cancelled.body).toBe(404);

    // And the same answers a contract nobody ever made gives.
    expect((await listApprovals(as(TEAMMATE), 999_999)).statusCode).toBe(404);
    expect((await requestApprovals(as(TEAMMATE), 999_999, [idOf(FIRST)])).statusCode).toBe(404);
  });

  it("answers 404 for an approval id that does not exist", async () => {
    const res = await decide(as(MEMBER), "not-an-approval", "approved");
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the activity the record keeps", () => {
  it("narrates one entry per person asked, at the working-team tier", async () => {
    const contract = await newContract("Narrated asks");
    await ask(contract.number, [idOf(FIRST), idOf(SECOND)]);

    const entries = await entriesOn(contract.id);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.action).toBe("approval.requested");
      expect(entry.visibility).toBe("working_team");
      expect(entry.actorId).toBe(idOf(MEMBER));
      expect(entry.entityType).toBe("contract");
    }
    expect(
      entries.map((entry) => (entry.payload as { approverName: string }).approverName),
    ).toEqual(expect.arrayContaining([FIRST.displayName, SECOND.displayName]));
  });

  it("narrates an approval, a rejection, and a cancellation as their own verbs", async () => {
    const contract = await newContract("Narrated decisions");
    const [approved, rejected, cancelled] = await ask(contract.number, [
      idOf(FIRST),
      idOf(SECOND),
      idOf(TEAMMATE),
    ]);
    expect((await decide(as(FIRST), approved!.id, "approved", "Fine.")).statusCode).toBe(200);
    expect((await decide(as(SECOND), rejected!.id, "rejected")).statusCode).toBe(200);
    expect((await cancel(as(MEMBER), cancelled!.id)).statusCode).toBe(200);

    const entries = await entriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual([
      "approval.requested",
      "approval.requested",
      "approval.requested",
      "approval.approved",
      "approval.rejected",
      "approval.cancelled",
    ]);

    const decision = entries[3]!;
    expect(decision.actorId).toBe(idOf(FIRST));
    // Whether a note was given, never the words: the log is
    // append-only and the row it came from can be cancelled away.
    expect(decision.payload).toMatchObject({ hasNote: true, approverName: FIRST.displayName });
    expect(JSON.stringify(decision.payload)).not.toContain("Fine.");

    // The cancellation is the only thing left saying the ask was made,
    // so it names the person.
    expect(entries[5]!.payload).toMatchObject({ approverName: TEAMMATE.displayName });
    expect(entries[5]!.actorId).toBe(idOf(MEMBER));
  });
});
