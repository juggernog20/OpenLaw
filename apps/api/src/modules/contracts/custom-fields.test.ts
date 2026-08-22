// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract's custom fields (CTR-016, M8/6) at the HTTP seam — the
 * M6 catalog finally doing work, and the `is_required` stub closing.
 *
 * The contract's type decides which fields the record carries and in
 * what order, through the `contract_type_fields` join; the values live
 * in one jsonb map keyed by field slug. All nine field types round-trip
 * through their own shape, including the two that name a row — a person
 * and one of our Entities. Values are retained on detach and reappear on
 * re-attachment, which is the whole reason they are keyed by slug.
 *
 * MTR-014's hard-required rule holds at two points, both here rather
 * than only in a form: creation refuses a contract whose type requires a
 * field the body leaves empty, and a re-type re-checks the *new* type's
 * required fields before it commits. A third path deliberately does not
 * check — an ordinary edit of another field on a record that already
 * carries a gap — and that is what makes the SET-003 bulk reassignment
 * (#113) separable.
 *
 * Every write lands in the activity log inside the same transaction
 * (DD-017), asserted by reading the table — the log has no read routes
 * until M9.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, inArray, users, type CustomFieldValue } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
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
let memberCookies: Record<string, string>;
let memberId: string;

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
  memberId = member.id;
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
});

afterAll(async () => {
  await harness.stop();
});

interface AttachedField {
  fieldId: string;
  slug: string;
  displayName: string;
  description: string | null;
  fieldType: string;
  options: string[] | null;
  displayOrder: number;
  isRequired: boolean;
}

interface TypeChoice {
  id: string;
  slug: string;
  displayName: string;
  fields: AttachedField[];
}

const options = async () => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { contractTypes: TypeChoice[] };
};

const typeBySlug = async (slug: string): Promise<TypeChoice> => {
  const choice = (await options()).contractTypes.find((row) => row.slug === slug);
  expect(choice, slug).toBeDefined();
  return choice!;
};

const defineField = async (payload: Record<string, unknown>): Promise<AttachedField> => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { moduleScope: "contract", fieldTag: "legal", ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  const field = res.json().field;
  return { ...field, fieldId: field.id, displayOrder: 0, isRequired: false };
};

const attachField = async (typeId: string, fieldId: string, isRequired = false) => {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contract-types/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId, isRequired },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().attachedField as AttachedField;
};

const detachField = async (typeId: string, fieldId: string) => {
  const res = await harness.app.inject({
    method: "DELETE",
    url: `/api/v1/contract-types/${typeId}/fields/${fieldId}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(204);
};

const reorderFields = async (typeId: string, fieldIds: string[]) => {
  const res = await harness.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${typeId}/fields/order`,
    cookies: adminCookies,
    payload: { fieldIds },
  });
  expect(res.statusCode, res.body).toBe(200);
};

/** Adds a contract type, requiring success — most tests want a type
 * nothing else has attached fields to. */
const newType = async (displayName: string): Promise<TypeChoice> => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  const created = res.json().contractType;
  return { id: created.id, slug: created.slug, displayName: created.displayName, fields: [] };
};

const createContract = (payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload,
  });

const newContract = async (title: string, typeId: string, customFields?: unknown) => {
  const res = await createContract({
    title,
    contractTypeId: typeId,
    ...(customFields ? { customFields } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as {
    id: string;
    number: number;
    customFields: Record<string, CustomFieldValue>;
  };
};

const patchContract = (number: number, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });

const readContract = async (number: number) => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    contract: { customFields: Record<string, CustomFieldValue> };
    fields: AttachedField[];
    customFieldRefs: {
      users: { id: string; displayName: string; archived: boolean }[];
      entities: { id: string; legalName: string }[];
    };
  };
};

/** Registers one of our entities, requiring success — the `entity`
 * field type picks from the M7 registry. */
const newEntity = async (legalName: string): Promise<{ id: string; legalName: string }> => {
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  const corporation = (types.json().entityTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "corporation",
  );
  expect(corporation).toBeDefined();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: adminCookies,
    payload: { legalName, entityTypeId: corporation!.id },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().entity;
};

const auditRowsFor = async (id: string) =>
  (
    await harness.db
      .select()
      .from(activityLog)
      .where(inArray(activityLog.action, ["contract.created", "contract.updated"]))
      .orderBy(asc(activityLog.createdAt))
  ).filter((row) => row.entityId === id);

describe("the fields a contract's type attaches (CTR-016)", () => {
  it("renders the type's live attachments in attachment order, and no others", async () => {
    const type = await newType("Order form");
    const other = await newType("Statement of work");
    const first = await defineField({ displayName: "Payment terms", fieldType: "text" });
    const second = await defineField({ displayName: "Notice days", fieldType: "number" });
    const elsewhere = await defineField({ displayName: "Site count", fieldType: "number" });
    await attachField(type.id, first.fieldId);
    await attachField(type.id, second.fieldId);
    await attachField(other.id, elsewhere.fieldId);

    const contract = await newContract("Order form fields", type.id);
    const read = await readContract(contract.number);
    expect(read.fields.map((field) => field.slug)).toEqual([first.slug, second.slug]);
    expect(read.fields.map((field) => field.displayOrder)).toEqual([1, 2]);
    // Nothing recorded yet is `{}`, not a map of nulls.
    expect(read.contract.customFields).toEqual({});

    // The join decides the order, so reordering it reorders the record.
    await reorderFields(type.id, [second.fieldId, first.fieldId]);
    const reread = await readContract(contract.number);
    expect(reread.fields.map((field) => field.slug)).toEqual([second.slug, first.slug]);
  });

  it("leaves out an attachment whose field is archived", async () => {
    const type = await newType("Archived-field type");
    const field = await defineField({ displayName: "Retired note", fieldType: "text" });
    await attachField(type.id, field.fieldId);
    const contract = await newContract("Archived field", type.id);
    await patchContract(contract.number, { customFields: { [field.slug]: "kept" } });

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${field.fieldId}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const read = await readContract(contract.number);
    expect(read.fields).toEqual([]);
    // Archived means hidden, never deleted: the value is still there.
    expect(read.contract.customFields[field.slug]).toBe("kept");
  });

  it("offers each live type's attachments on the picker read, so the create dialog knows what a type will demand", async () => {
    const type = await newType("Demanding type");
    const required = await defineField({ displayName: "Signing office", fieldType: "text" });
    await attachField(type.id, required.fieldId, true);

    const choice = await typeBySlug(type.slug);
    expect(choice.fields).toHaveLength(1);
    expect(choice.fields[0]).toMatchObject({
      slug: required.slug,
      displayName: "Signing office",
      isRequired: true,
      displayOrder: 1,
    });
  });
});

describe("the nine field types round-trip through their own shape", () => {
  it("stores, reads back, and clears every type", async () => {
    const type = await newType("Every type");
    const entity = await newEntity("Meridian Bio, Inc.");
    const definitions = await Promise.all([
      defineField({ displayName: "Governing office", fieldType: "text" }),
      defineField({ displayName: "Special terms", fieldType: "long_text" }),
      defineField({ displayName: "Notice period", fieldType: "number" }),
      defineField({ displayName: "Signed on", fieldType: "date" }),
      defineField({ displayName: "Auto renews", fieldType: "boolean" }),
      defineField({
        displayName: "Our position",
        fieldType: "single_select",
        options: ["Customer", "Provider"],
      }),
      defineField({
        displayName: "Regions",
        fieldType: "multi_select",
        options: ["EMEA", "AMER", "APAC"],
      }),
      defineField({ displayName: "Reviewer", fieldType: "user" }),
      defineField({ displayName: "Signing office entity", fieldType: "entity" }),
    ]);
    for (const field of definitions) await attachField(type.id, field.fieldId);
    const slug = (index: number) => definitions[index]!.slug;

    const contract = await newContract("All nine", type.id);
    const written: Record<string, CustomFieldValue> = {
      [slug(0)]: "London",
      [slug(1)]: "The parties agree to arbitrate.",
      [slug(2)]: 45,
      [slug(3)]: "2026-09-01",
      [slug(4)]: true,
      [slug(5)]: "Provider",
      // Out of catalog order on purpose: it is stored in the catalog's
      // order, so two records that hold the same set read the same.
      [slug(6)]: ["APAC", "EMEA"],
      [slug(7)]: memberId,
      [slug(8)]: entity.id,
    };
    for (const [key, value] of Object.entries(written)) {
      const res = await patchContract(contract.number, { customFields: { [key]: value } });
      expect(res.statusCode, res.body).toBe(200);
    }

    const read = await readContract(contract.number);
    expect(read.contract.customFields).toEqual({ ...written, [slug(6)]: ["EMEA", "APAC"] });
    // The two types that name a row read back as rows, so the record
    // renders a name where it holds an id.
    expect(read.customFieldRefs.users).toEqual([
      { id: memberId, displayName: MEMBER.displayName, image: null, archived: false },
    ]);
    expect(read.customFieldRefs.entities).toEqual([{ id: entity.id, legalName: entity.legalName }]);

    // Every type clears the same way, and clearing removes the key
    // rather than storing a null.
    for (const key of Object.keys(written)) {
      const res = await patchContract(contract.number, { customFields: { [key]: null } });
      expect(res.statusCode, res.body).toBe(200);
    }
    expect((await readContract(contract.number)).contract.customFields).toEqual({});
  });

  it("refuses a value that is not the field's shape", async () => {
    const type = await newType("Shape checks");
    const number = await defineField({ displayName: "Cap months", fieldType: "number" });
    const date = await defineField({ displayName: "Renews on", fieldType: "date" });
    const flag = await defineField({ displayName: "Confidential terms", fieldType: "boolean" });
    const pick = await defineField({
      displayName: "Paper",
      fieldType: "single_select",
      options: ["Ours", "Theirs"],
    });
    const picks = await defineField({
      displayName: "Territories",
      fieldType: "multi_select",
      options: ["UK", "US"],
    });
    for (const field of [number, date, flag, pick, picks])
      await attachField(type.id, field.fieldId);
    const contract = await newContract("Bad shapes", type.id);

    const refusals: [string, unknown][] = [
      [number.slug, "twelve"],
      [date.slug, "1 September 2026"],
      [flag.slug, "yes"],
      [pick.slug, "Someone else's"],
      [picks.slug, ["UK", "MOON"]],
      [picks.slug, ["UK", "UK"]],
    ];
    for (const [key, value] of refusals) {
      const res = await patchContract(contract.number, { customFields: { [key]: value } });
      expect(res.statusCode, `${key}=${JSON.stringify(value)}`).toBe(400);
    }
    expect((await readContract(contract.number)).contract.customFields).toEqual({});
  });

  it("refuses a person or an entity that is not live, and a slug the type does not attach", async () => {
    const type = await newType("Reference checks");
    const person = await defineField({ displayName: "Approver", fieldType: "user" });
    const ours = await defineField({ displayName: "Booking entity", fieldType: "entity" });
    await attachField(type.id, person.fieldId);
    await attachField(type.id, ours.fieldId);
    const contract = await newContract("References", type.id);

    const ghostPerson = await patchContract(contract.number, {
      customFields: { [person.slug]: "no-such-user" },
    });
    expect(ghostPerson.statusCode, ghostPerson.body).toBe(400);

    const gone = await newEntity("Dissolved Holdings Ltd");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${gone.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const deadEntity = await patchContract(contract.number, {
      customFields: { [ours.slug]: gone.id },
    });
    expect(deadEntity.statusCode, deadEntity.body).toBe(400);

    // A slug this type does not attach has nowhere to render and no way
    // to be cleared, so the seam refuses to write it.
    const stray = await defineField({ displayName: "Unattached note", fieldType: "text" });
    const strayWrite = await patchContract(contract.number, {
      customFields: { [stray.slug]: "nowhere" },
    });
    expect(strayWrite.statusCode, strayWrite.body).toBe(400);
  });
});

describe("values are retained on detach (CTR-016)", () => {
  it("keeps a detached field's value and shows it again on re-attachment", async () => {
    const type = await newType("Detach and return");
    const field = await defineField({ displayName: "Escalation contact", fieldType: "text" });
    await attachField(type.id, field.fieldId);
    const contract = await newContract("Retained", type.id);
    const written = await patchContract(contract.number, {
      customFields: { [field.slug]: "Ops desk" },
    });
    expect(written.statusCode, written.body).toBe(200);

    await detachField(type.id, field.fieldId);
    const detached = await readContract(contract.number);
    // The field no longer renders, but the value is not the join's to
    // delete — it is keyed by slug, and the slug never changes.
    expect(detached.fields).toEqual([]);
    expect(detached.contract.customFields[field.slug]).toBe("Ops desk");

    await attachField(type.id, field.fieldId);
    const reattached = await readContract(contract.number);
    expect(reattached.fields.map((row) => row.slug)).toEqual([field.slug]);
    expect(reattached.contract.customFields[field.slug]).toBe("Ops desk");
  });
});

describe("hard-required fields at creation (MTR-014)", () => {
  it("refuses to create a contract while a required field is empty, and names it", async () => {
    const type = await newType("Requires two");
    const first = await defineField({ displayName: "Governing law", fieldType: "text" });
    const second = await defineField({ displayName: "Our position", fieldType: "text" });
    await attachField(type.id, first.fieldId, true);
    await attachField(type.id, second.fieldId, true);

    const bare = await createContract({ title: "No answers", contractTypeId: type.id });
    expect(bare.statusCode, bare.body).toBe(400);
    expect(bare.json().detail).toContain("Governing law");
    expect(bare.json().detail).toContain("Our position");

    // A blank string is not an answer: it is how a text field is
    // cleared, so it leaves the same gap an absent key does.
    const blank = await createContract({
      title: "Blank answer",
      contractTypeId: type.id,
      customFields: { [first.slug]: "  ", [second.slug]: "Provider" },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    expect(blank.json().detail).toContain("Governing law");

    const filled = await createContract({
      title: "Both answered",
      contractTypeId: type.id,
      customFields: { [first.slug]: "England & Wales", [second.slug]: "Provider" },
    });
    expect(filled.statusCode, filled.body).toBe(201);
    expect(filled.json().contract.customFields).toEqual({
      [first.slug]: "England & Wales",
      [second.slug]: "Provider",
    });
  });

  it("counts false and zero as answers", async () => {
    const type = await newType("Falsy answers");
    const flag = await defineField({ displayName: "Auto renew", fieldType: "boolean" });
    const number = await defineField({ displayName: "Notice days", fieldType: "number" });
    await attachField(type.id, flag.fieldId, true);
    await attachField(type.id, number.fieldId, true);

    const res = await createContract({
      title: "No and none",
      contractTypeId: type.id,
      customFields: { [flag.slug]: false, [number.slug]: 0 },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().contract.customFields).toEqual({ [flag.slug]: false, [number.slug]: 0 });
  });

  it("records the answered slugs on the creation entry", async () => {
    const type = await newType("Audited creation");
    const field = await defineField({ displayName: "Renewal window", fieldType: "text" });
    await attachField(type.id, field.fieldId, true);
    const contract = await newContract("Audited", type.id, { [field.slug]: "60 days" });

    const [created] = await auditRowsFor(contract.id);
    expect(created?.action).toBe("contract.created");
    expect((created?.payload as { customFields: string[] }).customFields).toEqual([field.slug]);
  });
});

describe("hard-required fields at re-type (MTR-014)", () => {
  it("re-checks the new type's required fields before committing, and leaves the contract on its old type when it refuses", async () => {
    const from = await newType("Loose type");
    const to = await newType("Strict type");
    const demanded = await defineField({ displayName: "Data processor", fieldType: "text" });
    await attachField(to.id, demanded.fieldId, true);
    const contract = await newContract("Re-typed", from.id);

    const refused = await patchContract(contract.number, { contractTypeId: to.id });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain("Data processor");
    // The refusal is the whole transaction: nothing moved.
    const stayed = await readContract(contract.number);
    expect(stayed.contract).toMatchObject({ contractTypeId: from.id });

    // The type and the values that satisfy it commit together — the one
    // compound DES-017 carves out for a purpose-built dialog.
    const committed = await patchContract(contract.number, {
      contractTypeId: to.id,
      customFields: { [demanded.slug]: "Helix Labs GmbH" },
    });
    expect(committed.statusCode, committed.body).toBe(200);
    expect(committed.json().contract.contractTypeId).toBe(to.id);
    expect(committed.json().fields.map((field: AttachedField) => field.slug)).toEqual([
      demanded.slug,
    ]);
  });

  it("accepts a re-type whose required field is already answered by a retained value", async () => {
    const shared = await defineField({ displayName: "Department", fieldType: "text" });
    const from = await newType("Retaining type");
    const to = await newType("Demanding same field");
    await attachField(from.id, shared.fieldId);
    await attachField(to.id, shared.fieldId, true);

    const contract = await newContract("Already answered", from.id);
    const written = await patchContract(contract.number, {
      customFields: { [shared.slug]: "Engineering" },
    });
    expect(written.statusCode, written.body).toBe(200);

    const retyped = await patchContract(contract.number, { contractTypeId: to.id });
    expect(retyped.statusCode, retyped.body).toBe(200);
    expect(retyped.json().contract.customFields[shared.slug]).toBe("Engineering");
  });

  it("refuses a re-type onto an archived type", async () => {
    const from = await newType("Live source");
    const to = await newType("Doomed target");
    const contract = await newContract("Archived target", from.id);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${to.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await patchContract(contract.number, { contractTypeId: to.id });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses clearing a required field, and still allows editing the rest of a record that carries a gap", async () => {
    const type = await newType("Gap holder");
    const required = await defineField({ displayName: "Signing authority", fieldType: "text" });
    const optional = await defineField({ displayName: "Internal note", fieldType: "text" });
    await attachField(type.id, required.fieldId, true);
    await attachField(type.id, optional.fieldId);
    const contract = await newContract("Has a gap", type.id, { [required.slug]: "Board" });

    const cleared = await patchContract(contract.number, {
      customFields: { [required.slug]: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(400);

    // A field made required after the record was created leaves a gap
    // nobody chose. Editing anything else must not be refused for it —
    // that is the same separation the SET-003 bulk reassignment (#113)
    // relies on when it moves records without re-checking.
    const late = await defineField({ displayName: "Late demand", fieldType: "text" });
    await attachField(type.id, late.fieldId, true);
    const other = await patchContract(contract.number, {
      customFields: { [optional.slug]: "Reviewed by ops" },
    });
    expect(other.statusCode, other.body).toBe(200);
    const title = await patchContract(contract.number, { title: "Has a gap, renamed" });
    expect(title.statusCode, title.body).toBe(200);
  });
});

describe("the DD-017 trail for custom fields and re-types", () => {
  it("writes one changed entry per field, keyed by slug, and one for the type", async () => {
    const from = await newType("Trail source");
    const to = await newType("Trail target");
    const field = await defineField({ displayName: "Escalation path", fieldType: "text" });
    await attachField(from.id, field.fieldId);
    await attachField(to.id, field.fieldId);
    const contract = await newContract("Trail", from.id);

    await patchContract(contract.number, { customFields: { [field.slug]: "Ops" } });
    await patchContract(contract.number, { customFields: { [field.slug]: "Legal" } });
    await patchContract(contract.number, { contractTypeId: to.id });

    const rows = await auditRowsFor(contract.id);
    const updates = rows.filter((row) => row.action === "contract.updated");
    expect(updates).toHaveLength(3);
    expect((updates[0]!.payload as { changed: Record<string, unknown> }).changed).toEqual({
      [`field.${field.slug}`]: { from: null, to: "Ops" },
    });
    expect((updates[1]!.payload as { changed: Record<string, unknown> }).changed).toEqual({
      [`field.${field.slug}`]: { from: "Ops", to: "Legal" },
    });
    expect((updates[2]!.payload as { changed: Record<string, unknown> }).changed).toEqual({
      contractType: { from: "Trail source", to: "Trail target" },
    });
  });

  it("writes nothing when a field is re-sent unchanged", async () => {
    const type = await newType("Quiet trail");
    const field = await defineField({ displayName: "Renewal owner", fieldType: "text" });
    await attachField(type.id, field.fieldId);
    const contract = await newContract("Quiet", type.id);
    await patchContract(contract.number, { customFields: { [field.slug]: "Nadia" } });

    const before = (await auditRowsFor(contract.id)).length;
    const again = await patchContract(contract.number, {
      customFields: { [field.slug]: "Nadia" },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect((await auditRowsFor(contract.id)).length).toBe(before);
  });
});

describe("the archived contract stays frozen", () => {
  it("refuses a custom-field commit and a re-type until the record is restored", async () => {
    const type = await newType("Frozen type");
    const other = await newType("Frozen target");
    const field = await defineField({ displayName: "Frozen note", fieldType: "text" });
    await attachField(type.id, field.fieldId);
    const contract = await newContract("Frozen", type.id);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const write = await patchContract(contract.number, {
      customFields: { [field.slug]: "no" },
    });
    expect(write.statusCode, write.body).toBe(409);
    const retype = await patchContract(contract.number, { contractTypeId: other.id });
    expect(retype.statusCode, retype.body).toBe(409);
  });
});

describe("the SET-003 field guard counts contracts holding a value", () => {
  it("adds a contract holding the value to the field's in-use count", async () => {
    const type = await newType("Counted type");
    const field = await defineField({ displayName: "Counted field", fieldType: "text" });
    const countOf = async () => {
      const res = await harness.app.inject({
        method: "GET",
        url: "/api/v1/fields",
        cookies: adminCookies,
      });
      expect(res.statusCode, res.body).toBe(200);
      const row = (res.json().fields as { id: string; inUseCount: number }[]).find(
        (candidate) => candidate.id === field.fieldId,
      );
      expect(row, field.slug).toBeDefined();
      return row!.inUseCount;
    };
    expect(await countOf()).toBe(0);

    await attachField(type.id, field.fieldId);
    expect(await countOf()).toBe(1);

    const contract = await newContract("Counted", type.id);
    await patchContract(contract.number, { customFields: { [field.slug]: "held" } });
    expect(await countOf()).toBe(2);

    // The value outlives the attachment, so the count does too.
    await detachField(type.id, field.fieldId);
    expect(await countOf()).toBe(1);
  });
});
