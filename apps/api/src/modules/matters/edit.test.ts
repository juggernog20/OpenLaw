// SPDX-License-Identifier: AGPL-3.0-only

/** M22/5: matter edits, lifecycle timestamps, team reach, and recovery. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, eq, matters, matterTeam, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "matter-edit-member@example.com",
  displayName: "Mara Member",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-edit-outsider@example.com",
  displayName: "Omar Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-edit-contributor@example.com",
  displayName: "Cora Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let adminId: string;
let memberId: string;
let outsiderId: string;
let contributorId: string;
let plainTypeId: string;
let requiredTypeId: string;
let requiredSlug: string;
let secondOpenId: string;
let secondClosedId: string;
let seedClosedId: string;

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
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture.email === MEMBER.email) memberId = person.id;
    if (fixture.email === OUTSIDER.email) outsiderId = person.id;
    if (fixture.email === CONTRIBUTOR.email) contributorId = person.id;
  }
  [adminCookies, outsiderCookies, contributorCookies] = await Promise.all([
    signInCookies(harness.app, ADMIN.email, ADMIN.password),
    signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password),
    signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password),
  ]);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  adminId = admin!.id;
  plainTypeId = await newType("Matter edit plain");
  requiredTypeId = await newType("Matter edit required");
  requiredSlug = await attachRequiredText(requiredTypeId, "Legal owner");
  secondOpenId = await newStatus("Investigating", "open");
  secondClosedId = await newStatus("Resolved", "closed");
  const statuses = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: adminCookies,
  });
  seedClosedId = statuses
    .json()
    .matterStatuses.find((row: { slug: string }) => row.slug === "closed").id;
});

afterAll(async () => harness.stop());

async function newType(displayName: string): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterType.id;
}

async function newStatus(displayName: string, category: "open" | "closed"): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-statuses",
    cookies: adminCookies,
    payload: { displayName, category },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterStatus.id;
}

async function attachRequiredText(typeId: string, displayName: string): Promise<string> {
  const fieldResponse = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { moduleScope: "matter", fieldTag: "legal", displayName, fieldType: "text" },
  });
  expect(fieldResponse.statusCode, fieldResponse.body).toBe(201);
  const field = fieldResponse.json().field as { id: string; slug: string };
  const attached = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matter-types/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId: field.id, isRequired: true },
  });
  expect(attached.statusCode, attached.body).toBe(201);
  return field.slug;
}

async function create(payload: Record<string, unknown> = {}) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: adminCookies,
    payload: { title: "Editable matter", matterTypeId: plainTypeId, ...payload },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matter as { id: string; number: number; openedAt: string };
}

const patchMatter = (number: number, payload: Record<string, unknown>, cookies = adminCookies) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/matters/${number}`,
    cookies,
    payload,
  });

describe("per-field matter PATCH", () => {
  it("commits scalar fields, returns the projection, and refuses every Contributor write", async () => {
    const matter = await create();
    for (const payload of [
      { title: "Renamed matter" },
      { description: "A useful description" },
      { managerId: memberId },
      { priority: "critical" },
      { risk: "high" },
    ]) {
      const response = await patchMatter(matter.number, payload);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ fields: [], team: expect.any(Array) });
    }
    const [stored] = await harness.db.select().from(matters).where(eq(matters.id, matter.id));
    expect(stored).toMatchObject({
      title: "Renamed matter",
      description: "A useful description",
      managerId: memberId,
      priority: "critical",
      risk: "high",
    });
    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter.id, userId: contributorId, role: "contributor" });
    const refused = await patchMatter(matter.number, { title: "No" }, contributorCookies);
    expect(refused.statusCode, refused.body).toBe(403);
  });

  it("names a required field when it is cleared or introduced by a re-type", async () => {
    const required = await create({
      title: "Required matter",
      matterTypeId: requiredTypeId,
      customFields: { [requiredSlug]: "Corporate" },
    });
    const cleared = await patchMatter(required.number, { customFields: { [requiredSlug]: null } });
    expect(cleared.statusCode, cleared.body).toBe(400);
    expect(cleared.json().detail).toContain("Legal owner");

    const matter = await create();
    const gap = await patchMatter(matter.number, { matterTypeId: requiredTypeId });
    expect(gap.statusCode, gap.body).toBe(400);
    expect(gap.json().detail).toContain("Legal owner");
    const filled = await patchMatter(matter.number, {
      matterTypeId: requiredTypeId,
      customFields: { [requiredSlug]: "Disputes" },
    });
    expect(filled.statusCode, filled.body).toBe(200);
    expect(filled.json().matter).toMatchObject({
      matterTypeId: requiredTypeId,
      customFields: { [requiredSlug]: "Disputes" },
    });
    expect(filled.json().fields.map((field: { slug: string }) => field.slug)).toContain(
      requiredSlug,
    );
  });

  it("sets and clears closed_at by category without ever moving opened_at", async () => {
    const matter = await create();
    const openedAt = matter.openedAt;
    const openToOpen = await patchMatter(matter.number, { statusId: secondOpenId });
    expect(openToOpen.statusCode, openToOpen.body).toBe(200);
    expect(openToOpen.json().matter).toMatchObject({ openedAt, closedAt: null });

    const closed = await patchMatter(matter.number, { statusId: secondClosedId });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().matter.openedAt).toBe(openedAt);
    expect(closed.json().matter.closedAt).toEqual(expect.any(String));
    const closedAt = closed.json().matter.closedAt;

    const stillClosed = await patchMatter(matter.number, { statusId: seedClosedId });
    expect(stillClosed.statusCode, stillClosed.body).toBe(200);
    expect(stillClosed.json().matter.closedAt).toBe(closedAt);
    const writable = await patchMatter(matter.number, { title: "Closed but editable" });
    expect(writable.statusCode, writable.body).toBe(200);

    const reopened = await patchMatter(matter.number, { statusId: secondOpenId });
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().matter).toMatchObject({ openedAt, closedAt: null });
  });
});

describe("matter team, confidentiality, and recovery", () => {
  it("holds the compound team key, protects creator, and changes confidential reach", async () => {
    const matter = await create();
    const add = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/team`,
      cookies: adminCookies,
      payload: { userId: outsiderId, role: "watcher" },
    });
    expect(add.statusCode, add.body).toBe(201);
    expect(add.json().team).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: outsiderId, role: "watcher" })]),
    );
    const duplicate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/team`,
      cookies: adminCookies,
      payload: { userId: outsiderId, role: "watcher" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect((await patchMatter(matter.number, { isConfidential: true })).statusCode).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: outsiderCookies,
        })
      ).statusCode,
    ).toBe(200);
    const remove = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${matter.number}/team/${outsiderId}/watcher`,
      cookies: adminCookies,
    });
    expect(remove.statusCode, remove.body).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: outsiderCookies,
        })
      ).statusCode,
    ).toBe(404);
    const creatorRemoval = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${matter.number}/team/${adminId}/creator`,
      cookies: adminCookies,
    });
    expect(creatorRemoval.statusCode, creatorRemoval.body).toBe(409);
  });

  it("archives out of the default list, restores, and narrates every mutation class", async () => {
    const matter = await create();
    await patchMatter(matter.number, { title: "Narrated matter" });
    await patchMatter(matter.number, {
      matterTypeId: requiredTypeId,
      customFields: { [requiredSlug]: "Ops" },
    });
    await patchMatter(matter.number, { statusId: secondClosedId });
    await patchMatter(matter.number, { isConfidential: true });
    await patchMatter(matter.number, { isConfidential: false });
    const add = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/team`,
      cookies: adminCookies,
      payload: { userId: memberId, role: "member" },
    });
    expect(add.statusCode, add.body).toBe(201);
    const remove = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${matter.number}/team/${memberId}/member`,
      cookies: adminCookies,
    });
    expect(remove.statusCode, remove.body).toBe(200);

    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);
    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters?includeClosed=true",
      cookies: adminCookies,
    });
    expect(listed.json().matters.some((row: { id: string }) => row.id === matter.id)).toBe(false);
    const restore = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/restore`,
      cookies: adminCookies,
    });
    expect(restore.statusCode, restore.body).toBe(200);
    const returned = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters?includeClosed=true",
      cookies: adminCookies,
    });
    expect(returned.json().matters.some((row: { id: string }) => row.id === matter.id)).toBe(true);

    const rows = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.entityId, matter.id));
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "matter.created",
        "matter.updated",
        "matter.type_reassigned",
        "matter.status_changed",
        "matter.confidentiality_set",
        "matter.confidentiality_cleared",
        "matter.team_added",
        "matter.team_removed",
        "matter.archived",
        "matter.restored",
      ]),
    );
  });
});
