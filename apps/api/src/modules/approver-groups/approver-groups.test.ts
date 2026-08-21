// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Approver groups (#231): the CTR-012 reusable sign-off
 * templates behind the fourth list-editor pane — create with a member
 * list, rename, describe, replace the members, archive, restore. Only
 * Member+ users are accepted as members, and only an Administrator
 * touches the pane at all (SET-002). Archiving carries no guard and no
 * reassignment: applying a group snapshots its members, so an archived
 * group only leaves the apply picker.
 *
 * Asserted at the HTTP seam plus direct activity_log reads — the log has
 * no read routes for these entries outside the M9 audit-log pane.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Casey Member",
  password: "correct-horse-battery",
} as const;

const SECOND_MEMBER = {
  email: "second@example.com",
  displayName: "Alex Second",
  password: "correct-horse-battery",
} as const;

const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Robin Contributor",
  password: "correct-horse-battery",
} as const;

const ARCHIVED_MEMBER = {
  email: "gone@example.com",
  displayName: "Sam Gone",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let adminId: string;
let memberId: string;
let secondMemberId: string;
let contributorId: string;
let archivedMemberId: string;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);
  const [admin] = await harness.db.select().from(users).where(eq(users.email, ADMIN.email));
  adminId = admin!.id;

  const provision = async (person: { email: string; displayName: string; password: string }) =>
    provisionUser(harness.app.auth, person);

  const member = await provision(MEMBER);
  memberId = member.id;
  const second = await provision(SECOND_MEMBER);
  secondMemberId = second.id;
  const contributor = await provision(CONTRIBUTOR);
  contributorId = contributor.id;
  const archived = await provision(ARCHIVED_MEMBER);
  archivedMemberId = archived.id;

  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(inArray(users.id, [memberId, secondMemberId, archivedMemberId]));
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributorId));
  await harness.db
    .update(users)
    .set({ archivedAt: new Date() })
    .where(eq(users.id, archivedMemberId));

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
});

afterAll(async () => {
  await harness.stop();
});

interface GroupMember {
  id: string;
  displayName: string;
  email: string;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  members: GroupMember[];
  memberCount: number;
}

const listGroups = async (includeArchived = false): Promise<GroupRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/approver-groups${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().approverGroups;
};

async function createGroup(payload: Record<string, unknown>): Promise<GroupRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/approver-groups",
    cookies: adminCookies,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approverGroup;
}

const GROUP_ACTIONS = [
  "approver_group.created",
  "approver_group.renamed",
  "approver_group.updated",
  "approver_group.archived",
  "approver_group.restored",
  "approver_group.member_added",
  "approver_group.member_removed",
] as const;

const auditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(inArray(activityLog.action, [...GROUP_ACTIONS]))
    // Tiebreak on the id: Postgres evaluates now() once per
    // transaction, so entries written inside one mutation share a
    // created_at and their relative order would fall to the heap. The
    // key is UUIDv7, so it is time-ordered and pins insertion order.
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** The entries appended while `body` ran, in order. */
async function entriesDuring<T>(body: () => Promise<T>): Promise<{
  result: T;
  entries: Awaited<ReturnType<typeof auditRows>>;
}> {
  const before = (await auditRows()).length;
  const result = await body();
  const entries = (await auditRows()).slice(before);
  return { result, entries };
}

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/approver-groups" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const group = await createGroup({ name: "Gate probe" });
    const attempts = [
      harness.app.inject({
        method: "GET",
        url: "/api/v1/approver-groups",
        cookies: memberCookies,
      }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/approver-groups",
        cookies: memberCookies,
        payload: { name: "Sneaky" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/approver-groups/${group.id}`,
        cookies: memberCookies,
        payload: { name: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/approver-groups/${group.id}/members`,
        cookies: memberCookies,
        payload: { memberIds: [memberId] },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/approver-groups/${group.id}/archive`,
        cookies: memberCookies,
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/approver-groups/${group.id}/restore`,
        cookies: memberCookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    const rows = await listGroups(true);
    expect(rows.find((row) => row.id === group.id)).toEqual(group);
    expect(rows.some((row) => row.name === "Sneaky")).toBe(false);
  });
});

describe("POST /approver-groups", () => {
  it("creates a group with a name, a description, and its starting members", async () => {
    const { result: created, entries } = await entriesDuring(() =>
      createGroup({
        name: "Commercial sign-off",
        description: "GC plus CFO on every commercial paper.",
        memberIds: [adminId, memberId],
      }),
    );
    expect(created.name).toBe("Commercial sign-off");
    expect(created.description).toBe("GC plus CFO on every commercial paper.");
    expect(created.archivedAt).toBeNull();
    expect(created.memberCount).toBe(2);
    // Members come back in display-name order: Blair, then Casey.
    expect(created.members.map((member) => member.displayName)).toEqual([
      ADMIN.displayName,
      MEMBER.displayName,
    ]);
    expect(created.members.map((member) => member.email)).toEqual([ADMIN.email, MEMBER.email]);

    // One entry for the whole act, naming who it started with.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("approver_group.created");
    expect(entries[0]!.visibility).toBe("admin_only");
    expect(entries[0]!.entityType).toBe("system");
    expect(entries[0]!.actorId).toBe(adminId);
    expect(entries[0]!.payload).toMatchObject({
      displayName: "Commercial sign-off",
      memberCount: 2,
      memberNames: [ADMIN.displayName, MEMBER.displayName],
    });
  });

  it("creates an empty group when no members are named", async () => {
    const created = await createGroup({ name: "Empty for now" });
    expect(created.description).toBeNull();
    expect(created.members).toEqual([]);
    expect(created.memberCount).toBe(0);
  });

  it("collapses a repeated member id instead of failing on the compound key", async () => {
    const created = await createGroup({ name: "Deduped", memberIds: [memberId, memberId] });
    expect(created.memberCount).toBe(1);
  });

  it("rejects a blank name", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/approver-groups",
      cookies: adminCookies,
      payload: { name: "   " },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses a Contributor as a member and writes nothing", async () => {
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "POST",
        url: "/api/v1/approver-groups",
        cookies: adminCookies,
        payload: { name: "Wrong roles", memberIds: [memberId, contributorId] },
      }),
    );
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain(CONTRIBUTOR.displayName);
    expect(entries).toHaveLength(0);
    expect((await listGroups(true)).some((row) => row.name === "Wrong roles")).toBe(false);
  });

  it("refuses an archived person as a member", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/approver-groups",
      cookies: adminCookies,
      payload: { name: "Ghost group", memberIds: [archivedMemberId] },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain(ARCHIVED_MEMBER.displayName);
  });

  it("refuses an id that names nobody", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/approver-groups",
      cookies: adminCookies,
      payload: { name: "Phantom", memberIds: ["not-a-user"] },
    });
    expect(res.statusCode, res.body).toBe(422);
  });
});

describe("PATCH /approver-groups/:id", () => {
  it("renames a group and logs the rename", async () => {
    const group = await createGroup({ name: "Old name" });
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/approver-groups/${group.id}`,
        cookies: adminCookies,
        payload: { name: "New name" },
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().approverGroup.name).toBe("New name");
    expect(entries.map((entry) => entry.action)).toEqual(["approver_group.renamed"]);
    expect(entries[0]!.payload).toMatchObject({ from: "Old name", to: "New name" });
    expect(entries[0]!.visibility).toBe("admin_only");
  });

  it("changes the description on its own verb, and clears it with null", async () => {
    const group = await createGroup({ name: "Described", description: "First words." });
    const set = await entriesDuring(() =>
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/approver-groups/${group.id}`,
        cookies: adminCookies,
        payload: { description: "Second words." },
      }),
    );
    expect(set.result.statusCode, set.result.body).toBe(200);
    expect(set.result.json().approverGroup.description).toBe("Second words.");
    expect(set.entries.map((entry) => entry.action)).toEqual(["approver_group.updated"]);
    expect(set.entries[0]!.payload).toMatchObject({
      changed: { description: { from: "First words.", to: "Second words." } },
    });

    const cleared = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/approver-groups/${group.id}`,
      cookies: adminCookies,
      payload: { description: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().approverGroup.description).toBeNull();
  });

  it("writes two entries when the name and the description both change", async () => {
    const group = await createGroup({ name: "Both", description: "Before." });
    const { entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/approver-groups/${group.id}`,
        cookies: adminCookies,
        payload: { name: "Both changed", description: "After." },
      }),
    );
    expect(entries.map((entry) => entry.action)).toEqual([
      "approver_group.renamed",
      "approver_group.updated",
    ]);
  });

  it("writes no entry when nothing actually changes", async () => {
    const group = await createGroup({ name: "Unchanged", description: "Same." });
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/approver-groups/${group.id}`,
        cookies: adminCookies,
        payload: { name: "Unchanged", description: "Same." },
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(entries).toHaveLength(0);
  });

  it("refuses a body carrying memberIds — the member list has its own route", async () => {
    const group = await createGroup({ name: "Strict body" });
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/approver-groups/${group.id}`,
      cookies: adminCookies,
      payload: { name: "Strict body", memberIds: [memberId] },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses an empty body", async () => {
    const group = await createGroup({ name: "Nothing asked" });
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/approver-groups/${group.id}`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("404s on an id that names no group", async () => {
    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/approver-groups/not-a-group",
      cookies: adminCookies,
      payload: { name: "Nowhere" },
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("PUT /approver-groups/:id/members", () => {
  it("adds and removes members in one call, one entry each", async () => {
    const group = await createGroup({ name: "Editable", memberIds: [adminId, memberId] });
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/approver-groups/${group.id}/members`,
        cookies: adminCookies,
        payload: { memberIds: [memberId, secondMemberId] },
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const updated: GroupRow = res.json().approverGroup;
    expect(updated.members.map((member) => member.id).sort()).toEqual(
      [memberId, secondMemberId].sort(),
    );
    expect(updated.memberCount).toBe(2);

    expect(entries.map((entry) => entry.action)).toEqual([
      "approver_group.member_added",
      "approver_group.member_removed",
    ]);
    expect(entries[0]!.payload).toMatchObject({
      displayName: "Editable",
      memberId: secondMemberId,
      memberName: SECOND_MEMBER.displayName,
    });
    expect(entries[1]!.payload).toMatchObject({
      displayName: "Editable",
      memberId: adminId,
      memberName: ADMIN.displayName,
    });
    for (const entry of entries) expect(entry.visibility).toBe("admin_only");
  });

  it("empties a group and logs every departure", async () => {
    const group = await createGroup({ name: "Emptied", memberIds: [memberId, secondMemberId] });
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/approver-groups/${group.id}/members`,
        cookies: adminCookies,
        payload: { memberIds: [] },
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().approverGroup.memberCount).toBe(0);
    expect(entries.map((entry) => entry.action)).toEqual([
      "approver_group.member_removed",
      "approver_group.member_removed",
    ]);
  });

  it("writes nothing when the list is unchanged", async () => {
    const group = await createGroup({ name: "Same members", memberIds: [memberId] });
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/approver-groups/${group.id}/members`,
        cookies: adminCookies,
        payload: { memberIds: [memberId] },
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(entries).toHaveLength(0);
  });

  it("refuses a Contributor and leaves the existing list alone", async () => {
    const group = await createGroup({ name: "Guarded", memberIds: [memberId] });
    const { result: res, entries } = await entriesDuring(() =>
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/approver-groups/${group.id}/members`,
        cookies: adminCookies,
        payload: { memberIds: [memberId, contributorId] },
      }),
    );
    expect(res.statusCode, res.body).toBe(422);
    expect(entries).toHaveLength(0);
    const rows = await listGroups(true);
    expect(rows.find((row) => row.id === group.id)!.members.map((member) => member.id)).toEqual([
      memberId,
    ]);
  });

  it("refuses an archived person", async () => {
    const group = await createGroup({ name: "No ghosts" });
    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/approver-groups/${group.id}/members`,
      cookies: adminCookies,
      payload: { memberIds: [archivedMemberId] },
    });
    expect(res.statusCode, res.body).toBe(422);
  });

  it("404s on an id that names no group", async () => {
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/approver-groups/not-a-group/members",
      cookies: adminCookies,
      payload: { memberIds: [] },
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("archive and restore", () => {
  it("takes an archived group out of the default list and brings it back", async () => {
    const group = await createGroup({ name: "Retired set", memberIds: [memberId] });

    const archived = await entriesDuring(() =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/approver-groups/${group.id}/archive`,
        cookies: adminCookies,
      }),
    );
    expect(archived.result.statusCode, archived.result.body).toBe(200);
    expect(archived.result.json().approverGroup.archivedAt).not.toBeNull();
    // The members ride along: archiving hides the template, it never
    // dismantles it.
    expect(archived.result.json().approverGroup.memberCount).toBe(1);
    expect(archived.entries.map((entry) => entry.action)).toEqual(["approver_group.archived"]);
    expect(archived.entries[0]!.visibility).toBe("admin_only");

    expect((await listGroups()).some((row) => row.id === group.id)).toBe(false);
    expect((await listGroups(true)).some((row) => row.id === group.id)).toBe(true);

    const twice = await harness.app.inject({
      method: "POST",
      url: `/api/v1/approver-groups/${group.id}/archive`,
      cookies: adminCookies,
    });
    expect(twice.statusCode, twice.body).toBe(409);

    const restored = await entriesDuring(() =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/approver-groups/${group.id}/restore`,
        cookies: adminCookies,
      }),
    );
    expect(restored.result.statusCode, restored.result.body).toBe(200);
    expect(restored.result.json().approverGroup.archivedAt).toBeNull();
    expect(restored.result.json().approverGroup.memberCount).toBe(1);
    expect(restored.entries.map((entry) => entry.action)).toEqual(["approver_group.restored"]);

    expect((await listGroups()).some((row) => row.id === group.id)).toBe(true);
  });

  it("refuses to restore a group that is not archived", async () => {
    const group = await createGroup({ name: "Still live" });
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/approver-groups/${group.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("still edits an archived group's members", async () => {
    const group = await createGroup({ name: "Archived but editable" });
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/approver-groups/${group.id}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);
    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/approver-groups/${group.id}/members`,
      cookies: adminCookies,
      payload: { memberIds: [memberId] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().approverGroup.memberCount).toBe(1);
  });
});

describe("GET /approver-groups", () => {
  it("lists live groups in name order with their member counts", async () => {
    // Three names this suite owns, created out of order. Asserting their
    // relative order rather than the whole list keeps the check about
    // the route's ORDER BY, not about how every other test happened to
    // name its fixtures.
    await createGroup({ name: "Zulu review" });
    await createGroup({ name: "Alpha review" });
    await createGroup({ name: "Mike review" });

    const rows = await listGroups();
    expect(rows.map((row) => row.name).filter((name) => name.endsWith(" review"))).toEqual([
      "Alpha review",
      "Mike review",
      "Zulu review",
    ]);
    for (const row of rows) {
      expect(row.archivedAt).toBeNull();
      expect(row.memberCount).toBe(row.members.length);
    }
  });
});
