// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry (ENT-001/ENT-004, #98): the first Member+
 * surface — Administrators and Legal Team Members read and write,
 * Contributors, Business Users, and unauthenticated requests are
 * refused everywhere. Registration validates the identity card (legal
 * name and a live type required, the rest optional), the list orders
 * by legal name and hides archived rows unless asked, the type-picker
 * read answers Member+ where /entity-types itself refuses them, and
 * every mutation lands in the activity log in the same transaction
 * (DD-017). Asserted at the HTTP seam plus direct activity_log reads —
 * the log has no read routes until M9.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, inArray, users } from "@openlaw/db";
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
const BUSINESS = {
  email: "business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

interface EntityRow {
  id: string;
  legalName: string;
  entityTypeId: string;
  entityTypeName: string;
  jurisdiction: string | null;
  formedOn: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  registeredAgent: string | null;
  registeredAddress: string | null;
  status: string;
  archivedAt: string | null;
}

const listEntities = async (
  cookies: Record<string, string>,
  includeArchived = false,
): Promise<EntityRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/entities${includeArchived ? "?includeArchived=true" : ""}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().entities;
};

const typeOptionBySlug = async (slug: string) => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const option = res
    .json()
    .entityTypes.find((candidate: { slug: string }) => candidate.slug === slug);
  expect(option, slug).toBeDefined();
  return option as { id: string; slug: string; displayName: string };
};

const register = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
  harness.app.inject({ method: "POST", url: "/api/v1/entities", cookies, payload });

const entityAuditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(inArray(activityLog.action, ["entity.created", "entity.archived"]))
    .orderBy(asc(activityLog.createdAt));

describe("the ENT-004 access floor", () => {
  it("refuses an unauthenticated request as 401 on every route", async () => {
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/entities" }),
      harness.app.inject({ method: "GET", url: "/api/v1/entities/types" }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/entities",
        payload: { legalName: "Ghost Ltd", entityTypeId: "any" },
      }),
      harness.app.inject({ method: "POST", url: "/api/v1/entities/no-such-id/archive" }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(401);
    }
  });

  it("refuses a Contributor and a Business User as 403 problem+json, read and write", async () => {
    for (const fixture of [CONTRIBUTOR, BUSINESS]) {
      const cookies = await signInCookies(harness.app, fixture.email, fixture.password);
      const attempts = [
        harness.app.inject({ method: "GET", url: "/api/v1/entities", cookies }),
        harness.app.inject({ method: "GET", url: "/api/v1/entities/types", cookies }),
        harness.app.inject({
          method: "POST",
          url: "/api/v1/entities",
          cookies,
          payload: { legalName: "Sneaky Ltd", entityTypeId: "any" },
        }),
        harness.app.inject({ method: "POST", url: "/api/v1/entities/no-such-id/archive", cookies }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.statusCode, `${fixture.email}: ${res.body}`).toBe(403);
        expect(res.headers["content-type"]).toContain("application/problem+json");
      }
    }
    // None of the refused writes landed.
    expect(
      (await listEntities(adminCookies, true)).some((row) => row.legalName === "Sneaky Ltd"),
    ).toBe(false);
  });

  it("admits a Legal Team Member — the first Member+ write surface", async () => {
    const corporation = await typeOptionBySlug("corporation");
    const res = await register(memberCookies, {
      legalName: "Member Created Ltd",
      entityTypeId: corporation.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().entity.legalName).toBe("Member Created Ltd");
  });
});

describe("GET /entities/types — the Member+ picker source", () => {
  it("answers a Legal Team Member with the live types in display order", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/types",
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityTypes.map((row: { slug: string }) => row.slug)).toEqual([
      "corporation",
      "llc",
      "partnership",
      "branch",
      "other",
    ]);
    // The same member is still refused on the settings surface (SET-002):
    // this picker read exists precisely because that one is closed.
    const settings = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entity-types",
      cookies: memberCookies,
    });
    expect(settings.statusCode).toBe(403);
  });

  it("leaves out archived types", async () => {
    const branch = await typeOptionBySlug("branch");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${branch.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/types",
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityTypes.some((row: { slug: string }) => row.slug === "branch")).toBe(
      false,
    );
    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${branch.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
  });
});

describe("POST /entities — registration", () => {
  it("registers the full identity card and answers 201 with the joined type name", async () => {
    const llc = await typeOptionBySlug("llc");
    const res = await register(adminCookies, {
      legalName: "Aldgate Middle East FZE",
      entityTypeId: llc.id,
      jurisdiction: "United Arab Emirates",
      formedOn: "2019-03-12",
      registrationNumber: "DMCC-88412",
      taxId: "AE 104 233 900",
      registeredAgent: "Hadi Corporate Services",
      registeredAddress: "Unit 404, Jumeirah Lakes Towers, Dubai, UAE",
      status: "active",
    });
    expect(res.statusCode, res.body).toBe(201);
    const entity = res.json().entity;
    expect(entity).toMatchObject({
      legalName: "Aldgate Middle East FZE",
      entityTypeId: llc.id,
      entityTypeName: "LLC",
      jurisdiction: "United Arab Emirates",
      formedOn: "2019-03-12",
      registrationNumber: "DMCC-88412",
      taxId: "AE 104 233 900",
      registeredAgent: "Hadi Corporate Services",
      registeredAddress: "Unit 404, Jumeirah Lakes Towers, Dubai, UAE",
      status: "active",
      archivedAt: null,
    });
  });

  it("needs only legal name and type; the rest of the card is null and status defaults to active", async () => {
    const corporation = await typeOptionBySlug("corporation");
    const res = await register(adminCookies, {
      legalName: "Bare Minimum Ltd",
      entityTypeId: corporation.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().entity).toMatchObject({
      legalName: "Bare Minimum Ltd",
      jurisdiction: null,
      formedOn: null,
      registrationNumber: null,
      taxId: null,
      registeredAgent: null,
      registeredAddress: null,
      status: "active",
    });
  });

  it("rejects a blank legal name and a missing type as 400 problems", async () => {
    const corporation = await typeOptionBySlug("corporation");
    const blankName = await register(adminCookies, {
      legalName: "   ",
      entityTypeId: corporation.id,
    });
    expect(blankName.statusCode, blankName.body).toBe(400);
    expect(blankName.headers["content-type"]).toContain("application/problem+json");

    const noType = await register(adminCookies, { legalName: "No Type Ltd" });
    expect(noType.statusCode, noType.body).toBe(400);
  });

  it("rejects an unknown and an archived entity type as 400", async () => {
    const unknown = await register(adminCookies, {
      legalName: "Unknown Type Ltd",
      entityTypeId: "no-such-id",
    });
    expect(unknown.statusCode, unknown.body).toBe(400);

    const partnership = await typeOptionBySlug("partnership");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${partnership.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const toArchived = await register(adminCookies, {
      legalName: "Archived Type Ltd",
      entityTypeId: partnership.id,
    });
    expect(toArchived.statusCode, toArchived.body).toBe(400);
    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${partnership.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(
      (await listEntities(adminCookies, true)).some((row) => row.legalName === "Archived Type Ltd"),
    ).toBe(false);
  });

  it("rejects a status outside the fixed ENT-001 enum", async () => {
    const corporation = await typeOptionBySlug("corporation");
    const res = await register(adminCookies, {
      legalName: "Bad Status Ltd",
      entityTypeId: corporation.id,
      status: "liquidated",
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("GET /entities — the list and picker seam", () => {
  it("orders by legal name, case-insensitively", async () => {
    const corporation = await typeOptionBySlug("corporation");
    for (const legalName of ["zeta Holdings Ltd", "Acme Ltd"]) {
      const res = await register(adminCookies, { legalName, entityTypeId: corporation.id });
      expect(res.statusCode, res.body).toBe(201);
    }
    const names = (await listEntities(memberCookies)).map((row) => row.legalName);
    const sorted = [...names].sort((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
    );
    expect(names).toEqual(sorted);
    expect(names.indexOf("Acme Ltd")).toBeLessThan(names.indexOf("zeta Holdings Ltd"));
  });

  it("excludes archived entities by default and includes them on request", async () => {
    const corporation = await typeOptionBySlug("corporation");
    const created = await register(adminCookies, {
      legalName: "Soon Archived Ltd",
      entityTypeId: corporation.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().entity.id;

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${id}/archive`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().entity.archivedAt).not.toBeNull();

    const live = await listEntities(memberCookies);
    expect(live.some((row) => row.id === id)).toBe(false);
    const all = await listEntities(memberCookies, true);
    expect(all.some((row) => row.id === id)).toBe(true);
  });

  it("refuses to archive an already-archived entity as 409, and 404s an unknown id", async () => {
    // Self-contained: this test registers and archives its own row.
    const corporation = await typeOptionBySlug("corporation");
    const created = await register(adminCookies, {
      legalName: "Twice Archived Ltd",
      entityTypeId: corporation.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().entity.id;
    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${id}/archive`,
      cookies: adminCookies,
    });
    expect(first.statusCode, first.body).toBe(200);
    const again = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${id}/archive`,
      cookies: adminCookies,
    });
    expect(again.statusCode, again.body).toBe(409);
    const missing = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entities/no-such-id/archive",
      cookies: adminCookies,
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("the DD-017 activity trail", () => {
  it("writes entity.created and entity.archived rows keyed to the record, Legal Only", async () => {
    const rows = await entityAuditRows();
    const created = rows.filter((row) => row.action === "entity.created");
    const archived = rows.filter((row) => row.action === "entity.archived");
    expect(created.length).toBeGreaterThan(0);
    expect(archived.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.entityType).toBe("entity");
      expect(row.entityId).not.toBeNull();
      expect(row.actorId).not.toBeNull();
      expect(row.visibility).toBe("legal_only");
    }
    const fze = created.find(
      (row) => (row.payload as { legalName?: string }).legalName === "Aldgate Middle East FZE",
    );
    expect(fze?.payload).toMatchObject({
      legalName: "Aldgate Middle East FZE",
      entityType: "LLC",
      status: "active",
    });
  });

  it("keys every entity.created entry to a listable entity — the log and the record move together", async () => {
    const rows = await entityAuditRows();
    const listed = await listEntities(adminCookies, true);
    const ids = new Set(listed.map((row) => row.id));
    for (const row of rows.filter((entry) => entry.action === "entity.created")) {
      expect(ids.has(row.entityId!)).toBe(true);
    }
  });
});
