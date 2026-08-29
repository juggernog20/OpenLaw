// SPDX-License-Identifier: AGPL-3.0-only

/** Entity type Fields: the third mount of the shared attachment routes (TECH-023). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, eq, fields, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "entity-fields-member@example.com",
  displayName: "Entity Fields Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let entityTypeId: string;

interface AttachedField {
  fieldId: string;
  slug: string;
  moduleScope: string;
  displayOrder: number;
  isRequired: boolean;
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

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entity-types",
    cookies: adminCookies,
  });
  entityTypeId = types.json().entityTypes.find((row: { slug: string }) => row.slug === "other").id;
});

afterAll(async () => harness.stop());

async function createField(displayName: string, moduleScope: "entity" | "global" | "contract") {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: {
      displayName,
      moduleScope,
      fieldType: "text",
      fieldTag: "legal",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().field as { id: string; slug: string; moduleScope: string; inUseCount: number };
}

async function listAttached(cookies = adminCookies): Promise<AttachedField[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/entity-types/${entityTypeId}/fields`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachedFields;
}

describe("the Entity Field catalog scope", () => {
  it("opens entity to list, create, and scope writes", async () => {
    const field = await createField("Entity reporting code", "entity");
    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/fields?includeArchived=true",
      cookies: adminCookies,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().fields).toContainEqual(
      expect.objectContaining({ id: field.id, moduleScope: "entity" }),
    );

    const global = await createField("Entity global candidate", "global");
    const narrowed = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/fields/${global.id}/scope`,
      cookies: adminCookies,
      payload: { moduleScope: "entity" },
    });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    expect(narrowed.json().field.moduleScope).toBe("entity");
  });
});

describe("the entity_type_fields route mount", () => {
  it("keeps every attachment route Administrator-only", async () => {
    const list = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entity-types/${entityTypeId}/fields`,
      cookies: memberCookies,
    });
    expect(list.statusCode).toBe(403);
    const anonymous = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entity-types/${entityTypeId}/fields`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("admits entity and global Fields, refuses another module, and refuses duplicates", async () => {
    const entityField = await createField("Entity registration class", "entity");
    const globalField = await createField("Group reference", "global");
    const contractField = await createField("Contract-only reference", "contract");

    for (const field of [entityField, globalField]) {
      const attached = await harness.app.inject({
        method: "POST",
        url: `/api/v1/entity-types/${entityTypeId}/fields`,
        cookies: adminCookies,
        payload: { fieldId: field.id },
      });
      expect(attached.statusCode, attached.body).toBe(201);
      expect(attached.json().attachedField.moduleScope).toBe(field.moduleScope);
    }

    const wrongScope = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${entityTypeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId: contractField.id },
    });
    expect(wrongScope.statusCode, wrongScope.body).toBe(400);
    expect(wrongScope.json().detail).toContain("entity-scoped and global");

    const duplicate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${entityTypeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId: entityField.id },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
  });

  it("sets required, reorders, and detaches without deleting the catalog Field", async () => {
    const before = await listAttached();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const target = before[0]!;

    const required = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${entityTypeId}/fields/${target.fieldId}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(required.statusCode, required.body).toBe(200);
    expect(required.json().attachedField.isRequired).toBe(true);

    const reversed = [...(await listAttached())].reverse();
    const reordered = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/entity-types/${entityTypeId}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: reversed.map((row) => row.fieldId) },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(reordered.json().attachedFields.map((row: AttachedField) => row.fieldId)).toEqual(
      reversed.map((row) => row.fieldId),
    );

    const detached = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entity-types/${entityTypeId}/fields/${target.fieldId}`,
      cookies: adminCookies,
    });
    expect(detached.statusCode, detached.body).toBe(204);
    expect((await listAttached()).some((row) => row.fieldId === target.fieldId)).toBe(false);
    expect(
      await harness.db.select().from(fields).where(eq(fields.id, target.fieldId)),
    ).toHaveLength(1);
  });

  it("counts the Entity attachment in the catalog narrowing guard", async () => {
    const globalField = await createField("Entity narrowing guard", "global");
    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${entityTypeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId: globalField.id },
    });
    expect(attached.statusCode, attached.body).toBe(201);

    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/fields?includeArchived=true",
      cookies: adminCookies,
    });
    expect(
      list.json().fields.find((row: { id: string }) => row.id === globalField.id).inUseCount,
    ).toBe(1);

    const narrowed = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/fields/${globalField.id}/scope`,
      cookies: adminCookies,
      payload: { moduleScope: "contract" },
    });
    expect(narrowed.statusCode, narrowed.body).toBe(409);
  });
});

describe("the DD-017 audit trail", () => {
  it("records every attachment verb under entity_type_field", async () => {
    const rows = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(
        inArray(activityLog.action, [
          "entity_type_field.attached",
          "entity_type_field.required_changed",
          "entity_type_field.reordered",
          "entity_type_field.detached",
        ]),
      );
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set([
        "entity_type_field.attached",
        "entity_type_field.required_changed",
        "entity_type_field.reordered",
        "entity_type_field.detached",
      ]),
    );
  });
});
