// SPDX-License-Identifier: AGPL-3.0-only

/** HTTP-seam coverage for the MTR-013 template entity core. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, inArray, matterTypes, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let employmentTypeId: string;
let litigationTypeId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  const member = await provisionUser(harness.app.auth, {
    email: "template-member@example.com",
    displayName: "Template Member",
    password: "correct-horse-battery",
  });
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(
    harness.app,
    "template-member@example.com",
    "correct-horse-battery",
  );

  const types = await harness.db.select().from(matterTypes).orderBy(asc(matterTypes.displayOrder));
  employmentTypeId = types.find((row) => row.slug === "employment")!.id;
  litigationTypeId = types.find((row) => row.slug === "litigation")!.id;
});

afterAll(async () => {
  await harness.stop();
});

const createTemplate = async (payload: Record<string, unknown>) => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-templates",
    cookies: adminCookies,
    payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterTemplate;
};

const TEMPLATE_ACTIONS = [
  "matter_template.created",
  "matter_template.updated",
  "matter_template.archived",
  "matter_template.restored",
] as const;

describe("the SET-002 gate", () => {
  it("requires an Administrator on reads and every mutation", async () => {
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/matter-templates" })).statusCode,
    ).toBe(401);

    const template = await createTemplate({
      matterTypeId: employmentTypeId,
      name: "Gate probe",
    });
    const attempts = [
      harness.app.inject({
        method: "GET",
        url: "/api/v1/matter-templates",
        cookies: memberCookies,
      }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/matter-templates",
        cookies: memberCookies,
        payload: { matterTypeId: employmentTypeId, name: "No" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/matter-templates/${template.id}`,
        cookies: memberCookies,
        payload: { name: "No" },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/matter-templates/${template.id}/archive`,
        cookies: memberCookies,
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/matter-templates/${template.id}/restore`,
        cookies: memberCookies,
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
  });
});

describe("Matter template lifecycle", () => {
  it("creates, filters, edits, archives, and restores without losing the definition", async () => {
    const created = await createTemplate({
      matterTypeId: employmentTypeId,
      name: "Employment – Termination",
      description: "Opening playbook",
      defaultPriority: "high",
      defaultRisk: "medium",
      titlePrefix: "EMP —",
    });
    expect(created).toMatchObject({
      matterTypeId: employmentTypeId,
      matterTypeName: "Employment",
      name: "Employment – Termination",
      description: "Opening playbook",
      defaultPriority: "high",
      defaultRisk: "medium",
      titlePrefix: "EMP —",
      archivedAt: null,
      taskCount: 0,
      keyDateCount: 0,
      customFieldCount: 0,
    });

    await createTemplate({ matterTypeId: litigationTypeId, name: "Litigation standard" });
    const filtered = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matter-templates?matterTypeId=${employmentTypeId}`,
      cookies: adminCookies,
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    const filteredRows = filtered.json().matterTemplates as {
      id: string;
      matterTypeId: string;
    }[];
    expect(filteredRows).toContainEqual(
      expect.objectContaining({ id: created.id, matterTypeId: employmentTypeId }),
    );
    expect(filteredRows.every((row) => row.matterTypeId === employmentTypeId)).toBe(true);

    const patched = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-templates/${created.id}`,
      cookies: adminCookies,
      payload: {
        name: "Employment – Separation",
        description: "Renamed playbook",
        defaultPriority: "critical",
        defaultRisk: null,
        titlePrefix: null,
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().matterTemplate).toMatchObject({
      name: "Employment – Separation",
      description: "Renamed playbook",
      defaultPriority: "critical",
      defaultRisk: null,
      titlePrefix: null,
    });

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${created.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().matterTemplate.archivedAt).toEqual(expect.any(String));

    const live = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matter-templates?matterTypeId=${employmentTypeId}`,
      cookies: adminCookies,
    });
    expect(live.json().matterTemplates.some((row: { id: string }) => row.id === created.id)).toBe(
      false,
    );
    const all = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matter-templates?matterTypeId=${employmentTypeId}&includeArchived=true`,
      cookies: adminCookies,
    });
    expect(
      all.json().matterTemplates.find((row: { id: string }) => row.id === created.id),
    ).toMatchObject({
      name: "Employment – Separation",
      description: "Renamed playbook",
      defaultPriority: "critical",
    });

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${created.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().matterTemplate).toMatchObject({
      id: created.id,
      archivedAt: null,
      name: "Employment – Separation",
      description: "Renamed playbook",
    });

    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(inArray(activityLog.action, [...TEMPLATE_ACTIONS]))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
    expect(
      entries.filter((entry) => entry.payload.displayName === "Employment – Separation"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "matter_template.updated", visibility: "admin_only" }),
        expect.objectContaining({ action: "matter_template.archived", visibility: "admin_only" }),
        expect.objectContaining({ action: "matter_template.restored", visibility: "admin_only" }),
      ]),
    );
  });

  it("validates inputs, ids, type state, and archive state", async () => {
    const invalidSeverity = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-templates",
      cookies: adminCookies,
      payload: { matterTypeId: employmentTypeId, name: "Bad", defaultPriority: "urgent" },
    });
    expect(invalidSeverity.statusCode).toBe(400);

    const missingType = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-templates",
      cookies: adminCookies,
      payload: { matterTypeId: "no-such-type", name: "Bad" },
    });
    expect(missingType.statusCode).toBe(404);

    const target = await createTemplate({ matterTypeId: litigationTypeId, name: "State probe" });
    const restoreLive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${target.id}/restore`,
      cookies: adminCookies,
    });
    expect(restoreLive.statusCode).toBe(409);
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${target.id}/archive`,
      cookies: adminCookies,
    });
    const archiveTwice = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${target.id}/archive`,
      cookies: adminCookies,
    });
    expect(archiveTwice.statusCode).toBe(409);

    await harness.db
      .update(matterTypes)
      .set({ archivedAt: new Date() })
      .where(eq(matterTypes.id, litigationTypeId));
    const archivedType = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-templates",
      cookies: adminCookies,
      payload: { matterTypeId: litigationTypeId, name: "No" },
    });
    expect(archivedType.statusCode).toBe(409);
  });
});
