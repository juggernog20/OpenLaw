// SPDX-License-Identifier: AGPL-3.0-only

/** Matter field attachment: scope isolation, requiredness, ordering, retention and audit. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, fields, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
});

afterAll(async () => {
  await harness.stop();
});

interface TypeRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  archivedAt: string | null;
}

interface AttachedFieldRow {
  fieldId: string;
  slug: string;
  displayName: string;
  fieldType: string;
  moduleScope: string;
  displayOrder: number;
  isRequired: boolean;
}

const typeBySlug = async (slug: string): Promise<TypeRow> => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matter-types?includeArchived=true",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const row = (res.json().matterTypes as TypeRow[]).find((candidate) => candidate.slug === slug);
  expect(row, slug).toBeDefined();
  return row!;
};

const listAttached = async (typeId: string): Promise<AttachedFieldRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matter-types/${typeId}/fields`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachedFields;
};

const attach = async (typeId: string, payload: Record<string, unknown>) => {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/matter-types/${typeId}/fields`,
    cookies: adminCookies,
    payload,
  });
};

/** Defines a catalog field through the Fields pane's own create route. */
const createField = async (displayName: string, moduleScope: "contract" | "matter") => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { displayName, moduleScope, fieldType: "text", fieldTag: "business" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().field as { id: string; slug: string; inUseCount: number };
};

const fieldById = async (id: string) => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/fields?includeArchived=true",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().fields as { id: string; slug: string; inUseCount: number }[]).find(
    (candidate) => candidate.id === id,
  );
};

const attachmentAuditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "matter_type_field.attached",
        "matter_type_field.detached",
        "matter_type_field.reordered",
        "matter_type_field.required_changed",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("the SET-002 role gate", () => {
  it("refuses a Legal Team Member on the attachment surface", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const employment = await typeBySlug("employment");
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matter-types/${employment.id}/fields`,
      cookies,
    });
    expect(read.statusCode, read.body).toBe(403);
    const write = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${employment.id}/fields`,
      cookies,
      payload: { fieldId: "any" },
    });
    expect(write.statusCode, write.body).toBe(403);
    expect(await listAttached(employment.id)).toEqual([]);
  });
});

describe("the MTR-011 scope rule", () => {
  it("attaches a matter field, appended to the per-type order", async () => {
    const employment = await typeBySlug("employment");
    const budget = await createField("Budget owner", "matter");
    const res = await attach(employment.id, { fieldId: budget.id });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().attachedField).toMatchObject({
      fieldId: budget.id,
      slug: budget.slug,
      moduleScope: "matter",
      displayOrder: 1,
      isRequired: false,
    });

    const second = await createField("Business unit", "matter");
    const next = await attach(employment.id, { fieldId: second.id, isRequired: true });
    expect(next.statusCode, next.body).toBe(201);
    expect(next.json().attachedField).toMatchObject({ displayOrder: 2, isRequired: true });

    expect((await listAttached(employment.id)).map((row) => row.fieldId)).toEqual([
      budget.id,
      second.id,
    ]);
  });

  it("refuses a contract-scoped field as 400 problem+json", async () => {
    const employment = await typeBySlug("employment");
    // governing_law is a CTR-008 contract-scoped seed.
    const [governingLaw] = await harness.db
      .select({ id: fields.id })
      .from(fields)
      .where(eq(fields.slug, "governing_law"));
    const res = await attach(employment.id, { fieldId: governingLaw!.id });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect((await listAttached(employment.id)).some((row) => row.slug === "governing_law")).toBe(
      false,
    );
  });

  it("attaches a matter-scoped field", async () => {
    const employment = await typeBySlug("employment");
    const matterField = await createField("Case number", "matter");
    const res = await attach(employment.id, { fieldId: matterField.id });
    expect(res.statusCode, res.body).toBe(201);
    expect((await listAttached(employment.id)).some((row) => row.slug === matterField.slug)).toBe(
      true,
    );
  });

  it("refuses an unknown field and an unknown type as 404, a duplicate as 409", async () => {
    const employment = await typeBySlug("employment");
    const unknownField = await attach(employment.id, { fieldId: "no-such-id" });
    expect(unknownField.statusCode, unknownField.body).toBe(404);
    const attached = (await listAttached(employment.id))[0]!;
    const unknownType = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types/no-such-id/fields",
      cookies: adminCookies,
      payload: { fieldId: attached.fieldId },
    });
    expect(unknownType.statusCode, unknownType.body).toBe(404);
    const duplicate = await attach(employment.id, { fieldId: attached.fieldId });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
  });

  it("refuses an archived field as 409 — restore it first", async () => {
    const employment = await typeBySlug("employment");
    const dormant = await createField("Dormant", "matter");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${dormant.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const res = await attach(employment.id, { fieldId: dormant.id });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("PATCH /matter-types/:id/fields/:fieldId (required)", () => {
  it("persists the per-attachment required flag both ways", async () => {
    const employment = await typeBySlug("employment");
    const [first] = await listAttached(employment.id);
    const on = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${employment.id}/fields/${first!.fieldId}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json().attachedField.isRequired).toBe(true);
    expect((await listAttached(employment.id))[0]!.isRequired).toBe(true);

    const off = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${employment.id}/fields/${first!.fieldId}`,
      cookies: adminCookies,
      payload: { isRequired: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((await listAttached(employment.id))[0]!.isRequired).toBe(false);
  });

  it("answers 404 for a field that is not attached", async () => {
    const employment = await typeBySlug("employment");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${employment.id}/fields/no-such-id`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("PUT /matter-types/:id/fields/order (reorder)", () => {
  it("applies a permutation and renumbers the per-type order from 1", async () => {
    const employment = await typeBySlug("employment");
    const before = await listAttached(employment.id);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const reversed = [...before].reverse();
    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-types/${employment.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: reversed.map((row) => row.fieldId) },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = await listAttached(employment.id);
    expect(after.map((row) => row.fieldId)).toEqual(reversed.map((row) => row.fieldId));
    expect(after.map((row) => row.displayOrder)).toEqual(after.map((_, index) => index + 1));
  });

  it("rejects a list that is not exactly the attached fields", async () => {
    const employment = await typeBySlug("employment");
    const rows = await listAttached(employment.id);
    const partial = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-types/${employment.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: rows.slice(1).map((row) => row.fieldId) },
    });
    expect(partial.statusCode, partial.body).toBe(400);
  });
});

describe("DELETE /matter-types/:id/fields/:fieldId (detach)", () => {
  it("removes the attachment only — the catalog definition stays (MTR-014)", async () => {
    const employment = await typeBySlug("employment");
    const rows = await listAttached(employment.id);
    const target = rows.at(-1)!;
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matter-types/${employment.id}/fields/${target.fieldId}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listAttached(employment.id)).some((row) => row.fieldId === target.fieldId)).toBe(
      false,
    );
    expect(await fieldById(target.fieldId)).toBeDefined();

    const again = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matter-types/${employment.id}/fields/${target.fieldId}`,
      cookies: adminCookies,
    });
    expect(again.statusCode, again.body).toBe(404);
  });
});

describe("the DD-017 audit trail", () => {
  it("records every attachment mutation under the matter_type_field namespace", async () => {
    const rows = await attachmentAuditRows();
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "matter_type_field.attached",
      "matter_type_field.detached",
      "matter_type_field.reordered",
      "matter_type_field.required_changed",
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    for (const row of rows) {
      expect(row.entityType).toBe("system");
      expect(row.visibility).toBe("admin_only");
    }
    const attachedEntry = rows.find((row) => row.action === "matter_type_field.attached");
    expect(attachedEntry?.payload).toMatchObject({ typeSlug: "employment" });
  });

  it("writes exactly one entry per mutation — a duplicate write fails the count", async () => {
    // A fresh type isolates the count from every mutation the suite ran
    // above: filter the trail by this type's slug and the numbers are
    // exact, whatever runs before.
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "Audit Count Probe" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const probe = created.json().matterType as TypeRow;

    const first = await createField("Audit probe one", "matter");
    const second = await createField("Audit probe two", "matter");

    expect((await attach(probe.id, { fieldId: first.id })).statusCode).toBe(201);
    expect((await attach(probe.id, { fieldId: second.id })).statusCode).toBe(201);
    const reordered = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-types/${probe.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: [second.id, first.id] },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const required = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${probe.id}/fields/${first.id}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(required.statusCode, required.body).toBe(200);
    const detached = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matter-types/${probe.id}/fields/${second.id}`,
      cookies: adminCookies,
    });
    expect(detached.statusCode, detached.body).toBe(204);

    const mine = (await attachmentAuditRows()).filter(
      (entry) => (entry.payload as { typeSlug?: string }).typeSlug === probe.slug,
    );
    const tally = (action: string) =>
      mine.filter((entry) => entry.action === `matter_type_field.${action}`).length;
    expect(tally("attached")).toBe(2);
    expect(tally("reordered")).toBe(1);
    expect(tally("required_changed")).toBe(1);
    expect(tally("detached")).toBe(1);
    expect(mine).toHaveLength(5);
  });

  it("does not log a required change to the current value", async () => {
    const employment = await typeBySlug("employment");
    const [first] = await listAttached(employment.id);
    const before = (await attachmentAuditRows()).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${employment.id}/fields/${first!.fieldId}`,
      cookies: adminCookies,
      payload: { isRequired: first!.isRequired },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await attachmentAuditRows()).toHaveLength(before);
  });
});
