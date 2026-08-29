// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-001 officer roles: the fifth taxonomy mount plus its Member+ picker. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  asc,
  entities,
  entityOfficers,
  entityTypes,
  eq,
  inArray,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "officer-role-member@example.com",
  displayName: "Officer Role Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;

interface RoleRow {
  id: string;
  slug: string;
  displayName: string;
  displayOrder: number;
  archivedAt: string | null;
  inUseCount: number;
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
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
});

afterAll(async () => harness.stop());

async function listRoles(cookies = adminCookies, includeArchived = true): Promise<RoleRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/officer-roles${includeArchived ? "?includeArchived=true" : ""}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().officerRoles;
}

async function roleBySlug(slug: string): Promise<RoleRow> {
  const role = (await listRoles()).find((row) => row.slug === slug);
  expect(role, slug).toBeDefined();
  return role!;
}

describe("the officer-role mount", () => {
  it("seeds the ENT-001 roles in display order", async () => {
    expect((await listRoles(adminCookies, false)).map((row) => row.slug)).toEqual([
      "director",
      "ceo",
      "cfo",
      "secretary",
      "other",
    ]);
  });

  it("keeps Organization configuration Administrator-only", async () => {
    const member = await harness.app.inject({
      method: "GET",
      url: "/api/v1/officer-roles",
      cookies: memberCookies,
    });
    expect(member.statusCode).toBe(403);
    const anonymous = await harness.app.inject({ method: "GET", url: "/api/v1/officer-roles" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("supports add, rename, reorder, archive, restore, and hard delete through the shared routes", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/officer-roles",
      cookies: adminCookies,
      payload: { displayName: "Treasurer" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().officerRole.id as string;
    expect(created.json().officerRole.slug).toBe("treasurer");

    const renamed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/officer-roles/${id}`,
      cookies: adminCookies,
      payload: { displayName: "Group Treasurer" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().officerRole).toMatchObject({
      slug: "treasurer",
      displayName: "Group Treasurer",
    });

    const live = await listRoles(adminCookies, false);
    const reorderedIds = [id, ...live.filter((row) => row.id !== id).map((row) => row.id)];
    const reordered = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/officer-roles/order",
      cookies: adminCookies,
      payload: { ids: reorderedIds },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(reordered.json().officerRoles[0].id).toBe(id);

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/officer-roles/${id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().officerRole.archivedAt).not.toBeNull();

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/officer-roles/${id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().officerRole.archivedAt).toBeNull();

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/officer-roles/${id}`,
      cookies: adminCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
  });

  it("protects other from archive and hard delete", async () => {
    const other = await roleBySlug("other");
    for (const attempt of [
      harness.app.inject({
        method: "POST",
        url: `/api/v1/officer-roles/${other.id}/archive`,
        cookies: adminCookies,
        payload: {},
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/officer-roles/${other.id}`,
        cookies: adminCookies,
      }),
    ]) {
      const res = await attempt;
      expect(res.statusCode, res.body).toBe(409);
    }
  });
});

describe("the SET-003 officer usage guard", () => {
  it("counts and reassigns current and resigned officers as the same set", async () => {
    const director = await roleBySlug("director");
    const secretary = await roleBySlug("secretary");
    const [otherType] = await harness.db
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(eq(entityTypes.slug, "other"));
    const [entity] = await harness.db
      .insert(entities)
      .values({ legalName: "Officer Guard Entity", entityTypeId: otherType!.id })
      .returning({ id: entities.id });
    await harness.db.insert(entityOfficers).values([
      {
        entityId: entity!.id,
        name: "Current Director",
        officerRoleId: director.id,
        appointedOn: "2020-01-01",
      },
      {
        entityId: entity!.id,
        name: "Former Director",
        officerRoleId: director.id,
        appointedOn: "2018-01-01",
        resignedOn: "2021-01-01",
      },
    ]);

    expect((await roleBySlug("director")).inUseCount).toBe(2);

    const noTarget = await harness.app.inject({
      method: "POST",
      url: `/api/v1/officer-roles/${director.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(noTarget.statusCode, noTarget.body).toBe(409);
    expect(noTarget.json().detail).toContain("2 officers");

    const hardDelete = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/officer-roles/${director.id}`,
      cookies: adminCookies,
    });
    expect(hardDelete.statusCode, hardDelete.body).toBe(409);
    expect(hardDelete.json().detail).toContain("2 officers");

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/officer-roles/${director.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: secretary.id },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().officerRole.inUseCount).toBe(0);

    const moved = await harness.db
      .select({ name: entityOfficers.name, resignedOn: entityOfficers.resignedOn })
      .from(entityOfficers)
      .where(eq(entityOfficers.officerRoleId, secretary.id))
      .orderBy(asc(entityOfficers.name));
    expect(moved).toEqual([
      { name: "Current Director", resignedOn: null },
      { name: "Former Director", resignedOn: "2021-01-01" },
    ]);
  });
});

describe("the Member+ officer-role picker", () => {
  it("answers live roles while the settings read still refuses a Legal Team Member", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/officer-roles",
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().officerRoles.map((row: { slug: string }) => row.slug)).not.toContain(
      "director",
    );
    expect(res.json().officerRoles.map((row: { slug: string }) => row.slug)).toContain("secretary");
  });
});

describe("the DD-017 audit trail", () => {
  it("records officer-role mutations under the officer_role namespace", async () => {
    const rows = await harness.db
      .select({ action: activityLog.action, visibility: activityLog.visibility })
      .from(activityLog)
      .where(
        inArray(activityLog.action, [
          "officer_role.created",
          "officer_role.renamed",
          "officer_role.reordered",
          "officer_role.archived",
          "officer_role.restored",
          "officer_role.deleted",
        ]),
      );
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set([
        "officer_role.created",
        "officer_role.renamed",
        "officer_role.reordered",
        "officer_role.archived",
        "officer_role.restored",
        "officer_role.deleted",
      ]),
    );
    expect(rows.every((row) => row.visibility === "admin_only")).toBe(true);
  });
});
