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
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/matter-templates/${template.id}/tasks`,
        cookies: memberCookies,
        payload: { tasks: [] },
      }),
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/matter-templates/${template.id}/key-dates`,
        cookies: memberCookies,
        payload: { keyDates: [] },
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

/**
 * The name is the only identity the creation picker will show inside one
 * type, so two live templates of a type may not share one. The index is
 * partial on the live rows, which is what makes archiving free the name.
 */
describe("the name is unique among live templates of a type", () => {
  it("refuses a second live template of the type with the same name, case-insensitively", async () => {
    await createTemplate({ matterTypeId: employmentTypeId, name: "Unique probe" });
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-templates",
      cookies: adminCookies,
      payload: { matterTypeId: employmentTypeId, name: "UNIQUE PROBE" },
    });
    expect(res.statusCode, res.body).toBe(409);
    // The whole envelope, because the refusal comes from the index
    // rather than from a hand-written throw: a raw unique violation
    // would arrive as a 500 with none of this on it.
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      status: 409,
      type: "about:blank",
      detail: "A template of this Matter type is already called that.",
    });
  });

  it("lets another type carry the same name", async () => {
    await createTemplate({ matterTypeId: employmentTypeId, name: "Shared across types" });
    const [otherType] = await harness.db
      .select()
      .from(matterTypes)
      .where(eq(matterTypes.slug, "ip"))
      .limit(1);
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-templates",
      cookies: adminCookies,
      payload: { matterTypeId: otherType!.id, name: "Shared across types" },
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it("refuses a rename onto a live sibling's name, but takes a case-only rename", async () => {
    await createTemplate({ matterTypeId: employmentTypeId, name: "Rename target" });
    const other = await createTemplate({ matterTypeId: employmentTypeId, name: "Rename source" });
    const clash = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-templates/${other.id}`,
      cookies: adminCookies,
      payload: { name: "rename target" },
    });
    expect(clash.statusCode, clash.body).toBe(409);

    const caseOnly = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-templates/${other.id}`,
      cookies: adminCookies,
      payload: { name: "RENAME SOURCE" },
    });
    expect(caseOnly.statusCode, caseOnly.body).toBe(200);
    expect(caseOnly.json().matterTemplate.name).toBe("RENAME SOURCE");
  });

  it("frees the name on archive, and refuses the restore that would take it back", async () => {
    const first = await createTemplate({ matterTypeId: employmentTypeId, name: "Rotating" });
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${first.id}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    await createTemplate({ matterTypeId: employmentTypeId, name: "Rotating" });

    const restore = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${first.id}/restore`,
      cookies: adminCookies,
    });
    expect(restore.statusCode, restore.body).toBe(409);
    expect(restore.json().detail).toContain("Rename that one first");
  });
});

describe("ordered template content", () => {
  it("replaces Tasks and Key dates as whole ordered lists and audits each changed list", async () => {
    const template = await createTemplate({
      matterTypeId: employmentTypeId,
      name: "Content playbook",
    });

    const tasks = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/tasks`,
      cookies: adminCookies,
      payload: {
        tasks: [
          { title: "Confirm scope", dueOffsetDays: 1, assigneeRole: "matter_manager" },
          { title: "Send notice", dueOffsetDays: null, assigneeRole: "none" },
        ],
      },
    });
    expect(tasks.statusCode, tasks.body).toBe(200);
    expect(tasks.json().matterTemplate).toMatchObject({
      taskCount: 2,
      keyDateCount: 0,
      tasks: [
        {
          id: expect.any(String),
          title: "Confirm scope",
          dueOffsetDays: 1,
          assigneeRole: "matter_manager",
          displayOrder: 1,
        },
        {
          id: expect.any(String),
          title: "Send notice",
          dueOffsetDays: null,
          assigneeRole: "none",
          displayOrder: 2,
        },
      ],
    });
    const originalTaskIds = tasks
      .json()
      .matterTemplate.tasks.map((task: { id: string }) => task.id);

    const noOp = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/tasks`,
      cookies: adminCookies,
      payload: {
        tasks: [
          { title: "Confirm scope", dueOffsetDays: 1, assigneeRole: "matter_manager" },
          { title: "Send notice", dueOffsetDays: null, assigneeRole: "none" },
        ],
      },
    });
    expect(noOp.statusCode, noOp.body).toBe(200);
    expect(noOp.json().matterTemplate.tasks.map((task: { id: string }) => task.id)).toEqual(
      originalTaskIds,
    );

    const reordered = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/tasks`,
      cookies: adminCookies,
      payload: {
        tasks: [
          { title: "Send notice", dueOffsetDays: 2, assigneeRole: "none" },
          { title: "Confirm scope", dueOffsetDays: 1, assigneeRole: "matter_manager" },
        ],
      },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(
      reordered
        .json()
        .matterTemplate.tasks.map((task: { title: string; displayOrder: number }) => [
          task.title,
          task.displayOrder,
        ]),
    ).toEqual([
      ["Send notice", 1],
      ["Confirm scope", 2],
    ]);

    const keyDates = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/key-dates`,
      cookies: adminCookies,
      payload: {
        keyDates: [
          {
            label: "Response deadline",
            offsetDays: 14,
            note: "Confirm the statutory deadline.",
          },
          { label: "Review checkpoint", offsetDays: 30, note: null },
        ],
      },
    });
    expect(keyDates.statusCode, keyDates.body).toBe(200);
    expect(keyDates.json().matterTemplate).toMatchObject({
      taskCount: 2,
      keyDateCount: 2,
      keyDates: [
        {
          id: expect.any(String),
          label: "Response deadline",
          offsetDays: 14,
          note: "Confirm the statutory deadline.",
          displayOrder: 1,
        },
        {
          id: expect.any(String),
          label: "Review checkpoint",
          offsetDays: 30,
          note: null,
          displayOrder: 2,
        },
      ],
    });

    const list = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matter-templates?matterTypeId=${employmentTypeId}`,
      cookies: adminCookies,
    });
    const listed = list
      .json()
      .matterTemplates.find((row: { id: string }) => row.id === template.id);
    expect(listed.tasks).toEqual(reordered.json().matterTemplate.tasks);
    expect(listed.keyDates).toEqual(keyDates.json().matterTemplate.keyDates);

    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "matter_template.updated"));
    const contentEntries = entries.filter(
      (entry) => entry.payload.displayName === "Content playbook",
    );
    expect(contentEntries).toHaveLength(3);
    expect(contentEntries.map((entry) => Object.keys(entry.payload.changed as object))).toEqual(
      expect.arrayContaining([["tasks"], ["tasks"], ["keyDates"]]),
    );
  });

  it("validates required text, role targets, offsets, bounds, and ids, and blanks an empty note", async () => {
    const template = await createTemplate({
      matterTypeId: employmentTypeId,
      name: "Content validation",
    });
    const attempts = [
      {
        url: `/api/v1/matter-templates/${template.id}/tasks`,
        payload: { tasks: [{ title: " ", dueOffsetDays: 1, assigneeRole: "none" }] },
      },
      {
        url: `/api/v1/matter-templates/${template.id}/tasks`,
        payload: { tasks: [{ title: "Task", dueOffsetDays: -1, assigneeRole: "none" }] },
      },
      {
        url: `/api/v1/matter-templates/${template.id}/tasks`,
        payload: { tasks: [{ title: "Task", dueOffsetDays: 1, assigneeRole: "owner" }] },
      },
      {
        url: `/api/v1/matter-templates/${template.id}/key-dates`,
        payload: { keyDates: [{ label: " ", offsetDays: 1, note: null }] },
      },
      {
        url: `/api/v1/matter-templates/${template.id}/key-dates`,
        payload: { keyDates: [{ label: "Date", offsetDays: 3651, note: null }] },
      },
      {
        url: `/api/v1/matter-templates/${template.id}/key-dates`,
        payload: { keyDates: [{ label: "Date", offsetDays: 1.5, note: null }] },
      },
    ];
    for (const attempt of attempts) {
      const response = await harness.app.inject({
        method: "PUT",
        url: attempt.url,
        cookies: adminCookies,
        payload: attempt.payload,
      });
      expect(response.statusCode, response.body).toBe(400);
    }

    const blankNote = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/key-dates`,
      cookies: adminCookies,
      payload: { keyDates: [{ label: "Date", offsetDays: 1, note: "  " }] },
    });
    expect(blankNote.statusCode, blankNote.body).toBe(200);
    expect(blankNote.json().matterTemplate.keyDates[0].note).toBeNull();

    const missing = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-templates/no-such-template/tasks",
      cookies: adminCookies,
      payload: { tasks: [] },
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });

  it("keeps both child lists intact through archive and restore", async () => {
    const template = await createTemplate({
      matterTypeId: employmentTypeId,
      name: "Retained content",
    });
    await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/tasks`,
      cookies: adminCookies,
      payload: {
        tasks: [{ title: "Retained task", dueOffsetDays: 0, assigneeRole: "none" }],
      },
    });
    await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matter-templates/${template.id}/key-dates`,
      cookies: adminCookies,
      payload: { keyDates: [{ label: "Retained date", offsetDays: 7, note: null }] },
    });
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${template.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.json().matterTemplate).toMatchObject({
      tasks: [{ title: "Retained task", dueOffsetDays: 0 }],
      keyDates: [{ label: "Retained date", offsetDays: 7 }],
    });
    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-templates/${template.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().matterTemplate).toMatchObject({
      tasks: [{ title: "Retained task", dueOffsetDays: 0 }],
      keyDates: [{ label: "Retained date", offsetDays: 7 }],
    });
  });
});
