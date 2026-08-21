// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Applying an approver group to a contract (#234): CTR-012's reusable
 * sign-off template turned into requests, at the HTTP seam through the
 * real-Postgres harness.
 *
 * **The snapshot is the point.** Applying writes one row per current
 * unarchived member, stamped with the group it came from, and then
 * nothing about the template is read again: the suite renames it, edits
 * its members, and archives it, and asserts the rows the apply produced
 * are untouched by all three.
 *
 * **A set, not a list of names.** Somebody who already holds a pending
 * request is skipped rather than refused, because applying a group is
 * one act about a set. A group with nobody left to ask — no members, or
 * every member already asked — is refused as the no-op it would be.
 *
 * **Everything else is the named ask's rule.** A member who is no
 * longer Member+ is refused by name; a member outside a confidential
 * record's audience is refused by name; an outsider is answered the
 * missing-record 404. Those are asserted here because a second door on
 * the same table is exactly where a guard goes missing.
 *
 * Activity is read straight from the table, as the sibling suites do.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, contracts, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who applies, on the team of every record here. */
const MEMBER = {
  email: "grp-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** The first member of the template. */
const FIRST = {
  email: "grp-first@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery",
} as const;
/** The second, so a group means more than one person. */
const SECOND = {
  email: "grp-second@example.com",
  displayName: "Marcus Webb",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member who joins a template after it has been applied,
 * which is what proves the snapshot. */
const LATE = {
  email: "grp-late@example.com",
  displayName: "Priya Nair",
  password: "correct-horse-battery",
} as const;
/** Member+ when they joined the template, and demoted afterwards:
 * DD-013 says the record must then refuse them by name. */
const DEMOTED = {
  email: "grp-demoted@example.com",
  displayName: "Dana Demoted",
  password: "correct-horse-battery",
} as const;
/** Has left (SET-005): skipped by the apply rather than refused. */
const DEPARTED = {
  email: "grp-departed@example.com",
  displayName: "Sam Gone",
  password: "correct-horse-battery",
} as const;
/** Never an approver (DD-013), and the record's read-only viewer. */
const CONTRIBUTOR = {
  email: "grp-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** Reaches every open contract and none of a walled one. */
const OUTSIDER = {
  email: "grp-outsider@example.com",
  displayName: "Tomas Outsider",
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
}

interface ApprovalRow {
  id: string;
  approver: { id: string; displayName: string };
  requestedBy: { id: string; displayName: string };
  source: string;
  groupName: string | null;
  status: string;
  decidedAt: string | null;
}

interface GroupOption {
  id: string;
  name: string;
  memberIds: string[];
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
    [LATE, "legal_team_member"],
    [DEMOTED, "legal_team_member"],
    [DEPARTED, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [OUTSIDER, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
});

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

/** A contract the applying Member made, so they hold its `creator` row. */
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

/** A template, made by the only role that may make one (SET-002). */
async function newGroup(name: string, memberIds: string[]): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/approver-groups",
    cookies: as(ADMIN),
    payload: { name, memberIds },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approverGroup.id as string;
}

/** Replaces a template's members — the edit the snapshot must survive. */
const setMembers = (groupId: string, memberIds: string[]) =>
  harness.app.inject({
    method: "PUT",
    url: `/api/v1/approver-groups/${groupId}/members`,
    cookies: as(ADMIN),
    payload: { memberIds },
  });

const archiveGroup = (groupId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/approver-groups/${groupId}/archive`,
    cookies: as(ADMIN),
  });

const applyGroup = (jar: Record<string, string>, number: number, groupId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/approvals/group`,
    cookies: jar,
    payload: { groupId },
  });

const requestApprovals = (jar: Record<string, string>, number: number, approverIds: string[]) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/approvals`,
    cookies: jar,
    payload: { approverIds },
  });

/** The roster, requiring success. */
async function roster(number: number): Promise<ApprovalRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/approvals`,
    cookies: as(MEMBER),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().approvals as ApprovalRow[];
}

/** Applies a group, requiring success, and answers the roster. */
async function apply(number: number, groupId: string): Promise<ApprovalRow[]> {
  const res = await applyGroup(as(MEMBER), number, groupId);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approvals as ApprovalRow[];
}

/** The groups the record's apply picker is offered, for one viewer. */
async function pickerGroups(fixture: { email: string }): Promise<GroupOption[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().approverGroups as GroupOption[];
}

/** Every request entry on one contract, oldest first. */
const requestEntriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, contractId), eq(activityLog.action, "approval.requested")))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** Walls a record off straight in the column: a fixture that makes a
 * record confidential is not the subject of an apply test. */
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

describe("applying an approver group", () => {
  it("asks every current member at once, stamped with the group it came from", async () => {
    const contract = await newContract("Commercial sign-off applied");
    const group = await newGroup("Commercial sign-off", [idOf(FIRST), idOf(SECOND)]);

    const rows = await apply(contract.number, group);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.approver.displayName).sort()).toEqual(
      [FIRST.displayName, SECOND.displayName].sort(),
    );
    for (const row of rows) {
      expect(row.status).toBe("pending");
      expect(row.source).toBe("group");
      expect(row.groupName).toBe("Commercial sign-off");
      expect(row.decidedAt).toBeNull();
      expect(row.requestedBy.id).toBe(idOf(MEMBER));
    }
  });

  it("leaves the requests it made alone when the group is edited, renamed, or archived", async () => {
    const contract = await newContract("The snapshot rule");
    const group = await newGroup("Snapshot template", [idOf(FIRST), idOf(SECOND)]);
    const applied = await apply(contract.number, group);
    const askedIds = applied.map((row) => row.id).sort();

    // A whole new membership, a new name, and then archived: the three
    // things that could reach back into an existing request.
    expect((await setMembers(group, [idOf(LATE)])).statusCode).toBe(200);
    const renamed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/approver-groups/${group}`,
      cookies: as(ADMIN),
      payload: { name: "Renamed template" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await archiveGroup(group)).statusCode).toBe(200);

    const after = await roster(contract.number);
    expect(after.map((row) => row.id).sort()).toEqual(askedIds);
    expect(after.map((row) => row.approver.displayName).sort()).toEqual(
      [FIRST.displayName, SECOND.displayName].sort(),
    );
    // The member who joined afterwards was never asked.
    expect(after.some((row) => row.approver.id === idOf(LATE))).toBe(false);
    for (const row of after) {
      expect(row.source).toBe("group");
      expect(row.status).toBe("pending");
    }
  });

  it("skips a member who already has a pending request, without an error", async () => {
    const contract = await newContract("Skip the already asked");
    expect((await requestApprovals(as(MEMBER), contract.number, [idOf(FIRST)])).statusCode).toBe(
      201,
    );
    const group = await newGroup("Overlapping template", [idOf(FIRST), idOf(SECOND)]);

    const rows = await apply(contract.number, group);

    expect(rows).toHaveLength(2);
    const first = rows.find((row) => row.approver.id === idOf(FIRST))!;
    const second = rows.find((row) => row.approver.id === idOf(SECOND))!;
    // The manual ask is untouched — it was skipped, not replaced.
    expect(first.source).toBe("manual");
    expect(second.source).toBe("group");
  });

  it("asks a member again once their earlier request has been decided", async () => {
    const contract = await newContract("Decided rows do not skip");
    const [asked] = await apply(contract.number, await newGroup("Re-ask template", [idOf(FIRST)]));
    const decided = await harness.app.inject({
      method: "POST",
      url: `/api/v1/approvals/${asked!.id}/decision`,
      cookies: as(FIRST),
      payload: { decision: "rejected" },
    });
    expect(decided.statusCode, decided.body).toBe(200);

    const rows = await apply(contract.number, await newGroup("Re-ask template 2", [idOf(FIRST)]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: asked!.id, status: "rejected" });
    expect(rows[1]).toMatchObject({ status: "pending", source: "group" });
  });

  it("skips an archived member rather than refusing the whole apply", async () => {
    const contract = await newContract("An archived member");
    const group = await newGroup("Template with a leaver", [idOf(FIRST), idOf(DEPARTED)]);
    await harness.db
      .update(users)
      .set({ archivedAt: new Date() })
      .where(eq(users.id, idOf(DEPARTED)));

    try {
      const rows = await apply(contract.number, group);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.approver.id).toBe(idOf(FIRST));
    } finally {
      // Put them back, so the fixture is not left half-gone for the
      // tests that follow — including when an assertion above throws,
      // which would otherwise turn one real failure into a cascade.
      await harness.db
        .update(users)
        .set({ archivedAt: null })
        .where(eq(users.id, idOf(DEPARTED)));
    }
  });
});

describe("what an apply refuses", () => {
  it("refuses a group with no members, as the no-op it would be", async () => {
    const contract = await newContract("Empty template");
    const group = await newGroup("Nobody in here", []);

    const res = await applyGroup(as(MEMBER), contract.number, group);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain("Nobody in here");
    expect(await roster(contract.number)).toEqual([]);
  });

  it("refuses a group whose members have all been asked already", async () => {
    const contract = await newContract("Fully skipped");
    const group = await newGroup("Already asked template", [idOf(FIRST), idOf(SECOND)]);
    await apply(contract.number, group);

    const again = await applyGroup(as(MEMBER), contract.number, group);
    expect(again.statusCode, again.body).toBe(422);
    expect(again.json().detail).toContain("Already asked template");
    // Nothing was added by the refused call.
    expect(await roster(contract.number)).toHaveLength(2);
  });

  it("refuses an archived group, which has left the picker", async () => {
    const contract = await newContract("Archived template");
    const group = await newGroup("Retired template", [idOf(FIRST)]);
    expect((await archiveGroup(group)).statusCode).toBe(200);

    const res = await applyGroup(as(MEMBER), contract.number, group);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("Retired template");
    expect(await roster(contract.number)).toEqual([]);
  });

  it("refuses a group id that names nothing", async () => {
    const contract = await newContract("No such template");
    const res = await applyGroup(as(MEMBER), contract.number, "not-a-group");
    expect(res.statusCode, res.body).toBe(404);
  });

  it("refuses a member who is no longer Member+, by name", async () => {
    const contract = await newContract("A demoted member");
    const group = await newGroup("Template with a demotion", [idOf(FIRST), idOf(DEMOTED)]);
    await harness.db
      .update(users)
      .set({ role: "contributor" })
      .where(eq(users.id, idOf(DEMOTED)));

    try {
      const res = await applyGroup(as(MEMBER), contract.number, group);
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().detail).toContain(DEMOTED.displayName);
      // The eligible half of the template must not land while the other
      // half is refused.
      expect(await roster(contract.number)).toEqual([]);
    } finally {
      await harness.db
        .update(users)
        .set({ role: "legal_team_member" })
        .where(eq(users.id, idOf(DEMOTED)));
    }
  });

  it("refuses a member who cannot see a confidential contract, by name", async () => {
    const contract = await newContract("Walled record, applied group");
    await wallOff(contract.id);
    const group = await newGroup("Outside the wall", [idOf(FIRST)]);

    const refused = await applyGroup(as(MEMBER), contract.number, group);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().detail).toContain(FIRST.displayName);

    // Put them inside the audience and the same apply lands.
    expect((await addToTeam(contract.number, idOf(FIRST))).statusCode).toBe(201);
    const allowed = await applyGroup(as(MEMBER), contract.number, group);
    expect(allowed.statusCode, allowed.body).toBe(201);
  });

  it("answers an outsider the missing-record 404, exactly as the named ask does", async () => {
    const contract = await newContract("Hidden from an outsider");
    await wallOff(contract.id);
    const group = await newGroup("Unreachable apply", [idOf(FIRST)]);

    const res = await applyGroup(as(OUTSIDER), contract.number, group);
    expect(res.statusCode, res.body).toBe(404);
    expect((await applyGroup(as(OUTSIDER), 999_999, group)).statusCode).toBe(404);
  });

  it("refuses a Contributor, who reads the roster and writes nothing on it", async () => {
    const contract = await newContract("Read-only viewer");
    expect((await addToTeam(contract.number, idOf(CONTRIBUTOR), "contributor")).statusCode).toBe(
      201,
    );
    const group = await newGroup("Contributor apply", [idOf(FIRST)]);

    const res = await applyGroup(as(CONTRIBUTOR), contract.number, group);
    expect(res.statusCode, res.body).toBe(403);
  });

  it("takes no apply on an archived contract", async () => {
    const contract = await newContract("Frozen record, applied group");
    const group = await newGroup("Frozen apply", [idOf(FIRST)]);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: as(MEMBER),
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await applyGroup(as(MEMBER), contract.number, group);
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("the apply picker's own list", () => {
  it("offers a Member+ user the live groups and their members, and leaves archived ones out", async () => {
    const live = await newGroup("Picker live template", [idOf(FIRST), idOf(SECOND)]);
    const retired = await newGroup("Picker retired template", [idOf(FIRST)]);
    expect((await archiveGroup(retired)).statusCode).toBe(200);

    const offered = await pickerGroups(MEMBER);
    const found = offered.find((group) => group.id === live);
    expect(found, "the live template").toBeDefined();
    expect(found!.name).toBe("Picker live template");
    // Display-name order — Marcus before Sarah — because that is the
    // order the apply asks in, and the dialog's preview reads this
    // list straight into its sentence.
    expect(found!.memberIds).toEqual([idOf(SECOND), idOf(FIRST)]);
    expect(offered.some((group) => group.id === retired)).toBe(false);
  });

  it("offers a group with no members at all, so the apply can say why", async () => {
    const empty = await newGroup("Picker empty template", []);
    const offered = await pickerGroups(ADMIN);
    const found = offered.find((group) => group.id === empty);
    expect(found, "the empty template").toBeDefined();
    expect(found!.memberIds).toEqual([]);
  });

  it("refuses the picker read to a Contributor, as the rest of the options answer is", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/options",
      cookies: as(CONTRIBUTOR),
    });
    expect(res.statusCode, res.body).toBe(403);
  });
});

describe("the activity an apply keeps", () => {
  it("narrates one working-team entry per person asked, naming the group", async () => {
    const contract = await newContract("Narrated apply");
    const group = await newGroup("Narrated template", [idOf(FIRST), idOf(SECOND)]);
    await apply(contract.number, group);

    const entries = await requestEntriesOn(contract.id);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.visibility).toBe("working_team");
      expect(entry.actorId).toBe(idOf(MEMBER));
      expect(entry.entityType).toBe("contract");
      expect(entry.payload).toMatchObject({ source: "group", groupId: group });
      expect((entry.payload as { groupName: string }).groupName).toBe("Narrated template");
    }
    expect(
      entries.map((entry) => (entry.payload as { approverName: string }).approverName).sort(),
    ).toEqual([FIRST.displayName, SECOND.displayName].sort());
  });

  it("writes nothing at all when the apply is refused", async () => {
    const contract = await newContract("Refused apply writes nothing");
    const group = await newGroup("Refused template", []);

    expect((await applyGroup(as(MEMBER), contract.number, group)).statusCode).toBe(422);
    expect(await requestEntriesOn(contract.id)).toEqual([]);
  });
});
