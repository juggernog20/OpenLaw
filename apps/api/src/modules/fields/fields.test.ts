// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Fields catalog (#83): the shared CTR-016 custom-field catalog
 * behind the third list-editor pane — create across all nine field
 * types, rename and describe, the options list on select types, the
 * contract-scope-only AI prompt, promotion to global, narrowing back
 * while nothing cross-module attaches, archive and restore with stored
 * values retained by rule (MTR-014). Slug and field type are immutable
 * after creation, refused loudly rather than silently stripped. Behind
 * SET-002's one role gate, every mutation appending to the activity log
 * (DD-017). Asserted at the HTTP seam plus direct activity_log reads —
 * the log has no read routes until M9.
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

interface FieldRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  moduleScope: string;
  fieldType: string;
  options: string[] | null;
  fieldTag: string;
  aiPrompt: string | null;
  archivedAt: string | null;
  inUseCount: number;
}

const listFields = async (includeArchived = false): Promise<FieldRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/fields${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { fields: FieldRow[] }).fields;
};

const createField = async (body: Record<string, unknown>) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: body,
  });

const createdField = async (body: Record<string, unknown>): Promise<FieldRow> => {
  const res = await createField(body);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { field: FieldRow }).field;
};

/** The latest activity entries, oldest first, for the given actions. */
const activityEntries = async (actions: string[]) =>
  harness.db
    .select()
    .from(activityLog)
    .where(inArray(activityLog.action, actions))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

describe("the SET-002 gate", () => {
  it("refuses anonymous and non-Administrator access on every route", async () => {
    const memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    // Valid-shaped bodies, so the refusal under test is the role gate's —
    // never a schema 400 answering before authentication runs.
    const routes = [
      { method: "GET", url: "/api/v1/fields" },
      {
        method: "POST",
        url: "/api/v1/fields",
        payload: {
          displayName: "Sneaky",
          moduleScope: "contract",
          fieldType: "text",
          fieldTag: "legal",
        },
      },
      { method: "PATCH", url: "/api/v1/fields/some-id", payload: { displayName: "Sneaky" } },
      { method: "PUT", url: "/api/v1/fields/some-id/scope", payload: { moduleScope: "global" } },
      { method: "POST", url: "/api/v1/fields/some-id/archive" },
      { method: "POST", url: "/api/v1/fields/some-id/restore" },
    ] as const;
    for (const route of routes) {
      const anonymous = await harness.app.inject({
        method: route.method,
        url: route.url,
        payload: "payload" in route ? route.payload : undefined,
      });
      expect(anonymous.statusCode, `${route.method} ${route.url} anonymous`).toBe(401);
      const member = await harness.app.inject({
        method: route.method,
        url: route.url,
        cookies: memberCookies,
        payload: "payload" in route ? route.payload : undefined,
      });
      expect(member.statusCode, `${route.method} ${route.url} member`).toBe(403);
    }
  });
});

describe("the seeded catalog (CTR-008 core fields)", () => {
  it("lists the three contract core fields, each carrying a default prompt", async () => {
    const rows = await listFields();
    const seeds = rows.filter((row) => row.inUseCount === 0).map((row) => row.slug);
    expect(seeds).toEqual(["governing_law", "jurisdiction", "our_position"]);

    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    for (const slug of ["governing_law", "jurisdiction", "our_position"]) {
      const seed = bySlug.get(slug)!;
      expect(seed.moduleScope, slug).toBe("contract");
      expect(seed.aiPrompt, slug).toBeTruthy();
      expect(seed.archivedAt, slug).toBeNull();
    }
    expect(bySlug.get("governing_law")!.fieldType).toBe("text");
    expect(bySlug.get("governing_law")!.fieldTag).toBe("legal");
    expect(bySlug.get("jurisdiction")!.fieldType).toBe("text");
    expect(bySlug.get("our_position")!.fieldType).toBe("single_select");
    expect(bySlug.get("our_position")!.options).toEqual(["Customer", "Provider", "Other"]);
  });
});

describe("creating fields (the nine-type, scope, and options matrix)", () => {
  it("creates a field of every non-select type without options", async () => {
    const plainTypes = ["text", "long_text", "number", "date", "boolean", "user", "entity"];
    for (const fieldType of plainTypes) {
      const row = await createdField({
        displayName: `Plain ${fieldType}`,
        moduleScope: "contract",
        fieldType,
        fieldTag: "business",
      });
      expect(row.fieldType, fieldType).toBe(fieldType);
      expect(row.slug, fieldType).toBe(`plain_${fieldType}`);
      expect(row.options, fieldType).toBeNull();
      expect(row.description, fieldType).toBeNull();
      expect(row.aiPrompt, fieldType).toBeNull();
      expect(row.archivedAt, fieldType).toBeNull();
    }
  });

  it("creates select fields with their options list, in order", async () => {
    for (const fieldType of ["single_select", "multi_select"]) {
      const row = await createdField({
        displayName: `Choice ${fieldType}`,
        moduleScope: "global",
        fieldType,
        fieldTag: "business",
        options: ["Beta", "Alpha", "Gamma"],
      });
      expect(row.options, fieldType).toEqual(["Beta", "Alpha", "Gamma"]);
    }
  });

  it("refuses a select field without options, and non-select options", async () => {
    const optionless = await createField({
      displayName: "No options",
      moduleScope: "contract",
      fieldType: "single_select",
      fieldTag: "legal",
    });
    expect(optionless.statusCode, optionless.body).toBe(400);

    const optioned = await createField({
      displayName: "Texty options",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "legal",
      options: ["A"],
    });
    expect(optioned.statusCode, optioned.body).toBe(400);

    const duplicated = await createField({
      displayName: "Dupes",
      moduleScope: "contract",
      fieldType: "single_select",
      fieldTag: "legal",
      options: ["A", "A"],
    });
    expect(duplicated.statusCode, duplicated.body).toBe(400);
  });

  it("offers contract, matter, and global scopes — entity waits", async () => {
    const matter = await createField({
      displayName: "Matter field",
      moduleScope: "matter",
      fieldType: "text",
      fieldTag: "business",
    });
    expect(matter.statusCode, matter.body).toBe(201);
    for (const moduleScope of ["entity", "nonsense"]) {
      const res = await createField({
        displayName: "Too early",
        moduleScope,
        fieldType: "text",
        fieldTag: "business",
      });
      expect(res.statusCode, moduleScope).toBe(400);
    }
  });

  it("takes an AI prompt on contract-scoped fields only (CTR-008)", async () => {
    const prompted = await createdField({
      displayName: "Prompted",
      description: "Extracted by analysis.",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "legal",
      aiPrompt: "Extract the thing.",
    });
    expect(prompted.aiPrompt).toBe("Extract the thing.");
    expect(prompted.description).toBe("Extracted by analysis.");

    const globalPrompted = await createField({
      displayName: "Global prompted",
      moduleScope: "global",
      fieldType: "text",
      fieldTag: "legal",
      aiPrompt: "Extract the thing.",
    });
    expect(globalPrompted.statusCode, globalPrompted.body).toBe(400);
  });

  it("derives unique immutable slugs, suffixing collisions", async () => {
    const first = await createdField({
      displayName: "Renewal – Term!",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    expect(first.slug).toBe("renewal_term");
    const second = await createdField({
      displayName: "Renewal term",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    expect(second.slug).toBe("renewal_term_2");
  });

  it("writes a field.created activity row for the acting Administrator", async () => {
    await createdField({
      displayName: "Audited create",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "legal",
    });
    const entries = await activityEntries(["field.created"]);
    const last = entries.at(-1)!;
    expect(last.payload).toMatchObject({ slug: "audited_create", moduleScope: "contract" });
    expect(last.actorId).toBeTruthy();
    expect(last.visibility).toBe("admin_only");
  });
});

describe("editing fields (rename and describe freely; type and slug never)", () => {
  const patchField = async (id: string, body: Record<string, unknown>) =>
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/fields/${id}`,
      cookies: adminCookies,
      payload: body,
    });

  it("renames, describes, retags, and edits the prompt in one strict body", async () => {
    const row = await createdField({
      displayName: "Editable",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    const res = await patchField(row.id, {
      displayName: "Edited",
      description: "Now described.",
      fieldTag: "legal",
      aiPrompt: "Extract the edited thing.",
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = (res.json() as { field: FieldRow }).field;
    expect(updated.displayName).toBe("Edited");
    expect(updated.description).toBe("Now described.");
    expect(updated.fieldTag).toBe("legal");
    expect(updated.aiPrompt).toBe("Extract the edited thing.");
    expect(updated.slug).toBe("editable");

    const entries = await activityEntries(["field.updated"]);
    expect(entries.at(-1)!.payload).toMatchObject({
      slug: "editable",
      changed: {
        displayName: { from: "Editable", to: "Edited" },
        fieldTag: { from: "business", to: "legal" },
      },
    });

    // Clearing rides the same seam: null empties description and prompt.
    const cleared = await patchField(row.id, { description: null, aiPrompt: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((cleared.json() as { field: FieldRow }).field.description).toBeNull();
    expect((cleared.json() as { field: FieldRow }).field.aiPrompt).toBeNull();
  });

  it("refuses a body carrying fieldType, slug, or moduleScope outright", async () => {
    const row = await createdField({
      displayName: "Immutable core",
      moduleScope: "contract",
      fieldType: "date",
      fieldTag: "legal",
    });
    for (const body of [
      { fieldType: "text" },
      { slug: "renamed_slug" },
      { moduleScope: "global" },
    ]) {
      const res = await patchField(row.id, { displayName: "Still fine", ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    // Nothing partial landed.
    const rows = await listFields();
    const kept = rows.find((candidate) => candidate.id === row.id)!;
    expect(kept.displayName).toBe("Immutable core");
    expect(kept.fieldType).toBe("date");
  });

  it("keeps options on select types and off the rest", async () => {
    const select = await createdField({
      displayName: "Editable select",
      moduleScope: "contract",
      fieldType: "single_select",
      fieldTag: "business",
      options: ["One"],
    });
    const reoptioned = await patchField(select.id, { options: ["One", "Two"] });
    expect(reoptioned.statusCode, reoptioned.body).toBe(200);
    expect((reoptioned.json() as { field: FieldRow }).field.options).toEqual(["One", "Two"]);

    const plain = await createdField({
      displayName: "Optionless",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    const refused = await patchField(plain.id, { options: ["One"] });
    expect(refused.statusCode, refused.body).toBe(400);
  });

  it("refuses a prompt on a global field, even by edit", async () => {
    const row = await createdField({
      displayName: "Global no prompt",
      moduleScope: "global",
      fieldType: "text",
      fieldTag: "business",
    });
    const res = await patchField(row.id, { aiPrompt: "Sneaky." });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("scope moves (CTR-016: promote freely, narrow only while unattached)", () => {
  const setScope = async (id: string, moduleScope: string) =>
    harness.app.inject({
      method: "PUT",
      url: `/api/v1/fields/${id}/scope`,
      cookies: adminCookies,
      payload: { moduleScope },
    });

  it("promotes a contract field to global, keeping its prompt", async () => {
    const row = await createdField({
      displayName: "Promotable",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
      aiPrompt: "Extract before promotion.",
    });
    const res = await setScope(row.id, "global");
    expect(res.statusCode, res.body).toBe(200);
    const promoted = (res.json() as { field: FieldRow }).field;
    expect(promoted.moduleScope).toBe("global");
    // Promotion is safe for values (keyed by slug) and keeps the prompt.
    expect(promoted.aiPrompt).toBe("Extract before promotion.");

    const entries = await activityEntries(["field.promoted"]);
    expect(entries.at(-1)!.payload).toMatchObject({ slug: "promotable", from: "contract" });
  });

  it("narrows a global field back while no other module attaches it", async () => {
    const row = await createdField({
      displayName: "Narrowable",
      moduleScope: "global",
      fieldType: "text",
      fieldTag: "business",
    });
    const res = await setScope(row.id, "contract");
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { field: FieldRow }).field.moduleScope).toBe("contract");

    const entries = await activityEntries(["field.narrowed"]);
    expect(entries.at(-1)!.payload).toMatchObject({ slug: "narrowable", to: "contract" });
  });

  it("treats a same-scope move as a no-op with no audit entry", async () => {
    const row = await createdField({
      displayName: "Stay put",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    const before = (await activityEntries(["field.promoted", "field.narrowed"])).length;
    const res = await setScope(row.id, "contract");
    expect(res.statusCode, res.body).toBe(200);
    expect((await activityEntries(["field.promoted", "field.narrowed"])).length).toBe(before);
  });
});

describe("archive and restore (values retained by rule — MTR-014)", () => {
  const archiveField = async (id: string) =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${id}/archive`,
      cookies: adminCookies,
    });

  it("archives out of the default list, retains the definition, restores", async () => {
    const row = await createdField({
      displayName: "Archivable",
      moduleScope: "contract",
      fieldType: "single_select",
      fieldTag: "legal",
      options: ["Keep me"],
      aiPrompt: "Keep this prompt too.",
    });
    const archived = await archiveField(row.id);
    expect(archived.statusCode, archived.body).toBe(200);
    expect((archived.json() as { field: FieldRow }).field.archivedAt).toBeTruthy();

    expect((await listFields()).some((candidate) => candidate.id === row.id)).toBe(false);
    const kept = (await listFields(true)).find((candidate) => candidate.id === row.id)!;
    // Archive hides the field; the definition survives intact.
    expect(kept.options).toEqual(["Keep me"]);
    expect(kept.aiPrompt).toBe("Keep this prompt too.");

    const again = await archiveField(row.id);
    expect(again.statusCode, again.body).toBe(409);

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${row.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect((restored.json() as { field: FieldRow }).field.archivedAt).toBeNull();

    const actions = await activityEntries(["field.archived", "field.restored"]);
    expect(actions.at(-2)!.action).toBe("field.archived");
    expect(actions.at(-1)!.action).toBe("field.restored");
  });

  it("refuses to restore a live field", async () => {
    const row = await createdField({
      displayName: "Already live",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${row.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("has no hard delete — the route does not exist", async () => {
    const row = await createdField({
      displayName: "Undeletable",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    });
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/fields/${row.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the armed attachment seams (#84)", () => {
  /** A live contract type's id, via the types route. */
  const typeIdBySlug = async (slug: string): Promise<string> => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json().contractTypes as { id: string; slug: string }[]).find(
      (candidate) => candidate.slug === slug,
    );
    expect(row, slug).toBeDefined();
    return row!.id;
  };

  const attachTo = async (typeId: string, fieldId: string) => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${typeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId },
    });
    expect(res.statusCode, res.body).toBe(201);
  };

  it("counts type attachments as usage, per field", async () => {
    const row = await createdField({
      displayName: "Attachment counted",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "legal",
    });
    expect(row.inUseCount).toBe(0);

    const nda = await typeIdBySlug("nda");
    const msa = await typeIdBySlug("msa");
    await attachTo(nda, row.id);
    await attachTo(msa, row.id);

    const counted = (await listFields()).find((candidate) => candidate.id === row.id);
    expect(counted!.inUseCount).toBe(2);

    const detach = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${msa}/fields/${row.id}`,
      cookies: adminCookies,
    });
    expect(detach.statusCode, detach.body).toBe(204);
    const recounted = (await listFields()).find((candidate) => candidate.id === row.id);
    expect(recounted!.inUseCount).toBe(1);
  });

  it("records the real usage count when an attached field is archived", async () => {
    const row = await createdField({
      displayName: "Archived while attached",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "legal",
    });
    await attachTo(await typeIdBySlug("nda"), row.id);

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${row.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const entries = await activityEntries(["field.archived"]);
    expect(entries.at(-1)!.payload).toMatchObject({
      slug: "archived_while_attached",
      inUseCount: 1,
    });
  });

  it("still narrows global → contract while contract types attach the field — the guard counts other modules only", async () => {
    const row = await createdField({
      displayName: "Narrow while attached",
      moduleScope: "global",
      fieldType: "text",
      fieldTag: "legal",
    });
    await attachTo(await typeIdBySlug("nda"), row.id);

    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/fields/${row.id}/scope`,
      cookies: adminCookies,
      payload: { moduleScope: "contract" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().field.moduleScope).toBe("contract");
  });
});
