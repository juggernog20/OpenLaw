// SPDX-License-Identifier: AGPL-3.0-only

import { regions } from "@openlaw/db";

import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  activityLog,
  and,
  autoDocGenerations,
  contracts,
  contractTeam,
  documents,
  documentVersions,
  departments,
  entities,
  entityTypes,
  eq,
  requests,
  users,
  sql,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { AutoDocFillError } from "../../lib/auto-doc-fill/engine.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let businessCookies: Record<string, string>;
let businessId: string;
let memberId: string;
let typeId: string;
let entityId: string;
let departmentId: string;
let fieldId: string;
let fieldSlug: string;
beforeAll(async () => {
  h = await startHarness({ runPipelineWorkers: false });
  await h.db
    .insert(regions)
    .values([{ slug: "middle-east", displayName: "Middle East", displayOrder: 1 }]);
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const policy = await h.app.inject({
    method: "PUT",
    url: "/api/v1/auto-docs/settings",
    payload: { acknowledgementFrequency: "none" },
    cookies: cookies,
  });
  expect(policy.statusCode, policy.body).toBe(200);
  for (const role of ["business_user", "legal_team_member"] as const) {
    const user = await provisionUser(h.app.auth, {
      email: `target-${role}@example.com`,
      displayName: `Target ${role}`,
      password: "correct-horse-battery",
    });
    await h.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (role === "business_user") {
      businessId = user.id;
      businessCookies = await signInCookies(
        h.app,
        `target-${role}@example.com`,
        "correct-horse-battery",
      );
    } else memberId = user.id;
  }
  const type = await post("/contract-types", { displayName: "Generated NDA" });
  typeId = type.json().contractType.id;
  for (const userId of [businessId, memberId])
    expect((await post(`/contract-types/${typeId}/people`, { userId })).statusCode).toBe(201);
  const department = await post("/departments", { displayName: "Procurement" });
  departmentId = department.json().department.id;
  const [entityType] = await h.db.select().from(entityTypes).limit(1);
  const [entity] = await h.db
    .insert(entities)
    .values({ legalName: "Example Subsidiary", entityTypeId: entityType!.id, portalListed: true })
    .returning();
  entityId = entity!.id;
  const field = await post("/fields", {
    displayName: "Governing law",
    fieldType: "text",
    moduleScope: "contract",
    fieldTag: "legal",
  });
  fieldId = field.json().field.id;
  fieldSlug = field.json().field.slug;
  expect(
    (await post(`/contract-types/${typeId}/fields`, { fieldId, isRequired: true })).statusCode,
  ).toBe(201);
});
afterAll(async () => {
  await h.stop();
});
const post = (path: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "POST", url: `/api/v1${path}`, cookies, payload });
const patch = (id: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "PATCH", url: `/api/v1/auto-docs/${id}`, cookies, payload });
const field = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  label: slug,
  fieldType: "text",
  ...extra,
});
async function prepare(settings: Record<string, unknown> = {}) {
  const made = await post("/auto-docs", { name: "Approved NDA" });
  const id: string = made.json().autoDoc.id;
  const configured = await patch(id, {
    formats: "docx",
    targetContractTypeId: typeId,
    titlePattern: "NDA - {{counterparty_name}}",
    ...settings,
  });
  expect(configured.statusCode, configured.body).toBe(200);
  const bytes = await readFile(
    new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url),
  );
  const uploaded = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies,
    headers: { "content-type": "multipart/form-data; boundary=target" },
    payload: Buffer.concat([
      Buffer.from(
        '--target\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--target--\r\n"),
    ]),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const saved = await post(`/auto-docs/${id}/form-versions`, {
    fields: [
      field("counterparty_name", {
        contractAttribute: "primary_counterparty_name",
        required: true,
      }),
      field("signing_date", { fieldType: "date", contractAttribute: "effective_date" }),
      field("entity", { fieldType: "entity", contractAttribute: "entity_id", required: true }),
      field("department", { contractAttribute: "owning_department_id" }),
      field("region", { contractAttribute: "region" }),
      field("amount", {
        fieldType: "currency",
        contractAttribute: "value",
        valueCurrency: "AED",
        valueCadence: "one_time",
      }),
      field("expiry", { fieldType: "date", contractAttribute: "expiry_date" }),
      field("term", {
        fieldType: "single_select",
        options: ["fixed", "evergreen", "auto_renew"],
        contractAttribute: "term_type",
      }),
      field("law", { catalogFieldId: fieldId, required: true }),
      field("title", { contractAttribute: "title" }),
    ],
  });
  expect(saved.statusCode, saved.body).toBe(201);
  return {
    id,
    pair: {
      documentVersionId: uploaded.json().template.versions[0].id as string,
      formVersionId: saved.json().formVersion.id as string,
    },
  };
}
const answers = () => ({
  counterparty_name: "Acme Target",
  signing_date: "2026-09-14",
  entity: entityId,
  department: "Procurement",
  region: "Middle East",
  amount: 12345.67,
  expiry: "2027-09-14",
  term: "fixed",
  law: "England and Wales",
  title: "Mapped title",
});
async function generate(
  prepared: Awaited<ReturnType<typeof prepare>>,
  extra: Record<string, unknown> = {},
) {
  expect((await post(`/auto-docs/${prepared.id}/publish`, prepared.pair)).statusCode).toBe(200);
  const made = await post(`/auto-docs/${prepared.id}/generations`, {
    ...prepared.pair,
    answers: answers(),
    ...extra,
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json().generation;
}

it("creates a draft Contract and its own primary Word Document with the mapped facts and people", async () => {
  const prepared = await prepare();
  const beforeRequests = await h.db.select({ id: requests.id }).from(requests);
  const generation = await generate(prepared, { businessOwnerId: businessId });
  expect(generation.createdContract).toMatchObject({ title: "NDA - Acme Target" });
  const detail = await h.app.inject({
    url: `/api/v1/contracts/${generation.createdContract.number}`,
    cookies,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  const contract = detail.json().contract;
  expect(contract).toMatchObject({
    title: "NDA - Acme Target",
    termType: "fixed",
    effectiveDate: "2026-09-14",
    expiryDate: "2027-09-14",
    region: "Middle East",
    value: { amount: 1234567, currency: "AED", cadence: "one_time" },
    customFields: { [fieldSlug]: "England and Wales" },
  });
  const [row] = await h.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(row).toMatchObject({
    businessOwnerId: businessId,
    managerId: null,
    entityId,
    owningDepartmentId: departmentId,
    createdByGenerationId: generation.id,
  });
  const document = await h.app.inject({
    url: `/api/v1/contracts/${contract.number}/documents`,
    cookies,
  });
  expect(document.statusCode, document.body).toBe(200);
  const primary = document
    .json()
    .documents.find((item: { id: string }) => item.id === row!.primaryDocumentId);
  expect(primary.isPrimary).toBe(true);
  const version = primary.versions[0];
  expect(version).toMatchObject({ versionNumber: 1, kind: "draft_ours", source: "generated" });
  const file = await h.app.inject({
    url: `/api/v1/documents/${row!.primaryDocumentId}/versions/${version.id}/download`,
    cookies,
  });
  const original = await h.app.inject({
    url: `/api/v1/auto-docs/${prepared.id}/generations/${generation.id}/docx`,
    cookies,
  });
  expect(file.statusCode, file.body).toBe(200);
  expect(file.rawPayload).toEqual(original.rawPayload);
  const [stored] = await h.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, version.id));
  const [storedGeneration] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generation.id));
  expect(stored!.fileRef).not.toBe(storedGeneration!.docxFileRef);
  const team = await h.db
    .select()
    .from(contractTeam)
    .where(eq(contractTeam.contractId, contract.id));
  expect(team.filter((person) => person.userId === businessId)).toHaveLength(1);
  expect(team.filter((person) => person.userId === memberId)).toHaveLength(1);
  const activity = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, "contract"), eq(activityLog.entityId, contract.id)));
  expect(activity.find((entry) => entry.action === "contract.created")?.payload).toMatchObject({
    autoDocId: prepared.id,
    autoDocName: "Approved NDA",
    generationId: generation.id,
  });
  expect(activity.filter((entry) => entry.action === "contract.team_added")).toHaveLength(1);
  expect(await h.db.select({ id: requests.id }).from(requests)).toEqual(beforeRequests);
  const portal = await h.app.inject({
    url: `/api/v1/portal/contracts/${contract.number}`,
    cookies: businessCookies,
  });
  expect(portal.statusCode, portal.body).toBe(200);
});

it("uses the fixed Entity without a picker and audits the target settings", async () => {
  const prepared = await prepare({ fixedEntityId: entityId, titlePattern: null });
  expect((await post(`/auto-docs/${prepared.id}/publish`, prepared.pair)).statusCode).toBe(200);
  const form = await h.app.inject({ url: `/api/v1/auto-docs/${prepared.id}/generate`, cookies });
  expect(
    form.json().fields.some((item: { fieldType: string }) => item.fieldType === "entity"),
  ).toBe(false);
  const made = await post(`/auto-docs/${prepared.id}/generations`, {
    ...prepared.pair,
    answers: { ...answers(), entity: undefined },
  });
  expect(made.statusCode, made.body).toBe(201);
  const [row] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, made.json().generation.createdContract.id));
  expect(row).toMatchObject({ title: "Mapped title", entityId, businessOwnerId: null });
  const events = await h.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "auto_doc"),
        eq(activityLog.entityId, prepared.id),
        eq(activityLog.action, "auto_doc.updated"),
      ),
    );
  expect(JSON.stringify(events.map((event) => event.payload))).toContain("Example Subsidiary");
});

it("refuses an unknown title Placeholder at Publish", async () => {
  const prepared = await prepare({ titlePattern: "NDA {{missing_slug}}" });
  const published = await post(`/auto-docs/${prepared.id}/publish`, prepared.pair);
  expect(published.statusCode, published.body).toBe(409);
  expect(published.json().detail).toContain("missing_slug");
});

it("leaves no Contract or primary Document when fill fails", async () => {
  const prepared = await prepare();
  const beforeContracts = await h.db.select({ id: contracts.id }).from(contracts);
  const beforeDocuments = await h.db.select({ id: documents.id }).from(documents);
  h.fillEngine.failure = new AutoDocFillError("The template cannot be filled.");
  try {
    const generation = await generate(prepared);
    expect(generation).toMatchObject({ state: "failed", createdContract: null });
  } finally {
    h.fillEngine.failure = null;
  }
  expect(await h.db.select({ id: contracts.id }).from(contracts)).toEqual(beforeContracts);
  expect(await h.db.select({ id: documents.id }).from(documents)).toEqual(beforeDocuments);
});

it("names the generating Business User as Business Owner and shows their Contract in the Portal", async () => {
  const prepared = await prepare({ audience: "everyone" });
  expect((await post(`/auto-docs/${prepared.id}/publish`, prepared.pair)).statusCode).toBe(200);
  const response = await h.app.inject({
    method: "POST",
    url: `/api/v1/portal/auto-docs/${prepared.id}/generations`,
    cookies: businessCookies,
    payload: { ...prepared.pair, answers: answers() },
  });
  expect(response.statusCode, response.body).toBe(201);
  const generation = response.json().generation;
  expect(generation.createdContract).not.toBeNull();
  const [row] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, generation.createdContract!.id));
  expect(row).toMatchObject({ businessOwnerId: businessId, createdBy: businessId });
  const team = await h.db
    .select()
    .from(contractTeam)
    .where(and(eq(contractTeam.contractId, row!.id), eq(contractTeam.userId, businessId)));
  expect(team).toHaveLength(1);
  const list = await h.app.inject({ url: "/api/v1/portal/contracts", cookies: businessCookies });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().contracts).toEqual(
    expect.arrayContaining([expect.objectContaining({ number: row!.number })]),
  );
});

it("keeps the Contract's original Document when a failed delivery is retried", async () => {
  const prepared = await prepare();
  const generation = await generate(prepared);
  const [row] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, generation.createdContract.id));
  const [version] = await h.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, row!.primaryDocumentId!));
  const url = `/api/v1/documents/${version!.documentId}/versions/${version!.id}/download`;
  const original = await h.app.inject({ url, cookies });
  const before = await h.db.select({ id: contracts.id }).from(contracts);
  await h.db
    .update(autoDocGenerations)
    .set({
      state: "failed",
      failure: { code: "email_failed", detail: "Email could not be sent." },
      emailState: "failed",
      emailFailure: { code: "email_failed", detail: "Email could not be sent." },
    })
    .where(eq(autoDocGenerations.id, generation.id));
  const retry = await post(`/auto-docs/${prepared.id}/generations/${generation.id}/retry`, {});
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().generation.createdContract.id).toBe(row!.id);
  expect(await h.db.select({ id: contracts.id }).from(contracts)).toEqual(before);
  const after = await h.app.inject({ url, cookies });
  expect(after.statusCode, after.body).toBe(200);
  expect(after.rawPayload).toEqual(original.rawPayload);
});

it("keeps non-targeted output off the Contract and Document models", async () => {
  const prepared = await prepare({ targetContractTypeId: null, titlePattern: null });
  const beforeContracts = await h.db.select({ id: contracts.id }).from(contracts);
  const beforeDocuments = await h.db.select({ id: documents.id }).from(documents);
  expect(await generate(prepared)).toMatchObject({ state: "ready", createdContract: null });
  expect(await h.db.select({ id: contracts.id }).from(contracts)).toEqual(beforeContracts);
  expect(await h.db.select({ id: documents.id }).from(documents)).toEqual(beforeDocuments);
});

it("restricts generated Word provenance to the Generation's original primary Document", async () => {
  const prepared = await prepare();
  const generation = await generate(prepared);
  const refused = async (operation: Promise<unknown>) => {
    const error = (await operation.then(
      () => null,
      (error: unknown) => error,
    )) as { code?: string; cause?: { code?: string } } | null;
    expect(error?.cause?.code ?? error?.code).toBe("23514");
  };
  await refused(
    h.db
      .update(documentVersions)
      .set({ source: "generated", kind: "draft_ours", generatedFromGenerationId: generation.id })
      .where(eq(documentVersions.id, prepared.pair.documentVersionId)),
  );
  const [stored] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generation.id));
  const [version] = await h.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, stored!.createdDocumentId!));
  await refused(
    h.db
      .update(documentVersions)
      .set({ generatedFromGenerationId: null })
      .where(eq(documentVersions.id, version!.id)),
  );
  await refused(
    h.db
      .update(documentVersions)
      .set({ kind: "executed" })
      .where(eq(documentVersions.id, version!.id)),
  );
  const recast = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${version!.documentId}/versions/${version!.id}`,
    cookies,
    payload: { kind: "executed" },
  });
  expect(recast.statusCode, recast.body).toBe(409);
  await refused(
    h.db
      .update(contracts)
      .set({ createdByGenerationId: null })
      .where(eq(contracts.id, generation.createdContract.id)),
  );
});

it("allows a targeted Entity answer to be omitted and leaves its Contract Entity unset", async () => {
  const prepared = await prepare();
  // The published form presents the optional Entity even when its authored field was required.
  expect((await post(`/auto-docs/${prepared.id}/publish`, prepared.pair)).statusCode).toBe(200);
  const live = await h.app.inject({ url: `/api/v1/auto-docs/${prepared.id}/generate`, cookies });
  expect(
    live.json().fields.find((field: { slug: string }) => field.slug === "entity").required,
  ).toBe(false);
  const made = await post(`/auto-docs/${prepared.id}/generations`, {
    ...prepared.pair,
    answers: { ...answers(), entity: null, amount: null, expiry: null },
  });
  expect(made.statusCode, made.body).toBe(201);
  const generation = made.json().generation;
  const [row] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, generation.createdContract.id));
  expect(row).toMatchObject({ entityId: null, valueAmount: null, expiryDate: null });
});

it("rolls back the Contract, Document, and Generation link if the Version write fails after fill", async () => {
  const prepared = await prepare();
  const beforeContracts = await h.db.select({ id: contracts.id }).from(contracts);
  const beforeDocuments = await h.db.select({ id: documents.id }).from(documents);
  await h.db.execute(
    sql`ALTER TABLE document_versions ADD CONSTRAINT test_refuse_generated_word CHECK (source <> 'generated') NOT VALID`,
  );
  try {
    const generation = await generate(prepared);
    expect(generation).toMatchObject({ state: "failed", createdContract: null, hasDocx: false });
    const [stored] = await h.db
      .select()
      .from(autoDocGenerations)
      .where(eq(autoDocGenerations.id, generation.id));
    expect(stored).toMatchObject({
      createdContractId: null,
      createdDocumentId: null,
      docxFileRef: null,
    });
    expect(await h.db.select({ id: contracts.id }).from(contracts)).toEqual(beforeContracts);
    expect(await h.db.select({ id: documents.id }).from(documents)).toEqual(beforeDocuments);
  } finally {
    await h.db.execute(
      sql`ALTER TABLE document_versions DROP CONSTRAINT test_refuse_generated_word`,
    );
  }
});

it("requires an explicit currency and cadence before publishing a targeted Value map", async () => {
  const prepared = await prepare();
  const detail = await h.app.inject({ url: `/api/v1/auto-docs/${prepared.id}`, cookies });
  const definition = detail.json().formVersion.definition;
  const fields = definition.fields.map((field: Record<string, unknown>) => {
    const editable = Object.fromEntries(
      Object.entries(field).filter(([key]) => key !== "displayOrder" && key !== "placeholder"),
    );
    return {
      ...editable,
      ...(field.contractAttribute === "value" ? { valueCurrency: null, valueCadence: null } : {}),
    };
  });
  const saved = await post(`/auto-docs/${prepared.id}/form-versions`, { ...definition, fields });
  expect(saved.statusCode, saved.body).toBe(201);
  const refused = await post(`/auto-docs/${prepared.id}/publish`, {
    ...prepared.pair,
    formVersionId: saved.json().formVersion.id,
  });
  expect(refused.statusCode, refused.body).toBe(409);
  expect(refused.json().detail).toContain("currency and cadence");
});

it("refuses a built-in map no answer of that form field can fill", async () => {
  const prepared = await prepare();
  const detail = await h.app.inject({ url: `/api/v1/auto-docs/${prepared.id}`, cookies });
  const definition = detail.json().formVersion.definition;
  const fields = definition.fields.map((field: Record<string, unknown>) => {
    const editable = Object.fromEntries(
      Object.entries(field).filter(([key]) => key !== "displayOrder" && key !== "placeholder"),
    );
    if (field.contractAttribute === "region") return { ...editable, fieldType: "boolean" };
    if (field.contractAttribute === "value") return { ...editable, fieldType: "long_text" };
    return editable;
  });
  const saved = await post(`/auto-docs/${prepared.id}/form-versions`, { ...definition, fields });
  expect(saved.statusCode, saved.body).toBe(201);
  const refused = await post(`/auto-docs/${prepared.id}/publish`, {
    ...prepared.pair,
    formVersionId: saved.json().formVersion.id,
  });
  expect(refused.statusCode, refused.body).toBe(409);
  expect(refused.json().detail).toContain('The "region" map needs a text answer.');
  expect(refused.json().detail).toContain("The Value map needs a number answer.");
});

it("hides the Contract link when its current title is outside the reader's audience", async () => {
  const outsider = await provisionUser(h.app.auth, {
    email: "generation-reader@example.com",
    displayName: "Generation reader",
    password: "correct-horse-battery",
  });
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, outsider.id));
  const outsiderCookies = await signInCookies(
    h.app,
    "generation-reader@example.com",
    "correct-horse-battery",
  );
  const prepared = await prepare();
  const generation = await generate(prepared);
  await h.db
    .update(contracts)
    .set({ isConfidential: true, title: "Confidential new title" })
    .where(eq(contracts.id, generation.createdContract.id));
  for (const suffix of ["", `/${generation.id}`]) {
    const read = await h.app.inject({
      url: `/api/v1/auto-docs/${prepared.id}/generations${suffix}`,
      cookies: outsiderCookies,
    });
    expect(read.statusCode, read.body).toBe(200);
    const item = suffix ? read.json().generation : read.json().generations[0];
    expect(item.createdContract).toBeNull();
    expect(read.body).not.toContain("Confidential new title");
  }
});

it("refuses an ambiguous Department name and accepts the chosen Department id", async () => {
  const prepared = await prepare();
  const candidates = await h.db
    .insert(departments)
    .values([
      { slug: "ambiguous_procurement_a", displayName: "Ambiguous Procurement", displayOrder: 100 },
      { slug: "ambiguous_procurement_b", displayName: "Ambiguous Procurement", displayOrder: 101 },
    ])
    .returning();
  expect((await post(`/auto-docs/${prepared.id}/publish`, prepared.pair)).statusCode).toBe(200);
  const refused = await post(`/auto-docs/${prepared.id}/generations`, {
    ...prepared.pair,
    answers: { ...answers(), department: "Ambiguous Procurement" },
  });
  expect(refused.statusCode, refused.body).toBe(400);
  expect(refused.json().detail).toContain("more than one");
  const made = await post(`/auto-docs/${prepared.id}/generations`, {
    ...prepared.pair,
    answers: { ...answers(), department: candidates[1]!.id },
  });
  expect(made.statusCode, made.body).toBe(201);
  const detail = await h.app.inject({
    url: `/api/v1/contracts/${made.json().generation.createdContract.number}`,
    cookies,
  });
  expect(detail.statusCode).toBe(200);
  expect(detail.json().contract.owningDepartmentId).toBe(candidates[1]!.id);
});
