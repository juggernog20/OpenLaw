// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request type's form definition (INT-002, #355) at the HTTP seam:
 * the third mount of the attachment machinery — attach, the required
 * flag, reorder, and detach — plus the two things that are this mount's
 * own. **The scope rule reads the type's target**, so the same catalog
 * field is accepted on one request type and refused on another, and the
 * refusal speaks the arm's own line as an RFC 9457 problem. **A target
 * change that would strand attached fields is refused and names them**,
 * and detaching them first lets the same change through. **A `user` or
 * `entity` field may be on the form and may never be required on one**
 * (#400), on both doors, and only on this mount.
 *
 * The suite is modeled on `contract-types/attached-fields.test.ts` —
 * the assertions transfer almost verbatim, which is the point of
 * mounting the same machinery. Asserted at the HTTP seam plus direct
 * `activity_log` reads, because the log has no read routes here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  eq,
  fields,
  inArray,
  requestTypeFields,
  users,
  contractTypes,
  sql,
} from "@openlaw/db";
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
  const type = res.json().requestType;
  const targeted = await setTarget(type.id, { targetModule: "contract" });
  expect(targeted.statusCode, targeted.body).toBe(200);
  return targeted.json().requestType;
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

const attach = async (typeId: string, payload: Record<string, unknown>) => {
  if (payload.alsoAttachToTarget && !("expectedTarget" in payload)) {
    const type = (await listTypes()).find((row) => row.id === typeId)!;
    payload = {
      ...payload,
      expectedTarget: { module: type.targetModule ?? "contract", typeId: type.targetTypeId ?? "" },
    };
  }
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/request-types/${typeId}/fields`,
    cookies: adminCookies,
    payload,
  });
};

const detach = async (typeId: string, fieldId: string) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/request-types/${typeId}/fields/${fieldId}`,
    cookies: adminCookies,
  });

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

const createField = async (
  displayName: string,
  moduleScope: "contract" | "matter",
  fieldType = "text",
): Promise<string> => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { displayName, moduleScope, fieldType, fieldTag: "business" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().field.id;
};

const setRequired = async (typeId: string, fieldId: string, isRequired: boolean) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${typeId}/fields/${fieldId}`,
    cookies: adminCookies,
    payload: { isRequired },
  });

/** A non-Contract scoped field planted directly to isolate this suite
 * from the catalog route that M22 opened for Matter. */
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
  it("attaches a scoped and a contract field, in attachment order", async () => {
    const nda = await typeBySlug("nda_request");
    const counterparty = await createField("Counterparty name", "contract");
    const department = await createField("Department", "contract");

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
      moduleScope: "contract",
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

describe("the scope rule, in both destination modules (INT-002)", () => {
  it("takes contract-scoped fields when the target is Contract", async () => {
    const type = await addType("Contract arm");
    await setTarget(type.id, { targetModule: "contract" });
    const contractField = await createField("Contract arm value", "contract");
    const secondField = await createField("Contract arm owner", "contract");
    const matterField = await plantScopedField(
      "contract_arm_practice",
      "Contract arm practice",
      "matter",
    );

    expect((await attach(type.id, { fieldId: contractField })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: secondField })).statusCode).toBe(201);
    const refused = await attach(type.id, { fieldId: matterField });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.json()).toMatchObject({
      status: 400,
      detail:
        "This request type targets Contract, so its form takes " + "contract-scoped fields only.",
    });
  });

  it("takes matter-scoped fields when the target is Matter", async () => {
    const type = await addType("Matter arm");
    await setTarget(type.id, { targetModule: "matter" });
    // The Matter arm admits Matter and contract fields after M22.
    const matterField = await plantScopedField(
      "matter_arm_practice",
      "Matter arm practice",
      "matter",
    );
    const secondField = await createField("Matter arm owner", "matter");
    const contractField = await createField("Matter arm value", "contract");

    expect((await attach(type.id, { fieldId: matterField })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: secondField })).statusCode).toBe(201);
    const refused = await attach(type.id, { fieldId: contractField });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toBe(
      "This request type targets Matter, so its form takes " + "matter-scoped fields only.",
    );
  });

  it("requires the destination module before attaching Fields", async () => {
    const type = await addType("Destination scope");
    const contractField = await createField("Destination value", "contract");
    const matterField = await plantScopedField(
      "destination_practice",
      "Destination practice",
      "matter",
    );
    expect((await attach(type.id, { fieldId: contractField })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: matterField })).statusCode).toBe(400);
    const refused = await setTarget(type.id, { targetModule: "matter" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toContain("Destination value");
    expect((await typeBySlug(type.slug)).targetModule).toBe("contract");
  });

  it("reads the row's target on every attach, never a cached rule", async () => {
    const type = await addType("Re-pointed arm");
    const contractField = await createField("Re-point value", "contract");

    await setTarget(type.id, { targetModule: "matter" });
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
    const department = await createField("Strand probe department", "contract");
    for (const fieldId of [value, owner, department]) {
      expect((await attach(type.id, { fieldId })).statusCode).toBe(201);
    }

    const refused = await setTarget(type.id, { targetModule: "matter" });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.json().detail).toBe(
      "Strand probe value, Strand probe owner, and Strand probe department do not fit that target. " +
        "Detach them from the form first.",
    );

    // The refusal left the row exactly as it was — target and form both.
    const unchanged = await typeBySlug(type.slug);
    expect(unchanged.targetModule).toBe("contract");
    expect(unchanged.formFieldCount).toBe(3);

    // Every Contract field must be detached before switching to Matter.
    expect((await detach(type.id, value)).statusCode).toBe(204);
    expect((await detach(type.id, owner)).statusCode).toBe(204);
    expect((await detach(type.id, department)).statusCode).toBe(204);
    const accepted = await setTarget(type.id, { targetModule: "matter" });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().requestType).toMatchObject({
      targetModule: "matter",
      formFieldCount: 0,
    });
    expect(await listAttached(type.id)).toEqual([]);
  });

  it("names one stranded field in the singular", async () => {
    const type = await addType("Single strand probe");
    await setTarget(type.id, { targetModule: "contract" });
    const value = await createField("Single strand value", "contract");
    expect((await attach(type.id, { fieldId: value })).statusCode).toBe(201);

    const refused = await setTarget(type.id, { targetModule: "matter" });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().detail).toBe(
      "Single strand value does not fit that target. Detach it from the form first.",
    );
  });

  it("lets an empty form change its destination", async () => {
    const type = await addType("Empty form destination");
    expect((await setTarget(type.id, { targetModule: "contract" })).statusCode).toBe(200);
    expect((await setTarget(type.id, { targetModule: "matter" })).statusCode).toBe(200);
    expect((await setTarget(type.id, { targetModule: null })).statusCode).toBe(400);
  });

  it("refuses to clear the destination and retains module-specific fields", async () => {
    const type = await addType("Clear destination probe");
    await setTarget(type.id, { targetModule: "contract" });
    const fieldId = await createField("Keep contract answer", "contract");
    expect((await attach(type.id, { fieldId, isRequired: true })).statusCode).toBe(201);
    const result = await setTarget(type.id, { targetModule: null });
    expect(result.statusCode, result.body).toBe(400);
    expect(await typeBySlug(type.slug)).toMatchObject({
      targetModule: "contract",
      targetTypeId: null,
      formFieldCount: 1,
    });
    expect(await listAttached(type.id)).toEqual([
      expect.objectContaining({ fieldId, isRequired: true }),
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
    const shared = await createField("Required probe shared", "contract");
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

/** ENT-010 supplies Entity choices; INT-002 still keeps person Fields optional. */
describe("a user Field stays optional while an Entity Field may be required", () => {
  it("refuses the flag by name, and leaves the attachment optional", async () => {
    const type = await addType("Required reference probe");
    const owner = await createField("Reference probe owner", "contract", "user");
    expect((await attach(type.id, { fieldId: owner })).statusCode).toBe(201);

    const res = await setRequired(type.id, owner, true);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Reference probe owner");
    expect(res.json().detail).toContain("cannot be required");
    expect((await listAttached(type.id))[0]!.isRequired).toBe(false);
  });

  it("allows an Entity Field to be required", async () => {
    const type = await addType("Required entity probe");
    const signer = await createField("Entity probe signer", "contract", "entity");
    expect((await attach(type.id, { fieldId: signer })).statusCode).toBe(201);

    const res = await setRequired(type.id, signer, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().attachedField.isRequired).toBe(true);
  });

  it("refuses an attach that arrives with the flag already set", async () => {
    const type = await addType("Required attach probe");
    const owner = await createField("Attach probe owner", "contract", "user");

    const res = await attach(type.id, { fieldId: owner, isRequired: true });
    expect(res.statusCode, res.body).toBe(400);
    // Refused whole: nothing is attached half-way.
    expect(await listAttached(type.id)).toEqual([]);

    // The same field attaches with no flag, which is the point of the
    // rule — the form may collect it, it may just not demand it.
    expect((await attach(type.id, { fieldId: owner })).statusCode).toBe(201);
    expect((await listAttached(type.id))[0]!.isRequired).toBe(false);
  });

  it("clears a row that is already required, and refuses to set it again", async () => {
    // The state a pre-#400 install can hold: the migration clears these
    // rows, and this plants one to prove the repair path stays open.
    const type = await addType("Required legacy probe");
    const owner = await createField("Legacy probe owner", "contract", "user");
    expect((await attach(type.id, { fieldId: owner })).statusCode).toBe(201);
    await harness.db
      .update(requestTypeFields)
      .set({ isRequired: true })
      .where(and(eq(requestTypeFields.typeId, type.id), eq(requestTypeFields.fieldId, owner)));
    expect((await listAttached(type.id))[0]!.isRequired).toBe(true);

    // Asking for the state again is refused, even though the row
    // already holds it — a no-op that answered 200 would report a
    // refused state as an accepted one.
    expect((await setRequired(type.id, owner, true)).statusCode).toBe(400);

    // Clearing it is always allowed. That is the repair.
    const cleared = await setRequired(type.id, owner, false);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().attachedField.isRequired).toBe(false);
    expect((await listAttached(type.id))[0]!.isRequired).toBe(false);
  });

  it("leaves the other mounts alone: a contract type takes the same field required", async () => {
    const owner = await createField("Contract probe owner", "contract", "user");
    const nda = "019ff1f5-301d-7795-a5af-e4339c76d4ce";
    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${nda}/fields`,
      cookies: adminCookies,
      payload: { fieldId: owner },
    });
    expect(attached.statusCode, attached.body).toBe(201);

    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${nda}/fields/${owner}`,
      cookies: adminCookies,
      payload: { isRequired: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().attachedField.isRequired).toBe(true);

    // Left as it was found: the seeded NDA type is shared by this file's
    // other assertions.
    expect(
      (
        await harness.app.inject({
          method: "DELETE",
          url: `/api/v1/contract-types/${nda}/fields/${owner}`,
          cookies: adminCookies,
        })
      ).statusCode,
    ).toBe(204);
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

    const first = await createField("Count probe one", "contract");
    const second = await createField("Count probe two", "contract");
    expect((await attach(type.id, { fieldId: first })).statusCode).toBe(201);
    expect((await attach(type.id, { fieldId: second })).statusCode).toBe(201);
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(2);

    expect((await detach(type.id, second)).statusCode).toBe(204);
    expect((await typeBySlug(type.slug)).formFieldCount).toBe(1);
  });

  it("drops an attachment whose field is archived, as the editor's list does", async () => {
    const type = await addType("Count archive probe");
    const field = await createField("Count archive probe field", "contract");
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
    const first = await createField("Form audit one", "contract");
    const second = await createField("Form audit two", "contract");

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
    expect((await setTarget(probe.id, { targetModule: "matter" })).statusCode).toBe(409);
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

describe("attaching to the default destination type in the same act (INT-002, 2026-09-19)", () => {
  const listTargetFields = async (
    module: "contract" | "matter",
    typeId: string,
  ): Promise<AttachedFieldRow[]> => {
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/${module}-types/${typeId}/fields`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().attachedFields;
  };

  const targetAuditRows = (module: "contract" | "matter") =>
    harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, `${module}_type_field.attached`))
      .orderBy(asc(activityLog.createdAt));

  it("puts the field on the form and on the default contract type, with the target's own entry", async () => {
    const ndaTypeId = (await typeBySlug("nda_request")).targetTypeId!;
    const type = await addType("Companion probe");
    await setTarget(type.id, { targetModule: "contract", targetTypeId: ndaTypeId });
    const fieldId = await createField("Companion probe clause", "contract");
    const before = (await targetAuditRows("contract")).length;

    const res = await attach(type.id, { fieldId, alsoAttachToTarget: true });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      attachedField: { fieldId, isRequired: false },
      alsoAttachedTo: {
        module: "contract",
        typeId: ndaTypeId,
        typeDisplayName: "NDA",
        attached: true,
      },
    });
    expect((await listAttached(type.id)).map((row) => row.fieldId)).toEqual([fieldId]);
    const onTarget = (await listTargetFields("contract", ndaTypeId)).find(
      (row) => row.fieldId === fieldId,
    );
    expect(onTarget).toMatchObject({ isRequired: false });
    // Appended after the NDA type's own attachments, never ahead of them.
    const orders = (await listTargetFields("contract", ndaTypeId)).map((row) => row.displayOrder);
    expect(onTarget!.displayOrder).toBe(Math.max(...orders));

    const entries = await targetAuditRows("contract");
    expect(entries).toHaveLength(before + 1);
    expect(entries.at(-1)).toMatchObject({
      visibility: "admin_only",
      payload: { typeSlug: "nda", fieldSlug: "companion_probe_clause", isRequired: false },
    });
  });

  it("answers attached: false when the target already has the field, and writes nothing twice", async () => {
    const ndaTypeId = (await typeBySlug("nda_request")).targetTypeId!;
    const type = await addType("Companion twice");
    await setTarget(type.id, { targetModule: "contract", targetTypeId: ndaTypeId });
    const fieldId = await createField("Companion twice clause", "contract");
    const planted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${ndaTypeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId },
    });
    expect(planted.statusCode, planted.body).toBe(201);
    const before = (await targetAuditRows("contract")).length;

    const res = await attach(type.id, { fieldId, alsoAttachToTarget: true });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().alsoAttachedTo).toMatchObject({ typeDisplayName: "NDA", attached: false });
    expect(
      (await listTargetFields("contract", ndaTypeId)).filter((row) => row.fieldId === fieldId),
    ).toHaveLength(1);
    expect(await targetAuditRows("contract")).toHaveLength(before);
  });

  it("leaves the target alone without the flag, and says so", async () => {
    const ndaTypeId = (await typeBySlug("nda_request")).targetTypeId!;
    const type = await addType("Companion silent");
    await setTarget(type.id, { targetModule: "contract", targetTypeId: ndaTypeId });
    const fieldId = await createField("Companion silent clause", "contract");

    const res = await attach(type.id, { fieldId });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().alsoAttachedTo).toBeNull();
    expect(
      (await listTargetFields("contract", ndaTypeId)).some((row) => row.fieldId === fieldId),
    ).toBe(false);
  });

  it("reaches a default matter type on the Matter arm", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "Companion matters" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const matterTypeId: string = created.json().matterType.id;
    const type = await addType("Companion matter probe");
    await setTarget(type.id, { targetModule: "matter", targetTypeId: matterTypeId });
    const fieldId = await plantScopedField(
      "companion_matter_clause",
      "Companion matter clause",
      "matter",
    );

    const res = await attach(type.id, { fieldId, alsoAttachToTarget: true });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().alsoAttachedTo).toMatchObject({
      module: "matter",
      typeId: matterTypeId,
      typeDisplayName: "Companion matters",
      attached: true,
    });
    expect((await listTargetFields("matter", matterTypeId)).map((row) => row.fieldId)).toEqual([
      fieldId,
    ]);
    expect(await targetAuditRows("matter")).toHaveLength(1);
  });

  it("refuses by name, and rolls the form attach back with it", async () => {
    const moduleOnly = await addType("Companion no type");
    await setTarget(moduleOnly.id, { targetModule: "contract" });
    const fieldId = await createField("Companion no type clause", "contract");
    const noType = await attach(moduleOnly.id, { fieldId, alsoAttachToTarget: true });
    expect(noType.statusCode, noType.body).toBe(400);
    expect(noType.headers["content-type"]).toContain("application/problem+json");
    expect(noType.json().detail).toBe(
      "This request type has no default destination type, so there is no type to attach the field to.",
    );
    // Both or neither: the form attach did not survive the refusal.
    expect(await listAttached(moduleOnly.id)).toEqual([]);

    const ndaTypeId = (await typeBySlug("nda_request")).targetTypeId!;
    const withType = await addType("Companion default field");
    await setTarget(withType.id, { targetModule: "contract", targetTypeId: ndaTypeId });
    // A default field lives in the intake catalog, which the plain
    // list route omits (`intake=true` is the editor's read).
    const [counterpartiesRow] = await harness.db
      .select({ id: fields.id })
      .from(fields)
      .where(eq(fields.slug, "__intake_contract_counterparties"));
    const counterparties = counterpartiesRow!.id;
    const builtIn = await attach(withType.id, {
      fieldId: counterparties,
      alsoAttachToTarget: true,
    });
    expect(builtIn.statusCode, builtIn.body).toBe(400);
    expect(builtIn.json().detail).toBe(
      "Counterparties is a default field. It is already part of every record and carries on its own.",
    );
    expect(await listAttached(withType.id)).toEqual([]);

    const archivedType = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "Companion retired" },
    });
    expect(archivedType.statusCode, archivedType.body).toBe(201);
    const retiredId: string = archivedType.json().contractType.id;
    const pointed = await addType("Companion retired target");
    await setTarget(pointed.id, { targetModule: "contract", targetTypeId: retiredId });
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${retiredId}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const onArchived = await attach(pointed.id, { fieldId, alsoAttachToTarget: true });
    expect(onArchived.statusCode, onArchived.body).toBe(409);
    expect(onArchived.json().detail).toBe("Companion retired is archived. Restore it first.");
    expect(await listAttached(pointed.id)).toEqual([]);
  });

  it("refuses a changed destination without attaching to either type", async () => {
    const oldId = (await typeBySlug("nda_request")).targetTypeId!;
    const made = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "Changed companion destination" },
    });
    expect(made.statusCode, made.body).toBe(201);
    const newId = made.json().contractType.id;
    const type = await addType("Changed companion");
    await setTarget(type.id, { targetModule: "contract", targetTypeId: oldId });
    const fieldId = await createField("Changed companion field", "contract");
    await setTarget(type.id, { targetModule: "contract", targetTypeId: newId });
    const before = (await attachmentAuditRows()).length;
    const refused = await attach(type.id, {
      fieldId,
      alsoAttachToTarget: true,
      expectedTarget: { module: "contract", typeId: oldId },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.json().detail).toContain("destination changed");
    expect(await listAttached(type.id)).toEqual([]);
    for (const id of [oldId, newId])
      expect((await listTargetFields("contract", id)).some((row) => row.fieldId === fieldId)).toBe(
        false,
      );
    expect(await attachmentAuditRows()).toHaveLength(before);
  });

  it("waits for the destination before locking the Field during competing attachments", async () => {
    const targetId = (await typeBySlug("nda_request")).targetTypeId!;
    const type = await addType("Concurrent companion");
    await setTarget(type.id, { targetModule: "contract", targetTypeId: targetId });
    const fieldId = await createField("Concurrent companion field", "contract");
    let companion: ReturnType<typeof attach> | undefined;
    let direct: ReturnType<typeof attach> | undefined;
    try {
      await harness.db.transaction(async (tx) => {
        const holding = await tx.execute(sql`select pg_backend_pid()::int as pid`);
        const holder = Number(holding.rows[0]?.pid);
        await tx.select().from(contractTypes).where(eq(contractTypes.id, targetId)).for("update");
        companion = attach(type.id, {
          fieldId,
          alsoAttachToTarget: true,
          expectedTarget: { module: "contract", typeId: targetId },
        });
        await expect
          .poll(
            async () => {
              const waiting = await harness.db.execute(
                sql`select count(*)::int as waiting from pg_stat_activity where ${holder} = any(pg_blocking_pids(pid))`,
              );
              return Number(waiting.rows[0]?.waiting ?? 0);
            },
            { timeout: 10000 },
          )
          .toBeGreaterThan(0);
        // A companion waiting for this Type must not already own the Field.
        await tx.execute(sql`select id from fields where id = ${fieldId} for update nowait`);
        direct = Promise.resolve(
          harness.app.inject({
            method: "POST",
            url: `/api/v1/contract-types/${targetId}/fields`,
            cookies: adminCookies,
            payload: { fieldId },
          }),
        );
      });
      const first = await companion!;
      const second = await direct!;
      expect(first.statusCode, first.body).toBe(201);
      expect([201, 409]).toContain(second.statusCode);
      expect(
        (await listTargetFields("contract", targetId)).filter((row) => row.fieldId === fieldId),
      ).toHaveLength(1);
      expect((await listAttached(type.id)).map((row) => row.fieldId)).toEqual([fieldId]);
    } finally {
      await Promise.allSettled([companion, direct]);
    }
  });

  it("is this mount's alone: a contract type's attach neither reads nor answers the member", async () => {
    const ndaTypeId = (await typeBySlug("nda_request")).targetTypeId!;
    const fieldId = await createField("Companion only here", "contract");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${ndaTypeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId, alsoAttachToTarget: true },
    });
    // The member is not in that route's body, so it is dropped on the
    // way in, and the envelope has no side to report.
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).not.toHaveProperty("alsoAttachedTo");
  });
});
