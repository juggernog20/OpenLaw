// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request type's form definition (INT-002, #355) at the HTTP seam:
 * the third mount of the attachment machinery — attach, the required
 * flag, reorder, and detach — plus the two things that are this mount's
 * own. **The scope rule reads the type's target**, so the same catalog
 * field is accepted on one request type and refused on another, and the
 * refusal speaks the arm's own line as an RFC 9457 problem. **A target
 * change that would strand attached fields is refused and names them**,
 * and detaching them first lets the same change through.
 *
 * The suite is modeled on `contract-types/attached-fields.test.ts` —
 * the assertions transfer almost verbatim, which is the point of
 * mounting the same machinery. Asserted at the HTTP seam plus direct
 * `activity_log` reads, because the log has no read routes here.
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

interface RequestTypeRow {
  id: string;
  slug: string;
  displayName: string;
  targetModule: "matter" | "contract" | null;
  targetTypeId: string | null;
  formFieldCount: number;
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

const listTypes = async (): Promise<RequestTypeRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types?includeArchived=true",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().requestTypes;
};

const typeBySlug = async (slug: string): Promise<RequestTypeRow> => {
  const row = (await listTypes()).find((candidate) => candidate.slug === slug);
  expect(row, slug).toBeDefined();
  return row!;
};

/** Adds a request type and answers the row, so a test that needs its
 * own type never disturbs a seeded one. */
const addType = async (displayName: string): Promise<RequestTypeRow> => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().requestType;
};

const setTarget = async (typeId: string, body: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${typeId}`,
    cookies: adminCookies,
    payload: body,
  });

const listAttached = async (typeId: string): Promise<AttachedFieldRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/request-types/${typeId}/fields`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachedFields;
};

const attach = async (typeId: string, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/request-types/${typeId}/fields`,
    cookies: adminCookies,
    payload,
  });

const detach = async (typeId: string, fieldId: string) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/request-types/${typeId}/fields/${fieldId}`,
    cookies: adminCookies,
  });

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

/** Defines a catalog field through the Fields pane's own create route. */
const createField = async (
  displayName: string,
  moduleScope: "contract" | "global",
): Promise<string> => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { displayName, moduleScope, fieldType: "text", fieldTag: "business" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().field.id;
};

/** A `matter`-scoped field, which no route can create until M22 opens
 * the scope — planted the way that milestone's migration would. */
const plantScopedField = async (
  slug: string,
  displayName: string,
  moduleScope: "matter" | "entity",
): Promise<string> => {
  const [row] = await harness.db
    .insert(fields)
    .values({ slug, displayName, moduleScope, fieldType: "text", fieldTag: "legal" })
    .returning();
  return row!.id;
};

const attachmentAuditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "request_type_field.attached",
        "request_type_field.detached",
        "request_type_field.reordered",
        "request_type_field.required_changed",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("attach and detach", () => {
  it("attaches a scoped and a global field, in attachment order", async () => {
    const nda = await typeBySlug("nda_request");
    const counterparty = await createField("Counterparty name", "contract");
    const department = await createField("Department", "global");

    const first = await attach(nda.id, { fieldId: counterparty });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().attachedField).toMatchObject({
      fieldId: counterparty,
      slug: "counterparty_name",
      displayName: "Counterparty name",
      fieldType: "text",
      moduleScope: "contract",
      displayOrder: 1,
      isRequired: false,
    });

    const second = await attach(nda.id, { fieldId: department, isRequired: true });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().attachedField).toMatchObject({
      slug: "department",
      moduleScope: "global",
      displayOrder: 2,
      isRequired: true,
    });

    expect((await listAttached(nda.id)).map((row) => row.slug)).toEqual([
      "counterparty_name",
      "department",
    ]);
  });

  it("refuses attaching the same field twice", async () => {
    const nda = await typeBySlug("nda_request");
    const res = await attach(nda.id, { fieldId: await fieldIdBySlug("counterparty_name") });
    expect(res.statusCode).toBe(409);
  });

  it("refuses an archived field — archived means hidden everywhere", async () => {
    const type = await addType("Archived field probe");
    await setTarget(type.id, { targetModule: "contract" });
    const value = await createField("Archive probe value", "contract");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${value}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const res = await attach(type.id, { fieldId: value });
    expect(res.statusCode).toBe(409);
  });

  it("404s an unknown type and an unknown field", async () => {
    const nda = await typeBySlug("nda_request");
    const noType = await attach("019ff281-0000-7000-8000-000000000000", {
      fieldId: await fieldIdBySlug("department"),
    });
    expect(noType.statusCode).toBe(404);
    const noField = await attach(nda.id, { fieldId: "019ff281-0000-7000-8000-000000000000" });
    expect(noField.statusCode).toBe(404);
  });

  it("scopes attachments to their own type", async () => {
    const question = await typeBySlug("legal_question");
    expect(await listAttached(question.id)).toEqual([]);
  });

  it("detaches without touching the catalog definition", async () => {
    const type = await addType("Detach probe");
    await setTarget(type.id, { targetModule: "contract" });
    const value = await createField("Detach probe value", "contract");
    expect((await attach(type.id, { fieldId: value })).statusCode).toBe(201);

    const res = await detach(type.id, value);
    expect(res.statusCode, res.body).toBe(204);
    expect(await listAttached(type.id)).toEqual([]);

    // The catalog definition is untouched — detach is never delete.
    const catalog = await harness.app.inject({
      method: "GET",
      url: "/api/v1/fields",
      cookies: adminCookies,
    });
    expect(catalog.json().fields).toContainEqual(
      expect.objectContaining({ slug: "detach_probe_value", archivedAt: null }),
    );

    expect((await detach(type.id, value)).statusCode).toBe(404);
  });
});

describe("the scope rule, in all three target arms (INT-002)", () => {
  it("takes contract-scoped and global fields when the target is Contract", async () => {
    const type = await addType("Contract arm");
    await setTarget(type.id, { targetModule: "contract" });
    const contractField = await createField("Contract arm value", "contract");
    const globalField = await createField("Contract arm owner", "global");
    const matterField = await plantScopedField(
      "contract_arm_practice",
      "Contract arm practice",
      "matter",
    );

    expect((await attach(type.id, { fieldId: contractField })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: globalField })).statusCode).toBe(201);
    const refused = await attach(type.id, { fieldId: matterField });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.json()).toMatchObject({
      status: 400,
      detail:
        "This request type targets Contract, so its form takes " +
        "contract-scoped and global fields only.",
    });
  });

  it("takes matter-scoped and global fields when the target is Matter", async () => {
    const type = await addType("Matter arm");
    await setTarget(type.id, { targetModule: "matter" });
    // The matter arm is live and empty until M22 opens the scope, so the
    // only field it can be shown is one planted the way M22 will.
    const matterField = await plantScopedField(
      "matter_arm_practice",
      "Matter arm practice",
      "matter",
    );
    const globalField = await createField("Matter arm owner", "global");
    const contractField = await createField("Matter arm value", "contract");

    expect((await attach(type.id, { fieldId: matterField })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: globalField })).statusCode).toBe(201);
    const refused = await attach(type.id, { fieldId: contractField });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toBe(
      "This request type targets Matter, so its form takes " +
        "matter-scoped and global fields only.",
    );
  });

  it("takes global fields only when there is no target", async () => {
    const type = await addType("No-target arm");
    const globalField = await createField("No-target owner", "global");
    const contractField = await createField("No-target value", "contract");

    expect((await attach(type.id, { fieldId: globalField })).statusCode).toBe(201);
    const refused = await attach(type.id, { fieldId: contractField });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toBe(
      "This request type has no target, so its form takes global fields only. " +
        "Point it at Matter or Contract to attach that module's fields.",
    );
    expect((await listAttached(type.id)).map((row) => row.slug)).toEqual(["no_target_owner"]);
  });

  it("reads the row's target on every attach, never a cached rule", async () => {
    const type = await addType("Re-pointed arm");
    const contractField = await createField("Re-point value", "contract");

    const beforeTargeting = await attach(type.id, { fieldId: contractField });
    expect(beforeTargeting.statusCode, beforeTargeting.body).toBe(400);

    expect((await setTarget(type.id, { targetModule: "contract" })).statusCode).toBe(200);
    const whileTargeted = await attach(type.id, { fieldId: contractField });
    expect(whileTargeted.statusCode, whileTargeted.body).toBe(201);
  });

  it("refuses a scope no arm allows, whatever the target", async () => {
    const type = await addType("Entity scope probe");
    await setTarget(type.id, { targetModule: "contract" });
    const entityField = await plantScopedField(
      "entity_probe_office",
      "Entity probe office",
      "entity",
    );
    const res = await attach(type.id, { fieldId: entityField });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("the strand refusal on a target change (INT-002)", () => {
  it("refuses a re-point that would strand attached fields, names them, and lets it through once they are detached", async () => {
    const type = await addType("Strand probe");
    await setTarget(type.id, { targetModule: "contract" });
    const value = await createField("Strand probe value", "contract");
    const owner = await createField("Strand probe owner", "contract");
    const department = await createField("Strand probe department", "global");
    for (const fieldId of [value, owner, department]) {
      expect((await attach(type.id, { fieldId })).statusCode).toBe(201);
    }

    const refused = await setTarget(type.id, { targetModule: "matter" });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.json().detail).toBe(
      "Strand probe value and Strand probe owner do not fit that target. " +
        "Detach them from the form first.",
    );

    // The refusal left the row exactly as it was — target and form both.
    const unchanged = await typeBySlug(type.slug);
    expect(unchanged.targetModule).toBe("contract");
    expect(unchanged.formFieldCount).toBe(3);

    // Detaching them first lets the same change through, and the global
    // field — which fits every arm — stays on the form.
    expect((await detach(type.id, value)).statusCode).toBe(204);
    expect((await detach(type.id, owner)).statusCode).toBe(204);
    const accepted = await setTarget(type.id, { targetModule: "matter" });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().requestType).toMatchObject({
      targetModule: "matter",
      formFieldCount: 1,
    });
    expect((await listAttached(type.id)).map((row) => row.slug)).toEqual([
      "strand_probe_department",
    ]);
  });

  it("names one stranded field in the singular", async () => {
    const type = await addType("Single strand probe");
    await setTarget(type.id, { targetModule: "contract" });
    const value = await createField("Single strand value", "contract");
    expect((await attach(type.id, { fieldId: value })).statusCode).toBe(201);

    const refused = await setTarget(type.id, { targetModule: null });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().detail).toBe(
      "Single strand value does not fit that target. Detach it from the form first.",
    );
  });

  it("lets a target change that strands nothing through", async () => {
    const type = await addType("Global-only strand probe");
    await setTarget(type.id, { targetModule: "contract" });
    const department = await createField("Global-only department", "global");
    expect((await attach(type.id, { fieldId: department })).statusCode).toBe(201);

    // Global fields fit every arm, so nothing is stranded by any move.
    expect((await setTarget(type.id, { targetModule: "matter" })).statusCode).toBe(200);
    expect((await setTarget(type.id, { targetModule: null })).statusCode).toBe(200);
    expect((await listAttached(type.id)).map((row) => row.slug)).toEqual([
      "global_only_department",
    ]);
  });

  it("leaves a target-type change inside one module alone", async () => {
    const type = await addType("Same-module probe");
    await setTarget(type.id, { targetModule: "contract" });
    const value = await createField("Same-module value", "contract");
    expect((await attach(type.id, { fieldId: value })).statusCode).toBe(201);

    const ndaTypeId = (await typeBySlug("nda_request")).targetTypeId;
    expect(ndaTypeId).not.toBeNull();
    const res = await setTarget(type.id, { targetModule: "contract", targetTypeId: ndaTypeId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType.targetTypeId).toBe(ndaTypeId);
    // Narrowing to a type inside the module the field already fits
    // moves no scope, so the form stands exactly as it was. Without
    // this, a strand check that ran on every target write — and
    // detached the field — would still pass the assertions above.
    expect(res.json().requestType.formFieldCount).toBe(1);
    expect((await listAttached(type.id)).map((row) => row.slug)).toEqual(["same_module_value"]);
  });
});

describe("the per-attachment required flag", () => {
  it("toggles and persists per attachment, not per field", async () => {
    const first = await addType("Required probe one");
    const second = await addType("Required probe two");
    const shared = await createField("Required probe shared", "global");
    expect((await attach(first.id, { fieldId: shared })).statusCode).toBe(201);
    expect((await attach(second.id, { fieldId: shared })).statusCode).toBe(201);

    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${first.id}/fields/${shared}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().attachedField.isRequired).toBe(true);

    expect((await listAttached(first.id))[0]!.isRequired).toBe(true);
    expect((await listAttached(second.id))[0]!.isRequired).toBe(false);
  });

  it("404s a field that is not attached to the type", async () => {
    const question = await typeBySlug("legal_question");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${question.id}/fields/${await fieldIdBySlug("department")}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("per-type reordering", () => {
  it("applies a full permutation and persists it", async () => {
    const nda = await typeBySlug("nda_request");
    const before = await listAttached(nda.id);
    expect(before.length).toBeGreaterThan(1);
    const reversed = [...before].reverse().map((row) => row.fieldId);

    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/request-types/${nda.id}/fields/order`,
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
    const nda = await typeBySlug("nda_request");
    const rows = await listAttached(nda.id);
    const res = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/request-types/${nda.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: rows.slice(1).map((row) => row.fieldId) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("the ST12 Form fields column", () => {
  it("counts each type's live attachments, and only its own", async () => {
    const type = await addType("Count probe");
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(0);

    const first = await createField("Count probe one", "global");
    const second = await createField("Count probe two", "global");
    expect((await attach(type.id, { fieldId: first })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: second })).statusCode).toBe(201);
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(2);

    expect((await detach(type.id, second)).statusCode).toBe(204);
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(1);
  });

  it("drops an attachment whose field is archived, as the editor's list does", async () => {
    const type = await addType("Count archive probe");
    const field = await createField("Count archive probe field", "global");
    expect((await attach(type.id, { fieldId: field })).statusCode).toBe(201);
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(1);

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${field}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(0);
    expect(await listAttached(type.id)).toEqual([]);
  });

  it("reads the same number on the single-type route the editor loads", async () => {
    const type = await typeBySlug("nda_request");
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/request-types/${type.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType.formFieldCount).toBe((await listAttached(type.id)).length);
  });
});

describe("the DD-017 activity trail", () => {
  it("records every form mutation in vocabulary, admin-only, with the actor", async () => {
    const entries = await attachmentAuditRows();
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain("request_type_field.attached");
    expect(actions).toContain("request_type_field.detached");
    expect(actions).toContain("request_type_field.required_changed");
    expect(actions).toContain("request_type_field.reordered");

    const attached = entries.find((entry) => entry.action === "request_type_field.attached")!;
    expect(attached.payload).toMatchObject({
      typeSlug: "nda_request",
      fieldSlug: "counterparty_name",
      isRequired: false,
    });
    expect(attached.visibility).toBe("admin_only");
    expect(attached.actorId).not.toBeNull();
  });

  it("writes exactly one entry per mutation — a duplicate write fails the count", async () => {
    const probe = await addType("Form audit count probe");
    const first = await createField("Form audit one", "global");
    const second = await createField("Form audit two", "global");

    expect((await attach(probe.id, { fieldId: first })).statusCode).toBe(201);
    expect((await attach(probe.id, { fieldId: second })).statusCode).toBe(201);
    const reordered = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/request-types/${probe.id}/fields/order`,
      cookies: adminCookies,
      payload: { fieldIds: [second, first] },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const required = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${probe.id}/fields/${first}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(required.statusCode, required.body).toBe(200);
    expect((await detach(probe.id, second)).statusCode).toBe(204);

    const mine = (await attachmentAuditRows()).filter(
      (entry) => (entry.payload as { typeSlug?: string }).typeSlug === probe.slug,
    );
    const tally = (action: string) =>
      mine.filter((entry) => entry.action === `request_type_field.${action}`).length;
    expect(tally("attached")).toBe(2);
    expect(tally("reordered")).toBe(1);
    expect(tally("required_changed")).toBe(1);
    expect(tally("detached")).toBe(1);
    expect(mine).toHaveLength(5);
  });

  it("writes nothing when a target change is refused for stranding", async () => {
    const probe = await addType("Strand audit probe");
    await setTarget(probe.id, { targetModule: "contract" });
    const value = await createField("Strand audit value", "contract");
    expect((await attach(probe.id, { fieldId: value })).statusCode).toBe(201);

    const before = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "request_type.updated"));
    expect((await setTarget(probe.id, { targetModule: null })).statusCode).toBe(409);
    const after = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "request_type.updated"));
    expect(after).toHaveLength(before.length);
  });
});

describe("the SET-002 role gate on every form route", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const nda = await typeBySlug("nda_request");
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/request-types/${nda.id}/fields`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const nda = await typeBySlug("nda_request");
    const department = await fieldIdBySlug("department");
    const attempts = [
      harness.app.inject({
        method: "GET",
        url: `/api/v1/request-types/${nda.id}/fields`,
        cookies,
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${nda.id}/fields`,
        cookies,
        payload: { fieldId: department },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/request-types/${nda.id}/fields/${department}`,
        cookies,
        payload: { isRequired: false },
      }),
      harness.app.inject({
        method: "PUT",
        url: `/api/v1/request-types/${nda.id}/fields/order`,
        cookies,
        payload: { fieldIds: [department] },
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/request-types/${nda.id}/fields/${department}`,
        cookies,
      }),
    ];
    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.statusCode).toBe(403);
      expect(attempt.headers["content-type"]).toContain("application/problem+json");
    }
  });
});
