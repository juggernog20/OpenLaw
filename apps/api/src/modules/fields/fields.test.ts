// SPDX-License-Identifier: AGPL-3.0-only

import { removeFieldRow } from "../../testing/form-fixtures.js";
import { saveFieldRow } from "../../testing/form-fixtures.js";

/**
 * The Fields catalog (#83): the shared CTR-016 custom-field catalog
 * behind the third list-editor pane — create across all nine field
 * types, rename and describe, the options list on select types, the
 * contract-scope-only AI prompt, fixed module scope
 * while nothing cross-module attaches, archive and restore with stored
 * values retained by rule (MTR-014). Slug and field type are immutable
 * after creation, refused loudly rather than silently stripped. Behind
 * SET-002's one role gate, every mutation appending to the activity log
 * (DD-017). Asserted at the HTTP seam plus direct activity_log reads —
 * the log has no read routes until M9.
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

interface FieldRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  moduleScope: string;
  fieldType: string;
  options: string[] | null;
  aiPrompt: string | null;
  aiAnswerStyle: string | null;
  isSystemDefault: boolean;
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
  expect(res.headers["content-type"]).toContain("application/json");
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
  expect(res.headers["content-type"]).toContain("application/json");
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
        },
      },
      { method: "PATCH", url: "/api/v1/fields/some-id", payload: { displayName: "Sneaky" } },
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
      // The SET-004 default Field flag, set by migration 0148.
      expect(seed.isSystemDefault, slug).toBe(true);
    }
    expect(bySlug.get("governing_law")!.fieldType).toBe("text");
    expect(bySlug.get("jurisdiction")!.fieldType).toBe("text");
    expect(bySlug.get("our_position")!.fieldType).toBe("single_select");
    expect(bySlug.get("our_position")!.options).toEqual(["Customer", "Provider", "Other"]);
  });

  it("refuses to archive a default Field (SET-004: the Fields panes lock it)", async () => {
    const seed = (await listFields()).find((row) => row.slug === "governing_law")!;
    const refused = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${seed.id}/archive`,
      cookies: adminCookies,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().detail).toBe(
      "The Governing law field is a default Field and can't be archived.",
    );
    expect((await listFields()).find((row) => row.slug === "governing_law")!.archivedAt).toBeNull();
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
        moduleScope: "matter",
        fieldType,

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
    });
    expect(optionless.statusCode, optionless.body).toBe(400);

    const optioned = await createField({
      displayName: "Texty options",
      moduleScope: "contract",
      fieldType: "text",

      options: ["A"],
    });
    expect(optioned.statusCode, optioned.body).toBe(400);

    const duplicated = await createField({
      displayName: "Dupes",
      moduleScope: "contract",
      fieldType: "single_select",

      options: ["A", "A"],
    });
    expect(duplicated.statusCode, duplicated.body).toBe(400);
  });

  it("offers only contract, matter and entity scopes", async () => {
    for (const moduleScope of ["matter", "entity"]) {
      const res = await createField({
        displayName: `${moduleScope} field`,
        moduleScope,
        fieldType: "text",
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const unknown = await createField({
      displayName: "Unknown scope",
      moduleScope: "nonsense",
      fieldType: "text",
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
  });

  it("takes an AI prompt on contract-scoped fields only (CTR-008)", async () => {
    const prompted = await createdField({
      displayName: "Prompted",
      description: "Extracted by analysis.",
      moduleScope: "contract",
      fieldType: "text",

      aiPrompt: "Extract the thing.",
    });
    expect(prompted.aiPrompt).toBe("Extract the thing.");
    expect(prompted.description).toBe("Extracted by analysis.");

    const matterPrompted = await createField({
      displayName: "Matter prompted",
      moduleScope: "matter",
      fieldType: "text",

      aiPrompt: "Extract the thing.",
    });
    expect(matterPrompted.statusCode, matterPrompted.body).toBe(400);
  });

  it.each(["user", "entity"])("refuses AI prompts when creating a %s Field", async (fieldType) => {
    for (const aiPrompt of ["Extract the named party.", "", "   "]) {
      const response = await createField({
        displayName: "Reference prompt",
        moduleScope: "contract",
        fieldType,

        aiPrompt,
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json().detail).toBe(`Fields of type ${fieldType} cannot be analysed.`);
    }
  });

  it("derives unique immutable slugs, suffixing collisions", async () => {
    const first = await createdField({
      displayName: "Renewal – Term!",
      moduleScope: "contract",
      fieldType: "text",
    });
    expect(first.slug).toBe("renewal_term");
    const second = await createdField({
      displayName: "Renewal term",
      moduleScope: "contract",
      fieldType: "text",
    });
    expect(second.slug).toBe("renewal_term_2");

    const coreCollision = await createdField({
      displayName: "Value",
      moduleScope: "contract",
      fieldType: "text",
    });
    expect(coreCollision.slug).toBe("value_2");
  });

  it("writes a field.created activity row for the acting Administrator", async () => {
    await createdField({
      displayName: "Audited create",
      moduleScope: "contract",
      fieldType: "text",
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

  it.each(["user", "entity"])(
    "refuses AI prompts when patching a legacy %s Field",
    async (fieldType) => {
      const row = await createdField({
        displayName: `Legacy ${fieldType}`,
        moduleScope: "contract",
        fieldType,
      });
      await harness.db
        .update(fields)
        .set({ aiPrompt: "Old saved prompt." })
        .where(eq(fields.id, row.id));
      for (const aiPrompt of ["Extract the named party.", "", "   ", null]) {
        const response = await patchField(row.id, { displayName: "Should not change", aiPrompt });
        expect(response.statusCode, response.body).toBe(422);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.json().detail).toBe(`Fields of type ${fieldType} cannot be analysed.`);
      }
      const unchanged = (await listFields()).find((field) => field.id === row.id)!;
      expect(unchanged.displayName).toBe(row.displayName);
      expect(unchanged.aiPrompt).toBe("Old saved prompt.");
      const renamed = await patchField(row.id, { displayName: "Renamed reference" });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json().field.aiPrompt).toBe("Old saved prompt.");
    },
  );

  it("renames, describes, retags, and edits the prompt in one strict body", async () => {
    const row = await createdField({
      displayName: "Editable",
      moduleScope: "contract",
      fieldType: "text",
    });
    const res = await patchField(row.id, {
      displayName: "Edited",
      description: "Now described.",

      aiPrompt: "Extract the edited thing.",
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = (res.json() as { field: FieldRow }).field;
    expect(updated.displayName).toBe("Edited");
    expect(updated.description).toBe("Now described.");
    expect(updated.aiPrompt).toBe("Extract the edited thing.");
    expect(updated.slug).toBe("editable");

    const entries = await activityEntries(["field.updated"]);
    expect(entries.at(-1)!.payload).toMatchObject({
      slug: "editable",
      changed: {
        displayName: { from: "Editable", to: "Edited" },
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
    });
    for (const body of [
      { fieldType: "text" },
      { slug: "renamed_slug" },
      { moduleScope: "matter" },
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

      options: ["One"],
    });
    const reoptioned = await patchField(select.id, { options: ["One", "Two"] });
    expect(reoptioned.statusCode, reoptioned.body).toBe(200);
    expect((reoptioned.json() as { field: FieldRow }).field.options).toEqual(["One", "Two"]);

    const plain = await createdField({
      displayName: "Optionless",
      moduleScope: "contract",
      fieldType: "text",
    });
    const refused = await patchField(plain.id, { options: ["One"] });
    expect(refused.statusCode, refused.body).toBe(400);
  });

  it("refuses a prompt on a matter field, even by edit", async () => {
    const row = await createdField({
      displayName: "Matter no prompt",
      moduleScope: "matter",
      fieldType: "text",
    });
    const res = await patchField(row.id, { aiPrompt: "Sneaky." });
    expect(res.statusCode, res.body).toBe(400);
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
    const res = await saveFieldRow(harness, {
      typeUrl: `/api/v1/contract-types/${typeId}`,
      cookies: adminCookies,
      payload: { fieldId },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  it("counts type attachments as usage, per field", async () => {
    const row = await createdField({
      displayName: "Attachment counted",
      moduleScope: "contract",
      fieldType: "text",
    });
    expect(row.inUseCount).toBe(0);

    const nda = await typeIdBySlug("nda");
    const msa = await typeIdBySlug("msa");
    await attachTo(nda, row.id);
    await attachTo(msa, row.id);

    const counted = (await listFields()).find((candidate) => candidate.id === row.id);
    expect(counted!.inUseCount).toBe(2);

    const detach = await removeFieldRow(harness, {
      typeUrl: `/api/v1/contract-types/${msa}`,
      fieldId: `${row.id}`,
      cookies: adminCookies,
    });
    expect(detach.statusCode, detach.body).toBe(200);
    const recounted = (await listFields()).find((candidate) => candidate.id === row.id);
    expect(recounted!.inUseCount).toBe(1);
  });

  it("records the real usage count when an attached field is archived", async () => {
    const row = await createdField({
      displayName: "Archived while attached",
      moduleScope: "contract",
      fieldType: "text",
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
});

it("rejects the removed scope and refuses changing a field's module", async () => {
  const invalid = await createField({
    displayName: "Removed scope",
    moduleScope: "global",
    fieldType: "text",
  });
  expect(invalid.statusCode).toBe(400);
  const row = await createdField({
    displayName: "Fixed area",
    moduleScope: "contract",
    fieldType: "text",
  });
  const patched = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/fields/${row.id}`,
    cookies: adminCookies,
    payload: { moduleScope: "matter" },
  });
  expect(patched.statusCode).toBe(400);
  const moved = await harness.app.inject({
    method: "PUT",
    url: `/api/v1/fields/${row.id}/scope`,
    cookies: adminCookies,
    payload: { moduleScope: "matter" },
  });
  expect(moved.statusCode).toBe(404);
});

describe("per-Field answer style", () => {
  it("creates, lists, changes, and clears an override without changing it on unrelated edits", async () => {
    const field = await createdField({
      displayName: "Style override",
      moduleScope: "contract",
      fieldType: "long_text",

      aiAnswerStyle: "full_clause",
    });
    expect(field.aiAnswerStyle).toBe("full_clause");
    expect((await listFields()).find((row) => row.id === field.id)?.aiAnswerStyle).toBe(
      "full_clause",
    );
    for (const [patch, expected] of [
      [{ description: "Other edit" }, "full_clause"],
      [{ aiAnswerStyle: "few_words" }, "few_words"],
      [{ aiAnswerStyle: "sentence" }, "sentence"],
      [{ aiAnswerStyle: null }, null],
    ] as const) {
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/fields/${field.id}`,
        cookies: adminCookies,
        payload: patch,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json().field.aiAnswerStyle).toBe(expected);
    }
    expect(
      (
        await createdField({
          displayName: "Default style",
          moduleScope: "contract",
          fieldType: "text",
        })
      ).aiAnswerStyle,
    ).toBeNull();
  });

  it.each([
    ["contract", "text", "full_clause", "Full clause text needs a long text Field."],
    ...[
      "number",
      "currency",
      "date",
      "boolean",
      "single_select",
      "multi_select",
      "user",
      "entity",
    ].map((type) => [
      "contract",
      type,
      "sentence",
      "Answer style needs a text or long text Field.",
    ]),
    ["matter", "long_text", "sentence", "Answer style needs a contract-scope Field."],
    ["entity", "text", "few_words", "Answer style needs a contract-scope Field."],
  ])(
    "refuses %s %s style %s on create and patch",
    async (moduleScope, fieldType, aiAnswerStyle, detail) => {
      const body = {
        displayName: `Invalid style ${moduleScope} ${fieldType}`,
        moduleScope,
        fieldType,

        ...(["single_select", "multi_select"].includes(fieldType!) ? { options: ["One"] } : {}),
      };
      const created = await createField({ ...body, aiAnswerStyle });
      expect(created.statusCode, created.body).toBe(422);
      expect(created.headers["content-type"]).toContain("application/problem+json");
      expect(created.json()).toMatchObject({ status: 422, detail });
      const field = await createdField(body);
      const patched = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/fields/${field.id}`,
        cookies: adminCookies,
        payload: { aiAnswerStyle },
      });
      expect(patched.statusCode, patched.body).toBe(422);
      expect(patched.headers["content-type"]).toContain("application/problem+json");
      expect(patched.json()).toMatchObject({ status: 422, detail });
    },
  );
});

it("retires the intake catalog query and lists only catalog Fields", async () => {
  const retired = await harness.app.inject({
    method: "GET",
    url: "/api/v1/fields?intake=true",
    cookies: adminCookies,
  });
  expect(retired.statusCode).toBe(400);
  const fields = await listFields();
  expect(fields.some((field) => field.slug.startsWith("__intake_"))).toBe(false);
  expect(fields.every((field) => !("fieldTag" in field) && !("builtInKey" in field))).toBe(true);
});

it("refuses the retired Field tag on edit", async () => {
  const [field] = await listFields();
  const response = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/fields/${field!.id}`,
    cookies: adminCookies,
    payload: { fieldTag: "legal" },
  });
  expect(response.statusCode, response.body).toBe(400);
});
