// SPDX-License-Identifier: AGPL-3.0-only

import { saveFieldRow } from "../../testing/form-fixtures.js";

/** ADO-005: each Filing creates independent paper under the destination upload rule. */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  activityLog,
  and,
  eq,
  sql,
  users,
  contracts,
  documents,
  documentVersions,
  autoDocGenerations,
  autoDocFilings,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

import { fulfilRequestedFiling } from "./filings.js";
import { startPipeline, type Pipeline } from "../../pipeline/pg-boss.js";

let worker: Pipeline | undefined;
let h: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
const buyers: Array<{ id: string; cookies: Record<string, string> }> = [];
let salesId: string;
const post = (path: string, payload: Record<string, unknown>, cookies = admin) =>
  h.app.inject({ method: "POST", url: `/api/v1${path}`, payload, cookies });
const patch = (id: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "PATCH", url: `/api/v1/auto-docs/${id}`, payload, cookies: admin });
const get = (path: string, cookies = buyers[0]!.cookies) =>
  h.app.inject({ url: `/api/v1${path}`, cookies });
beforeAll(async () => {
  h = await startHarness({ runPipelineWorkers: false });
  expect((await post("/auth/setup", TEST_ADMIN)).statusCode).toBe(201);
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const [index, role] of ["business_user", "business_user", "legal_team_member"].entries()) {
    const fixture = {
      email: `filing-${index}@example.com`,
      displayName: `Portal person ${index}`,
      password: "correct-horse-battery",
    };
    const person = await provisionUser(h.app.auth, fixture);
    await h.db
      .update(users)
      .set({ role: role === "business_user" ? "business_user" : "legal_team_member" })
      .where(eq(users.id, person.id));
    const cookies = await signInCookies(h.app, fixture.email, fixture.password);
    if (role === "business_user") buyers.push({ id: person.id, cookies });
    else member = cookies;
  }
  const department = await post("/departments", { displayName: "Sales" });
  expect(department.statusCode, department.body).toBe(201);
  salesId = department.json().department.id;
  await h.db.update(users).set({ departmentId: salesId }).where(eq(users.id, buyers[1]!.id));
});
afterAll(async () => {
  await worker?.stop();
  await h.stop();
});
async function prepare(frequency = "none", extra: Record<string, unknown> = {}) {
  const settings = await h.app.inject({
    method: "PUT",
    url: "/api/v1/auto-docs/settings",
    payload: { acknowledgementFrequency: frequency },
    cookies: admin,
  });
  expect(settings.statusCode, settings.body).toBe(200);
  const made = await post("/auto-docs", { name: "Portal approved NDA" });
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().autoDoc.id as string;
  const configured = await patch(id, {
    audience: "everyone",
    formats: "docx",
    ...extra,
  });
  expect(configured.statusCode, configured.body).toBe(200);
  const bytes = await readFile(
    new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url),
  );
  const upload = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies: admin,
    headers: { "content-type": "multipart/form-data; boundary=word" },
    payload: Buffer.concat([
      Buffer.from(
        '--word\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--word--\r\n"),
    ]),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const form = await post(`/auto-docs/${id}/form-versions`, {
    fields: [
      { slug: "counterparty_name", label: "Counterparty name", fieldType: "text", required: true },
      { slug: "signing_date", label: "Signing date", fieldType: "date" },
    ],
  });
  expect(form.statusCode, form.body).toBe(201);
  const pair = {
    documentVersionId: upload.json().template.versions[0].id,
    formVersionId: form.json().formVersion.id,
  };
  expect((await post(`/auto-docs/${id}/publish`, pair)).statusCode).toBe(200);
  return { id, pair };
}

async function generation(portal = false, settings: Record<string, unknown> = {}) {
  const prepared = await prepare("none", settings);
  const response = await post(
    `/${portal ? "portal/" : ""}auto-docs/${prepared.id}/generations`,
    {
      ...prepared.pair,
      answers: { counterparty_name: "Filing supplier", signing_date: "2026-10-01" },
    },
    portal ? buyers[0]!.cookies : member,
  );
  expect(response.statusCode, response.body).toBe(201);
  return { ...prepared, generationId: response.json().generation.id as string };
}
async function destination(kind: "matter" | "contract", team = false) {
  const options = await get(`/${kind}s/options`, admin);
  const typeId = options.json()[`${kind}Types`][0].id;
  const response = await post(`/${kind}s`, { title: `Filing ${kind}`, [`${kind}TypeId`]: typeId });
  expect(response.statusCode, response.body).toBe(201);
  const row = response.json()[kind] as { id: string; number: number };
  if (team) {
    const added = await post(`/${kind}s/${row.number}/team`, { userId: buyers[0]!.id });
    expect(added.statusCode, added.body).toBe(201);
  }
  return { ...row, kind };
}
function file(
  source: Awaited<ReturnType<typeof generation>>,
  target: Record<string, unknown>,
  portal = false,
  format?: string,
) {
  return post(
    `/${portal ? "portal/" : ""}auto-docs/${source.id}/generations/${source.generationId}/filings`,
    {
      destination: target,
      ...(format ? { format } : {}),
    },
    portal ? buyers[0]!.cookies : member,
  );
}

it("files one Generation to two records as separate Version 1 Documents and retains its output", async () => {
  const source = await generation();
  const [original] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, source.generationId));
  const made = [];
  for (const kind of ["matter", "contract"] as const) {
    const target = await destination(kind);
    const response = await file(source, { kind, number: target.number });
    expect(response.statusCode, response.body).toBe(201);
    const filing = response.json().filing;
    made.push(filing.documentId);
    expect(filing).toMatchObject({
      generationId: source.generationId,
      format: "docx",
      target: { kind, number: target.number },
    });
    const [doc] = await h.db.select().from(documents).where(eq(documents.id, filing.documentId));
    expect(doc?.[kind === "contract" ? "contractId" : "matterId"]).toBe(target.id);
    const [version] = await h.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, filing.documentId));
    expect(version).toMatchObject({
      versionNumber: 1,
      source: "generated",
      generatedFromGenerationId: source.generationId,
      kind: "draft_ours",
    });
    expect(version!.fileRef).not.toBe(original!.docxFileRef);
    const activity = await h.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, target.id), eq(activityLog.action, "document.created")));
    expect(activity).toHaveLength(1);
    if (kind === "contract") {
      const [contract] = await h.db.select().from(contracts).where(eq(contracts.id, target.id));
      expect(contract!.primaryDocumentId).toBe(filing.documentId);
    }
  }
  expect(new Set(made).size).toBe(2);
  const history = await get(
    `/auto-docs/${source.id}/generations/${source.generationId}/filings`,
    member,
  );
  expect(history.statusCode, history.body).toBe(200);
  expect(history.json().filings).toHaveLength(2);
  const activity = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, source.id), eq(activityLog.action, "auto_doc.filed")));
  expect(activity).toHaveLength(2);
  const download = await get(
    `/auto-docs/${source.id}/generations/${source.generationId}/docx`,
    member,
  );
  expect(download.statusCode).toBe(200);
  const [after] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, source.generationId));
  expect(after!.docxFileRef).toBe(original!.docxFileRef);
});

it("allows a Business User only their own Generation and team records, without taking primary", async () => {
  const source = await generation(true);
  for (const kind of ["contract", "matter"] as const) {
    const denied = await destination(kind);
    expect((await file(source, { kind, number: denied.number }, true)).statusCode).toBe(404);
    const allowed = await destination(kind, true);
    const response = await file(source, { kind, number: allowed.number }, true);
    expect(response.statusCode, response.body).toBe(201);
    if (kind === "contract") {
      const [contract] = await h.db.select().from(contracts).where(eq(contracts.id, allowed.id));
      expect(contract!.primaryDocumentId).toBeNull();
    }
    const stolen = await post(
      `/portal/auto-docs/${source.id}/generations/${source.generationId}/filings`,
      { destination: { kind, number: allowed.number } },
      buyers[1]!.cookies,
    );
    expect(stolen.statusCode).toBe(404);
  }
  expect(
    (await file(source, { kind: "new_contract", contractTypeId: "missing" }, true)).statusCode,
  ).toBe(403);
});

it("keeps historical Filing after Unpublish, then refuses a revoked source audience", async () => {
  const source = await generation(true);
  const target = await destination("matter", true);
  expect((await post(`/auto-docs/${source.id}/unpublish`, {})).statusCode).toBe(200);
  expect((await file(source, { kind: "matter", number: target.number }, true)).statusCode).toBe(
    201,
  );
  expect((await patch(source.id, { audience: "legal_only" })).statusCode).toBe(200);
  expect((await file(source, { kind: "matter", number: target.number }, true)).statusCode).toBe(
    404,
  );
});

it("uses the targeted creation path for each new-Contract Filing without changing the automatic destination", async () => {
  const type = await post("/contract-types", { displayName: "Filed NDA" });
  const contractTypeId = type.json().contractType.id;
  expect(
    (await post(`/contract-types/${contractTypeId}/people`, { userId: buyers[0]!.id })).statusCode,
  ).toBe(201);
  const source = await generation(false, { targetContractTypeId: contractTypeId });
  const [original] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, source.generationId));
  expect(original!.createdContractId).not.toBeNull();
  const destinations = [];
  for (let i = 0; i < 2; i++) {
    const made = await file(source, { kind: "new_contract", contractTypeId });
    expect(made.statusCode, made.body).toBe(201);
    const filing = made.json().filing;
    expect(filing.createdContract).toBe(true);
    destinations.push(filing.target.number);
    const [contract] = await h.db
      .select()
      .from(contracts)
      .where(eq(contracts.number, filing.target.number));
    expect(contract).toMatchObject({
      createdByGenerationId: source.generationId,
      primaryDocumentId: filing.documentId,
    });
    const portal = await get(`/portal/contracts/${contract!.number}`);
    expect(portal.statusCode, portal.body).toBe(200);
  }
  expect(new Set(destinations).size).toBe(2);
  const [after] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, source.generationId));
  expect(after!.createdContractId).toBe(original!.createdContractId);
  expect(after!.createdDocumentId).toBe(original!.createdDocumentId);
});

it("refuses required target Fields without leaving a partial Filing or Contract", async () => {
  const source = await generation();
  const type = await post("/contract-types", { displayName: "Needs legal terms" });
  const contractTypeId = type.json().contractType.id;
  const field = await post("/fields", {
    displayName: "Filing required term",
    fieldType: "text",
    moduleScope: "contract",
  });
  expect(
    (
      await saveFieldRow(h, {
        typeUrl: `/api/v1/contract-types/${contractTypeId}`,
        cookies: admin,
        payload: {
          fieldId: field.json().field.id,
          isRequired: true,
        },
      })
    ).statusCode,
  ).toBe(200);
  const before = await h.db.select({ id: contracts.id }).from(contracts).orderBy(contracts.id);
  const refused = await file(source, { kind: "new_contract", contractTypeId });
  expect(refused.statusCode, refused.body).toBe(400);
  expect(await h.db.select({ id: contracts.id }).from(contracts).orderBy(contracts.id)).toEqual(
    before,
  );
  const history = await get(
    `/auto-docs/${source.id}/generations/${source.generationId}/filings`,
    member,
  );
  expect(history.json().filings).toEqual([]);
});

it("accepts a Member form destination with the answers and files Word before confirmation", async () => {
  const prepared = await prepare();
  const target = await destination("matter");
  const made = await post(
    `/auto-docs/${prepared.id}/generations`,
    {
      ...prepared.pair,
      answers: { counterparty_name: "Acme" },
      filing: { destination: { kind: "matter", number: target.number } },
    },
    member,
  );
  expect(made.statusCode, made.body).toBe(201);
  const generation = made.json().generation;
  expect(generation).toMatchObject({ hasDocx: true, filingPending: false, filingFailure: null });
  expect(generation.answerFields).toContainEqual({
    slug: "counterparty_name",
    label: "Counterparty name",
    fieldType: "text",
  });
  const history = await get(
    `/auto-docs/${prepared.id}/generations/${generation.id}/filings`,
    member,
  );
  expect(history.json().filings).toEqual([
    expect.objectContaining({
      target: expect.objectContaining({ kind: "matter", number: target.number }),
    }),
  ]);
  const invalid = await post(
    `/auto-docs/${prepared.id}/generations`,
    {
      ...prepared.pair,
      answers: { counterparty_name: "Acme" },
      filing: { destination: { kind: "matter", number: 999999 } },
    },
    member,
  );
  expect(invalid.statusCode).toBe(404);
});

it("keeps PDF Filing pending durably, fulfils it once, and refuses the forbidden Word format", async () => {
  const prepared = await prepare("none", { formats: "pdf" });
  const target = await destination("contract");
  const made = await post(
    `/auto-docs/${prepared.id}/generations`,
    {
      ...prepared.pair,
      answers: { counterparty_name: "PDF supplier" },
      filing: { destination: { kind: "contract", number: target.number } },
    },
    member,
  );
  expect(made.statusCode, made.body).toBe(201);
  const generation = made.json().generation;
  expect(generation).toMatchObject({ filingPending: true, hasPdf: false });
  const path = `/auto-docs/${prepared.id}/generations/${generation.id}`;
  const source = { ...prepared, generationId: generation.id };
  expect((await file(source, { kind: "contract", number: target.number })).statusCode).toBe(409);
  worker = await startPipeline({
    connectionString: h.databaseUrl,
    handlers: {
      db: h.db,
      storage: h.storage,
      docEngine: h.docEngine,
      resolveMailer: h.resolveMailer,
      resolveSigningProvider: h.resolveSigningProvider,
      resolveAiProvider: h.resolveAiProvider,
      baseUrl: "http://localhost:3345",
      log: { info() {}, warn() {}, error() {} },
    },
  });
  await expect
    .poll(async () => (await get(path, member)).json().generation.filingPending, {
      timeout: 20_000,
    })
    .toBe(false);
  await worker.stop();
  worker = undefined;
  const history = await get(`${path}/filings`, member);
  expect(history.json().filings).toEqual([expect.objectContaining({ format: "pdf" })]);
  const [version] = await h.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, history.json().filings[0].documentId));
  expect(version!.mimeType).toBe("application/pdf");
  expect(
    (await file(source, { kind: "contract", number: target.number }, false, "docx")).statusCode,
  ).toBe(403);
});

it("hides a private Filing target from other Members in both history and Activity", async () => {
  const source = await generation();
  const target = await destination("matter");
  const made = await file(source, { kind: "matter", number: target.number });
  expect(made.statusCode).toBe(201);
  const changed = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/matters/${target.number}`,
    cookies: admin,
    payload: { isConfidential: true },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  const history = await get(
    `/auto-docs/${source.id}/generations/${source.generationId}/filings`,
    member,
  );
  expect(history.json().filings[0]).toMatchObject({ target: null, documentId: null });
  const activity = await get(`/activity?entityType=auto_doc&entityId=${source.id}`, member);
  expect(activity.statusCode, activity.body).toBe(200);
  expect(
    activity.json().entries.some((entry: { action: string }) => entry.action === "auto_doc.filed"),
  ).toBe(false);
});

it("retains the output after a requested Filing fails and lets a Member choose another destination", async () => {
  const prepared = await prepare();
  const target = await destination("matter");
  await h.db.execute(
    sql`ALTER TABLE document_versions ADD CONSTRAINT test_refuse_filing CHECK (source <> 'generated') NOT VALID`,
  );
  let generationId: string;
  try {
    const made = await post(
      `/auto-docs/${prepared.id}/generations`,
      {
        ...prepared.pair,
        answers: { counterparty_name: "Surviving output" },
        filing: { destination: { kind: "matter", number: target.number } },
      },
      member,
    );
    expect(made.statusCode, made.body).toBe(201);
    generationId = made.json().generation.id;
    expect(made.json().generation).toMatchObject({
      state: "ready",
      hasDocx: true,
      filingPending: false,
      filingFailure: { code: "filing_failed" },
    });
    expect(
      await h.db.select().from(autoDocFilings).where(eq(autoDocFilings.generationId, generationId)),
    ).toEqual([]);
    expect(await h.db.select().from(documents).where(eq(documents.matterId, target.id))).toEqual(
      [],
    );
  } finally {
    await h.db.execute(sql`ALTER TABLE document_versions DROP CONSTRAINT test_refuse_filing`);
  }
  const next = await destination("contract");
  const made = await file({ ...prepared, generationId }, { kind: "contract", number: next.number });
  expect(made.statusCode, made.body).toBe(201);
  const [after] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generationId));
  expect(after!.requestedFiling).toBeNull();
  expect(after!.filingFailure).toBeNull();
  expect(
    (await get(`/auto-docs/${prepared.id}/generations/${generationId}/docx`, member)).statusCode,
  ).toBe(200);
});

it("rechecks a saved destination and is idempotent when the delivery work wakes twice", async () => {
  const source = await generation();
  const target = await destination("matter");
  const id = crypto.randomUUID();
  await h.db
    .update(autoDocGenerations)
    .set({
      requestedFiling: {
        id,
        destination: { kind: "matter", number: target.number },
        format: "docx",
      },
    })
    .where(eq(autoDocGenerations.id, source.generationId));
  const log = { info() {}, warn() {}, error() {} };
  await Promise.all([
    fulfilRequestedFiling(h.app, log, source.generationId),
    fulfilRequestedFiling(h.app, log, source.generationId),
  ]);
  const filings = await h.db
    .select()
    .from(autoDocFilings)
    .where(eq(autoDocFilings.generationId, source.generationId));
  expect(filings).toHaveLength(1);
  expect(filings[0]!.id).toBe(id);
  expect((await post(`/matters/${target.number}/archive`, {})).statusCode).toBe(200);
  await h.db
    .update(autoDocGenerations)
    .set({
      requestedFiling: {
        id: crypto.randomUUID(),
        destination: { kind: "matter", number: target.number },
        format: "docx",
      },
    })
    .where(eq(autoDocGenerations.id, source.generationId));
  await fulfilRequestedFiling(h.app, log, source.generationId);
  const [after] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, source.generationId));
  expect(after!.filingFailure?.detail).toContain("Restore");
  expect(
    await h.db
      .select()
      .from(autoDocFilings)
      .where(eq(autoDocFilings.generationId, source.generationId)),
  ).toHaveLength(1);
});

it("binds generated Versions to their Filing owner and preserves history after Document erasure", async () => {
  const source = await generation();
  const target = await destination("matter");
  const other = await destination("matter");
  const made = await file(source, { kind: "matter", number: target.number });
  const documentId = made.json().filing.documentId;
  await expect(
    h.db.transaction(async (tx) => {
      await tx.update(documents).set({ matterId: other.id }).where(eq(documents.id, documentId));
    }),
  ).rejects.toThrow();
  await expect(
    h.db.transaction(async (tx) => {
      await tx.delete(autoDocFilings).where(eq(autoDocFilings.documentId, documentId));
    }),
  ).rejects.toThrow();
  await expect(
    h.db.transaction(async (tx) => {
      await tx
        .update(documentVersions)
        .set({ source: "uploaded", generatedFromGenerationId: null })
        .where(eq(documentVersions.documentId, documentId));
    }),
  ).rejects.toThrow();
  await h.db.transaction(async (tx) => {
    await tx.delete(documentVersions).where(eq(documentVersions.documentId, documentId));
    await tx.delete(documents).where(eq(documents.id, documentId));
  });
  const history = await get(
    `/auto-docs/${source.id}/generations/${source.generationId}/filings`,
    member,
  );
  expect(history.json().filings[0]).toMatchObject({
    documentId: null,
    target: { kind: "matter", number: target.number },
  });
});

it("stops calling a failed Generation's saved Filing pending while retaining its retry destination", async () => {
  const prepared = await prepare();
  const target = await destination("matter");
  h.fillEngine.failure = new Error("The fill worker stopped.");
  try {
    const made = await post(
      `/auto-docs/${prepared.id}/generations`,
      {
        ...prepared.pair,
        answers: { counterparty_name: "Interrupted supplier" },
        filing: { destination: { kind: "matter", number: target.number } },
      },
      member,
    );
    expect(made.statusCode, made.body).toBe(201);
    const generation = made.json().generation;
    expect(generation).toMatchObject({ state: "failed", filingPending: false });
    h.fillEngine.failure = null;
    const retried = await post(
      `/auto-docs/${prepared.id}/generations/${generation.id}/retry`,
      {},
      member,
    );
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json().generation).toMatchObject({
      id: generation.id,
      hasDocx: true,
      filingPending: false,
      filingFailure: null,
    });
    const history = await get(
      `/auto-docs/${prepared.id}/generations/${generation.id}/filings`,
      member,
    );
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().filings).toEqual([
      expect.objectContaining({
        generationId: generation.id,
        format: "docx",
        target: expect.objectContaining({ kind: "matter", number: target.number }),
      }),
    ]);
    const paper = await get(`/matters/${target.number}/documents`, member);
    expect(paper.statusCode, paper.body).toBe(200);
    expect(paper.json().documents).toEqual([
      expect.objectContaining({ id: history.json().filings[0].documentId }),
    ]);
  } finally {
    h.fillEngine.failure = null;
  }
});

it("hides a Generation from a Member who no longer reaches the Contract it created", async () => {
  const outsiderFixture = {
    email: "filing-outsider@example.com",
    displayName: "Outsider Member",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(h.app.auth, outsiderFixture);
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, person.id));
  const outsider = await signInCookies(h.app, outsiderFixture.email, outsiderFixture.password);
  const type = await post("/contract-types", { displayName: "Reach NDA" });
  const contractTypeId = type.json().contractType.id;
  const source = await generation(false, { targetContractTypeId: contractTypeId });
  const [created] = await h.db
    .select({ number: contracts.number })
    .from(contracts)
    .where(eq(contracts.createdByGenerationId, source.generationId));
  const path = `/auto-docs/${source.id}/generations/${source.generationId}`;
  expect((await get(path, outsider)).statusCode).toBe(200);
  expect((await get(`${path}/docx`, outsider)).statusCode).toBe(200);

  const hidden = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${created!.number}`,
    cookies: admin,
    payload: { isConfidential: true },
  });
  expect(hidden.statusCode, hidden.body).toBe(200);

  expect((await get(path, outsider)).statusCode).toBe(404);
  expect((await get(`${path}/docx`, outsider)).statusCode).toBe(404);
  expect((await get(`${path}/filings`, outsider)).statusCode).toBe(404);
  const listed = await get(`/auto-docs/${source.id}/generations`, outsider);
  expect(listed.statusCode).toBe(200);
  expect(listed.json().generations.map((row: { id: string }) => row.id)).not.toContain(
    source.generationId,
  );
  const target = await destination("matter");
  expect(
    (
      await post(
        `${path}/filings`,
        { destination: { kind: "matter", number: target.number } },
        outsider,
      )
    ).statusCode,
  ).toBe(404);
  expect((await post(`${path}/retry`, {}, outsider)).statusCode).toBe(404);
  // The generating Member is on the created Contract's team and keeps reach.
  expect((await get(path, member)).statusCode).toBe(200);
  expect(
    (
      await post(
        `${path}/filings`,
        { destination: { kind: "matter", number: target.number } },
        member,
      )
    ).statusCode,
  ).toBe(201);
});
