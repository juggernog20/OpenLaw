// SPDX-License-Identifier: AGPL-3.0-only

/** M27/4's Entity record writes at the HTTP seam. */
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
  email: "entity-record-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "entity-record-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "entity-record-business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let businessCookies: Record<string, string>;
let memberId: string;
let corporationId: string;
let directorRoleId: string;

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
    [BUSINESS, "business_user"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (role === "legal_team_member") memberId = person.id;
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  corporationId = types
    .json()
    .entityTypes.find((row: { slug: string }) => row.slug === "corporation").id;
  const roles = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/officer-roles",
    cookies: memberCookies,
  });
  directorRoleId = roles
    .json()
    .officerRoles.find((row: { slug: string }) => row.slug === "director").id;
});

afterAll(async () => harness.stop());

async function newEntity(legalName: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: { legalName, entityTypeId: corporationId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().entity as { id: string; legalName: string };
}

const readEntity = (id: string) =>
  harness.app.inject({ method: "GET", url: `/api/v1/entities/${id}`, cookies: memberCookies });

const patchEntity = (id: string, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/entities/${id}`,
    cookies: memberCookies,
    payload,
  });

async function defineAndAttachField(
  displayName: string,
  fieldType: string,
  options?: string[],
  isRequired = false,
) {
  const field = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: {
      displayName,
      moduleScope: "entity",
      fieldType,
      fieldTag: "legal",
      ...(options ? { options } : {}),
    },
  });
  expect(field.statusCode, field.body).toBe(201);
  const created = field.json().field as { id: string; slug: string };
  const attached = await harness.app.inject({
    method: "POST",
    url: `/api/v1/entity-types/${corporationId}/fields`,
    cookies: adminCookies,
    payload: { fieldId: created.id, isRequired },
  });
  expect(attached.statusCode, attached.body).toBe(201);
  return created;
}

const entityActivity = (id: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "entity.updated",
        "entity_officer.created",
        "entity_officer.updated",
        "entity_officer.deleted",
        "entity_registration.created",
        "entity_registration.updated",
        "entity_registration.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt))
    .then((rows) => rows.filter((row) => row.entityId === id));

describe("the Entity Overview read and PATCH", () => {
  it("commits the three share-capital fields per field and records each change", async () => {
    const entity = await newEntity("Capital Record Ltd");
    for (const [key, value] of [
      ["sharesAuthorized", 1_000_000],
      ["sharesIssued", 640_000],
      ["parValue", 100],
    ] as const) {
      const response = await patchEntity(entity.id, { [key]: value });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().entity[key]).toBe(value);
    }
    const read = await readEntity(entity.id);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().entity).toMatchObject({
      sharesAuthorized: 1_000_000,
      sharesIssued: 640_000,
      parValue: 100,
    });
    const changes = (await entityActivity(entity.id))
      .filter((row) => row.action === "entity.updated")
      .map((row) => Object.keys((row.payload as { changed: object }).changed));
    expect(changes).toEqual([["sharesAuthorized"], ["sharesIssued"], ["parValue"]]);
  });

  it("rejects negative, fractional, and unsafe share-capital values", async () => {
    const entity = await newEntity("Capital Validation Ltd");
    for (const payload of [
      { sharesAuthorized: -1 },
      { sharesIssued: 1.5 },
      { parValue: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const response = await patchEntity(entity.id, payload);
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it("returns attached Fields and uses shared coercion for required values and types", async () => {
    const entity = await newEntity("Fields Record Ltd");
    const required = await defineAndAttachField("Entity reporting code", "text", undefined, true);
    const count = await defineAndAttachField("Licensed locations", "number");

    const missing = await patchEntity(entity.id, { customFields: { [required.slug]: "  " } });
    expect(missing.statusCode, missing.body).toBe(400);
    expect(missing.json().detail).toContain("Entity reporting code");
    const wrongType = await patchEntity(entity.id, { customFields: { [count.slug]: "many" } });
    expect(wrongType.statusCode, wrongType.body).toBe(400);

    const written = await patchEntity(entity.id, {
      customFields: { [required.slug]: "  ENT-44  ", [count.slug]: 8 },
    });
    expect(written.statusCode, written.body).toBe(200);
    expect(written.json().entity.customFields).toMatchObject({
      [required.slug]: "ENT-44",
      [count.slug]: 8,
    });
    expect(written.json().fields.map((row: { slug: string }) => row.slug)).toEqual(
      expect.arrayContaining([required.slug, count.slug]),
    );
  });

  it("accepts live user and Entity references and rejects archived references", async () => {
    const entity = await newEntity("Reference Fields Ltd");
    const related = await newEntity("Reference Target Ltd");
    const person = await defineAndAttachField("Company secretary", "user");
    const parent = await defineAndAttachField("Reporting Entity", "entity");

    const written = await patchEntity(entity.id, {
      customFields: { [person.slug]: memberId, [parent.slug]: related.id },
    });
    expect(written.statusCode, written.body).toBe(200);
    expect(written.json().customFieldRefs.users).toContainEqual(
      expect.objectContaining({ id: memberId, displayName: MEMBER.displayName, archived: false }),
    );
    expect(written.json().customFieldRefs.entities).toContainEqual(
      expect.objectContaining({ id: related.id, legalName: related.legalName }),
    );

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${related.id}/archive`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const refused = await patchEntity(entity.id, { customFields: { [parent.slug]: related.id } });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain("pick a live entity");
  });
});

describe("Entity officers", () => {
  it("lists current officers first, hides former officers by default, resigns, and deletes", async () => {
    const entity = await newEntity("Officer Record Ltd");
    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/officer-roles",
      cookies: memberCookies,
    });
    expect(options.statusCode, options.body).toBe(200);
    expect(options.json().users).toContainEqual(
      expect.objectContaining({ id: memberId, displayName: MEMBER.displayName }),
    );

    const former = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/officers`,
      cookies: memberCookies,
      payload: {
        name: "Morgan Former",
        officerRoleId: directorRoleId,
        appointedOn: "2020-01-02",
        resignedOn: "2024-05-06",
      },
    });
    expect(former.statusCode, former.body).toBe(201);
    const current = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/officers`,
      cookies: memberCookies,
      payload: {
        name: "Dana Director",
        officerRoleId: directorRoleId,
        appointedOn: "2025-02-03",
        userId: memberId,
      },
    });
    expect(current.statusCode, current.body).toBe(201);

    const currentOnly = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${entity.id}/officers`,
      cookies: memberCookies,
    });
    expect(currentOnly.statusCode, currentOnly.body).toBe(200);
    expect(currentOnly.json().officers.map((row: { name: string }) => row.name)).toEqual([
      "Dana Director",
    ]);

    const all = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${entity.id}/officers?includeFormer=true`,
      cookies: memberCookies,
    });
    expect(all.json().officers.map((row: { name: string }) => row.name)).toEqual([
      "Dana Director",
      "Morgan Former",
    ]);

    const resigned = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}/officers/${current.json().officer.id}`,
      cookies: memberCookies,
      payload: { resignedOn: "2026-08-29" },
    });
    expect(resigned.statusCode, resigned.body).toBe(200);
    expect(resigned.json().officer.resignedOn).toBe("2026-08-29");

    // The link is a person, so the audit map narrates names, not ids.
    const unlinked = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}/officers/${current.json().officer.id}`,
      cookies: memberCookies,
      payload: { userId: null },
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(unlinked.json().officer.user).toBeNull();

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${entity.id}/officers/${former.json().officer.id}`,
      cookies: memberCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const rows = await entityActivity(entity.id);
    expect(rows.map((row) => row.action)).toEqual([
      "entity_officer.created",
      "entity_officer.created",
      "entity_officer.updated",
      "entity_officer.updated",
      "entity_officer.deleted",
    ]);
    expect(rows[3]!.payload).toMatchObject({
      changed: { linkedUser: { from: MEMBER.displayName, to: null } },
    });
  });

  it("rejects an unknown role and a missing child under this Entity", async () => {
    const entity = await newEntity("Officer Validation Ltd");
    const unknownRole = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/officers`,
      cookies: memberCookies,
      payload: { name: "Invalid Director", officerRoleId: "missing" },
    });
    expect(unknownRole.statusCode, unknownRole.body).toBe(400);
    const missingChild = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}/officers/missing`,
      cookies: memberCookies,
      payload: { resignedOn: "2026-08-29" },
    });
    expect(missingChild.statusCode, missingChild.body).toBe(404);
  });
});

describe("Entity registrations", () => {
  it("creates, updates, validates status, deletes, and records every verb", async () => {
    const entity = await newEntity("Registration Record Ltd");
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/registrations`,
      cookies: memberCookies,
      payload: {
        jurisdiction: "Delaware",
        registrationNumber: "DE-88412",
        registeredAgent: "Corporation Service Company",
        status: "active",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().registration.id;

    const invalid = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}/registrations/${id}`,
      cookies: memberCookies,
      payload: { status: "pending" },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);

    const lapsed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}/registrations/${id}`,
      cookies: memberCookies,
      payload: { status: "lapsed" },
    });
    expect(lapsed.statusCode, lapsed.body).toBe(200);
    expect(lapsed.json().registration.status).toBe("lapsed");

    const listed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${entity.id}/registrations`,
      cookies: memberCookies,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().registrations).toContainEqual(
      expect.objectContaining({ jurisdiction: "Delaware", status: "lapsed" }),
    );

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${entity.id}/registrations/${id}`,
      cookies: memberCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect((await entityActivity(entity.id)).map((row) => row.action)).toEqual([
      "entity_registration.created",
      "entity_registration.updated",
      "entity_registration.deleted",
    ]);
  });
});

describe("the Entity record role matrix and Activity feed", () => {
  it("admits Member+ and refuses Contributor, Business User, and anonymous callers", async () => {
    const entity = await newEntity("Role Matrix Ltd");
    const paths = [
      `/api/v1/entities/${entity.id}`,
      `/api/v1/entities/${entity.id}/officers`,
      `/api/v1/entities/${entity.id}/registrations`,
      "/api/v1/entities/officer-roles",
    ];
    for (const path of paths) {
      expect(
        (await harness.app.inject({ method: "GET", url: path, cookies: adminCookies })).statusCode,
      ).toBe(200);
      expect(
        (await harness.app.inject({ method: "GET", url: path, cookies: memberCookies })).statusCode,
      ).toBe(200);
      expect(
        (await harness.app.inject({ method: "GET", url: path, cookies: contributorCookies }))
          .statusCode,
      ).toBe(403);
      expect(
        (await harness.app.inject({ method: "GET", url: path, cookies: businessCookies }))
          .statusCode,
      ).toBe(403);
      expect((await harness.app.inject({ method: "GET", url: path })).statusCode).toBe(401);
    }
  });

  it("reads Entity writes back through the Activity feed", async () => {
    const entity = await newEntity("Activity Feed Ltd");
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/registrations`,
      cookies: memberCookies,
      payload: { jurisdiction: "Delaware", status: "active" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const feed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=entity&entityId=${entity.id}`,
      cookies: memberCookies,
    });
    expect(feed.statusCode, feed.body).toBe(200);
    expect(feed.json().entries.map((row: { action: string }) => row.action)).toEqual(
      expect.arrayContaining(["entity.created", "entity_registration.created"]),
    );
  });
});
