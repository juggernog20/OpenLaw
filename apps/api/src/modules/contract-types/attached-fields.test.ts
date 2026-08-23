// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract type editor (#84) at the HTTP seam: the single-type read
 * behind the editor, the description edit, and the CTR-016 attachment
 * machinery — attach and detach for contract-scoped and global fields
 * with other scopes refused, per-type reordering, the per-attachment
 * required flag, and detach never touching the catalog definition —
 * behind SET-002's one role gate, with every attachment mutation
 * appending to the activity log (DD-017). Asserted at the HTTP seam
 * plus direct activity_log reads — the log has no read routes until M9.
 */

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
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
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
    url: "/api/v1/contract-types?includeArchived=true",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const row = (res.json().contractTypes as TypeRow[]).find((candidate) => candidate.slug === slug);
  expect(row, slug).toBeDefined();
  return row!;
};

const getType = async (id: string) => {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${id}`,
    cookies: adminCookies,
  });
};

const listAttached = async (typeId: string): Promise<AttachedFieldRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${typeId}/fields`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachedFields;
};

const attach = async (typeId: string, payload: Record<string, unknown>) => {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/contract-types/${typeId}/fields`,
    cookies: adminCookies,
    payload,
  });
};

/** A catalog field's id by slug, via the Fields pane's own list route. */
const fieldIdBySlug = async (slug: string): Promise<string> => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/fields?includeArchived=true",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const row = (res.json().fields as { id: string; slug: string }[]).find(
    (candidate) => candidate.slug === slug,
  );
  expect(row, slug).toBeDefined();
  return row!.id;
};

const attachmentAuditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "contract_type_field.attached",
        "contract_type_field.detached",
        "contract_type_field.reordered",
        "contract_type_field.required_changed",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("the single-type read behind the editor", () => {
  it("returns one type with its description, null until one is written", async () => {
    const nda = await typeBySlug("nda");
    const res = await getType(nda.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType).toMatchObject({
      id: nda.id,
      slug: "nda",
      displayName: "NDA",
      description: null,
      inUseCount: 0,
    });
  });

  it("404s an unknown id as problem+json", async () => {
    const res = await getType("019ff281-0000-7000-8000-000000000000");
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("the description edit (the editor's left card)", () => {
  it("writes a description through PATCH and reads it back", async () => {
    const nda = await typeBySlug("nda");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${nda.id}`,
      cookies: adminCookies,
      payload: { description: "Mutual or one-way non-disclosure agreements." },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.description).toBe(
      "Mutual or one-way non-disclosure agreements.",
    );
    const readBack = await getType(nda.id);
    expect(readBack.json().contractType.description).toBe(
      "Mutual or one-way non-disclosure agreements.",
    );
  });

  it("clears a description with null and audits the change", async () => {
    const msa = await typeBySlug("msa");
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${msa.id}`,
      cookies: adminCookies,
      payload: { description: "Master service agreements." },
    });
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${msa.id}`,
      cookies: adminCookies,
      payload: { description: null },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.description).toBeNull();

    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "contract_type.updated"))
      .orderBy(asc(activityLog.createdAt));
    expect(entries.at(-1)!.payload).toMatchObject({
      slug: "msa",
      changed: { description: { from: "Master service agreements.", to: null } },
    });
  });

  it("renames and describes in one request, auditing each as itself", async () => {
    const sow = await typeBySlug("sow");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${sow.id}`,
      cookies: adminCookies,
      payload: { displayName: "Statement of work", description: "Work under an MSA." },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType).toMatchObject({
      displayName: "Statement of work",
      description: "Work under an MSA.",
    });

    const renames = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "contract_type.renamed"))
      .orderBy(asc(activityLog.createdAt));
    expect(renames.at(-1)!.payload).toMatchObject({
      slug: "sow",
      from: "SOW",
      to: "Statement of work",
    });
  });
});

describe("attach and detach (CTR-016 scopes)", () => {
  it("attaches a contract-scoped and a global field, in attachment order", async () => {
    const nda = await typeBySlug("nda");
    const governingLaw = await fieldIdBySlug("governing_law");

    // A global field, created through the catalog route like an
    // Administrator would.
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/fields",
      cookies: adminCookies,
      payload: {
        displayName: "Department",
        moduleScope: "global",
        fieldType: "single_select",
        fieldTag: "business",
        options: ["Legal", "Sales"],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const departmentId = created.json().field.id;

    const first = await attach(nda.id, { fieldId: governingLaw });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().attachedField).toMatchObject({
      fieldId: governingLaw,
      slug: "governing_law",
      displayName: "Governing law",
      fieldType: "text",
      moduleScope: "contract",
      displayOrder: 1,
      isRequired: false,
    });

    const second = await attach(nda.id, { fieldId: departmentId, isRequired: true });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().attachedField).toMatchObject({
      slug: "department",
      moduleScope: "global",
      displayOrder: 2,
      isRequired: true,
    });

    expect((await listAttached(nda.id)).map((row) => row.slug)).toEqual([
      "governing_law",
      "department",
    ]);
  });

  it("refuses a field whose scope belongs to another module", async () => {
    const nda = await typeBySlug("nda");
    // Plant a Matter-scoped field directly to isolate the Contract
    // attachment refusal from the catalog route M22 opened.
    const [matterField] = await harness.db
      .insert(fields)
      .values({
        slug: "practice_area",
        displayName: "Practice area",
        moduleScope: "matter",
        fieldType: "text",
        fieldTag: "legal",
      })
      .returning();
    const res = await attach(nda.id, { fieldId: matterField!.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("contract-scoped and global fields");
    expect(await listAttached(nda.id)).not.toContainEqual(
      expect.objectContaining({ slug: "practice_area" }),
    );
  });

  it("refuses an archived field — archived means hidden everywhere", async () => {
    const nda = await typeBySlug("nda");
    const jurisdiction = await fieldIdBySlug("jurisdiction");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${jurisdiction}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const res = await attach(nda.id, { fieldId: jurisdiction });
    expect(res.statusCode).toBe(409);
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${jurisdiction}/restore`,
      cookies: adminCookies,
    });
  });

  it("refuses attaching the same field twice", async () => {
    const nda = await typeBySlug("nda");
    const governingLaw = await fieldIdBySlug("governing_law");
    const res = await attach(nda.id, { fieldId: governingLaw });
    expect(res.statusCode).toBe(409);
  });

  it("404s an unknown type and an unknown field", async () => {
    const nda = await typeBySlug("nda");
    const governingLaw = await fieldIdBySlug("governing_law");
    const noType = await attach("019ff281-0000-7000-8000-000000000000", {
      fieldId: governingLaw,
    });
    expect(noType.statusCode).toBe(404);
    const noField = await attach(nda.id, { fieldId: "019ff281-0000-7000-8000-000000000000" });
    expect(noField.statusCode).toBe(404);
  });

  it("scopes attachments to their own type", async () => {
    const msa = await typeBySlug("msa");
    expect(await listAttached(msa.id)).toEqual([]);
  });

  it("detaches without touching the catalog definition", async () => {
    const nda = await typeBySlug("nda");
    const ourPosition = await fieldIdBySlug("our_position");
    const attached = await attach(nda.id, { fieldId: ourPosition });
    expect(attached.statusCode, attached.body).toBe(201);

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${nda.id}/fields/${ourPosition}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listAttached(nda.id)).map((row) => row.slug)).not.toContain("our_position");

    // The catalog definition is untouched — detach is never delete.
    const catalog = await harness.app.inject({
      method: "GET",
      url: "/api/v1/fields",
      cookies: adminCookies,
    });
    expect(catalog.json().fields).toContainEqual(
      expect.objectContaining({ slug: "our_position", archivedAt: null }),
    );

    const detachAgain = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${nda.id}/fields/${ourPosition}`,
      cookies: adminCookies,
    });
    expect(detachAgain.statusCode).toBe(404);
  });
});

describe("the per-attachment required flag", () => {
  it("toggles and persists per attachment, not per field", async () => {
    const nda = await typeBySlug("nda");
    const sales = await typeBySlug("sales");
    const governingLaw = await fieldIdBySlug("governing_law");
    // The same field on a second type: required for NDAs, optional here.
    const onSales = await attach(sales.id, { fieldId: governingLaw });
    expect(onSales.statusCode, onSales.body).toBe(201);

    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${nda.id}/fields/${governingLaw}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().attachedField.isRequired).toBe(true);

    const ndaRow = (await listAttached(nda.id)).find((row) => row.slug === "governing_law");
    const salesRow = (await listAttached(sales.id)).find((row) => row.slug === "governing_law");
    expect(ndaRow!.isRequired).toBe(true);
    expect(salesRow!.isRequired).toBe(false);
  });

  it("404s a field that is not attached to the type", async () => {
    const msa = await typeBySlug("msa");
    const governingLaw = await fieldIdBySlug("governing_law");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${msa.id}/fields/${governingLaw}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("per-type reordering", () => {
  it("applies a full permutation and persists it", async () => {
    const nda = await typeBySlug("nda");
    const before = await listAttached(nda.id);
    expect(before.length).toBeGreaterThan(1);
    const reversed = [...before].reverse().map((row) => row.fieldId);

    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/contract-types/${nda.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: reversed },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      (res.json().attachedFields as AttachedFieldRow[]).map((row) => row.displayOrder),
    ).toEqual(reversed.map((_, index) => index + 1));
    expect((await listAttached(nda.id)).map((row) => row.fieldId)).toEqual(reversed);
  });

  it("refuses a list that is not a permutation of the attachments", async () => {
    const nda = await typeBySlug("nda");
    const rows = await listAttached(nda.id);
    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/contract-types/${nda.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: rows.slice(1).map((row) => row.fieldId) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("attachments whose field is archived", () => {
  it("hides them, renumbers them behind a reorder, and restores them to the end", async () => {
    const employment = await typeBySlug("employment");
    const mk = async (displayName: string) => {
      const res = await harness.app.inject({
        method: "POST",
        url: "/api/v1/fields",
        cookies: adminCookies,
        payload: { displayName, moduleScope: "contract", fieldType: "text", fieldTag: "legal" },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().field.id as string;
    };
    // Attached first, so its display order sits ahead of the others.
    const early = await mk("Early bird");
    const second = await mk("Second");
    const third = await mk("Third");
    for (const fieldId of [early, second, third]) {
      const res = await attach(employment.id, { fieldId });
      expect(res.statusCode, res.body).toBe(201);
    }

    // Archiving the field hides its attachment — but detaches nothing.
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${early}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect((await listAttached(employment.id)).map((row) => row.slug)).toEqual(["second", "third"]);

    // Reordering the live rows renumbers the hidden attachment behind
    // them, so its old order can't collide with the new front.
    const reorder = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/contract-types/${employment.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: [third, second] },
    });
    expect(reorder.statusCode, reorder.body).toBe(200);

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${early}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    // The restored field rejoins its attachments at the end — the
    // DES-020 restore position, not the front of the list.
    expect((await listAttached(employment.id)).map((row) => row.slug)).toEqual([
      "third",
      "second",
      "early_bird",
    ]);
  });
});

describe("the DD-017 activity trail", () => {
  it("records every attachment mutation in vocabulary, admin-only, with the actor", async () => {
    const entries = await attachmentAuditRows();
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain("contract_type_field.attached");
    expect(actions).toContain("contract_type_field.detached");
    expect(actions).toContain("contract_type_field.required_changed");
    expect(actions).toContain("contract_type_field.reordered");

    const attachedEntry = entries.find((entry) => entry.action === "contract_type_field.attached")!;
    expect(attachedEntry.payload).toMatchObject({
      typeSlug: "nda",
      fieldSlug: "governing_law",
      isRequired: false,
    });
    expect(attachedEntry.visibility).toBe("admin_only");
    expect(attachedEntry.actorId).not.toBeNull();

    const reorderedEntry = entries.find(
      (entry) => entry.action === "contract_type_field.reordered",
    )!;
    expect(reorderedEntry.payload).toMatchObject({ typeSlug: "nda" });
  });

  it("writes exactly one entry per mutation — a duplicate write fails the count", async () => {
    // A fresh type isolates the count from every mutation the suite ran
    // above: filter the trail by this type's slug and the numbers are
    // exact, whatever runs before.
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "Audit Count Probe" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const probe = created.json().contractType as TypeRow;

    const mkField = async (displayName: string) => {
      const res = await harness.app.inject({
        method: "POST",
        url: "/api/v1/fields",
        cookies: adminCookies,
        payload: { displayName, moduleScope: "contract", fieldType: "text", fieldTag: "business" },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().field as { id: string; slug: string };
    };
    const first = await mkField("Audit probe one");
    const second = await mkField("Audit probe two");

    expect((await attach(probe.id, { fieldId: first.id })).statusCode).toBe(201);
    expect((await attach(probe.id, { fieldId: second.id })).statusCode).toBe(201);
    const reordered = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/contract-types/${probe.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: [second.id, first.id] },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const required = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${probe.id}/fields/${first.id}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(required.statusCode, required.body).toBe(200);
    const detached = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${probe.id}/fields/${second.id}`,
      cookies: adminCookies,
    });
    expect(detached.statusCode, detached.body).toBe(204);

    const mine = (await attachmentAuditRows()).filter(
      (entry) => (entry.payload as { typeSlug?: string }).typeSlug === probe.slug,
    );
    const tally = (action: string) =>
      mine.filter((entry) => entry.action === `contract_type_field.${action}`).length;
    expect(tally("attached")).toBe(2);
    expect(tally("reordered")).toBe(1);
    expect(tally("required_changed")).toBe(1);
    expect(tally("detached")).toBe(1);
    expect(mine).toHaveLength(5);
  });
});

describe("the SET-002 role gate on every attachment route", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const nda = await typeBySlug("nda");
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contract-types/${nda.id}/fields`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const nda = await typeBySlug("nda");
    const governingLaw = await fieldIdBySlug("governing_law");
    const attempts = [
      harness.app.inject({ method: "GET", url: `/api/v1/contract-types/${nda.id}`, cookies }),
      harness.app.inject({
        method: "GET",
        url: `/api/v1/contract-types/${nda.id}/fields`,
        cookies,
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-types/${nda.id}/fields`,
        cookies,
        payload: { fieldId: governingLaw },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/contract-types/${nda.id}/fields/${governingLaw}`,
        cookies,
        payload: { isRequired: false },
      }),
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/contract-types/${nda.id}/fields/order`,
        cookies,
        payload: { fieldIds: [governingLaw] },
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/contract-types/${nda.id}/fields/${governingLaw}`,
        cookies,
      }),
    ];
    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.statusCode).toBe(403);
      expect(attempt.headers["content-type"]).toContain("application/problem+json");
    }
  });
});
