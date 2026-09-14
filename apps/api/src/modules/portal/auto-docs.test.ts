// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-008 through ADO-010: Portal audience, acknowledgement, and owned Generations over Postgres. */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, and, eq, users, contracts, entities, entityTypes } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

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
      email: `portal-auto-doc-${index}@example.com`,
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
  const made = await post("/auto-docs", { name: "Portal approved NDA" });
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().autoDoc.id as string;
  const configured = await patch(id, {
    audience: "everyone",
    acknowledgementFrequency: frequency,
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
const formFor = (id: string, person = 0, acknowledgementId?: string) =>
  get(
    `/portal/auto-docs/${id}/generate${acknowledgementId ? `?acknowledgementId=${acknowledgementId}` : ""}`,
    buyers[person]!.cookies,
  );
async function acknowledge(id: string, person = 0) {
  const form = await formFor(id, person);
  expect(form.statusCode, form.body).toBe(200);
  const response = await post(
    `/portal/auto-docs/${id}/acknowledgements`,
    { textHash: form.json().acknowledgement.textHash },
    buyers[person]!.cookies,
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json().acknowledgementId as string;
}
const generate = (
  prepared: Awaited<ReturnType<typeof prepare>>,
  acknowledgementId?: string,
  person = 0,
) =>
  post(
    `/portal/auto-docs/${prepared.id}/generations`,
    {
      ...prepared.pair,
      answers: { counterparty_name: "Portal supplier", signing_date: "2026-10-01" },
      ...(acknowledgementId ? { acknowledgementId } : {}),
    },
    buyers[person]!.cookies,
  );

it("shows Word while PDF is pending, then offers both downloads and emails the files", async () => {
  const prepared = await prepare("none", { formats: "both", name: "Portal delivered NDA" });
  const made = await generate(prepared);
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().generation.id;
  const path = `/portal/auto-docs/${prepared.id}/generations/${id}`;
  expect(made.json().generation).toMatchObject({
    hasDocx: true,
    hasPdf: false,
    emailState: "pending",
  });
  const word = await get(`${path}/docx`);
  expect(word.statusCode).toBe(200);
  expect((await get(`${path}/pdf`)).statusCode).toBe(409);
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
    .poll(async () => (await get(path)).json().generation.emailState, { timeout: 20_000 })
    .toBe("sent");
  const pdf = await get(`${path}/pdf`);
  expect(pdf.statusCode).toBe(200);
  const message = h.mailer
    .messagesTo("portal-auto-doc-0@example.com")
    .find((mail) => mail.subject.includes("Portal delivered NDA"));
  expect(message?.attachments).toEqual([
    expect.objectContaining({ filename: "Portal delivered NDA.docx", content: word.rawPayload }),
    expect.objectContaining({ filename: "Portal delivered NDA.pdf", content: pdf.rawPayload }),
  ]);
  await worker.stop();
  worker = undefined;
});

it("audits audience lists and resolves direct users and live Departments on every read", async () => {
  const prepared = await prepare();
  const saved = await patch(prepared.id, {
    audience: "selected",
    audienceUserIds: [buyers[0]!.id],
    audienceDepartmentIds: [salesId],
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toMatchObject({
    audienceUserIds: [buyers[0]!.id],
    audienceDepartmentIds: [salesId],
  });
  for (const buyer of buyers)
    expect(
      (await get("/portal/auto-docs", buyer.cookies))
        .json()
        .autoDocs.map((row: { id: string }) => row.id),
    ).toContain(prepared.id);
  const archived = await post(`/departments/${salesId}/archive`, {});
  expect(archived.statusCode, archived.body).toBe(200);
  expect((await formFor(prepared.id, 0)).statusCode).toBe(200);
  expect((await formFor(prepared.id, 1)).statusCode).toBe(404);
  expect((await patch(prepared.id, { audience: "everyone" })).statusCode).toBe(200);
  expect((await formFor(prepared.id, 1)).statusCode).toBe(200);
  expect((await patch(prepared.id, { audience: "legal_only" })).statusCode).toBe(200);
  expect((await formFor(prepared.id, 0)).statusCode).toBe(404);
  expect((await get(`/auto-docs/${prepared.id}`, member)).statusCode).toBe(200);
  const audit = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, prepared.id), eq(activityLog.action, "auto_doc.updated")));
  expect(audit.some((row) => Object.hasOwn(row.payload.changed as object, "audienceUsers"))).toBe(
    true,
  );
});

it.each(["none", "every_use", "once_per_auto_doc", "once"])(
  "gates %s across two Auto-Docs and two people",
  async (frequency) => {
    const first = await prepare(frequency);
    const second = await prepare(frequency);
    const initial = await formFor(first.id);
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json().acknowledgement.required).toBe(frequency !== "none");
    if (frequency !== "none") expect(initial.json().form).toBeNull();
    const id = frequency === "none" ? undefined : await acknowledge(first.id);
    const allowed = await formFor(first.id, 0, id);
    expect(allowed.json().acknowledgement.required).toBe(false);
    expect(allowed.json().form.fields[0].slug).toBe("counterparty_name");
    expect((await formFor(first.id, 1)).json().acknowledgement.required).toBe(frequency !== "none");
    expect((await formFor(second.id)).json().acknowledgement.required).toBe(
      !["none", "once"].includes(frequency),
    );
    const made = await generate(first, id);
    expect(made.statusCode, made.body).toBe(201);
    const again = await generate(first, id);
    expect(again.statusCode, again.body).toBe(frequency === "every_use" ? 409 : 201);
  },
);

it("records the exact words at admin-only visibility and invalidates standing acknowledgements on text edits", async () => {
  const prepared = await prepare("once_per_auto_doc", {
    acknowledgementText: "Do not edit this NDA.\nAsk Legal for changes.",
  });
  await acknowledge(prepared.id);
  const audit = await h.db
    .select()
    .from(activityLog)
    .where(
      and(eq(activityLog.entityId, prepared.id), eq(activityLog.action, "auto_doc.acknowledged")),
    );
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    visibility: "admin_only",
    actorId: buyers[0]!.id,
    payload: { text: "Do not edit this NDA.\nAsk Legal for changes." },
  });
  expect((await formFor(prepared.id)).json().acknowledgement.required).toBe(false);
  expect(
    (await patch(prepared.id, { acknowledgementText: "Use these new approved words." })).statusCode,
  ).toBe(200);
  expect((await formFor(prepared.id)).json().acknowledgement.required).toBe(true);
  expect(
    (
      await patch(prepared.id, {
        acknowledgementText: "Do not edit this NDA.\nAsk Legal for changes.",
      })
    ).statusCode,
  ).toBe(200);
  expect((await formFor(prepared.id)).json().acknowledgement.required).toBe(true);
  const staff = await get(`/portal/auto-docs/${prepared.id}/generate`, member);
  expect(staff.statusCode, staff.body).toBe(200);
  expect(staff.json().acknowledgement.required).toBe(false);
});

it("allows only one Generation to consume an every-use acknowledgement", async () => {
  const prepared = await prepare("every_use");
  const id = await acknowledge(prepared.id);
  const results = await Promise.all([generate(prepared, id), generate(prepared, id)]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
});

it("preserves owned Generation history after Unpublish and Archive, and refuses another person's file", async () => {
  const prepared = await prepare();
  const made = await generate(prepared);
  expect(made.statusCode, made.body).toBe(201);
  const generationId = made.json().generation.id;
  const path = `/portal/auto-docs/${prepared.id}/generations/${generationId}`;
  expect((await get(path, buyers[1]!.cookies)).statusCode).toBe(404);
  expect((await get(`${path}/docx`, buyers[1]!.cookies)).statusCode).toBe(404);
  for (const action of ["unpublish", "archive"]) {
    expect((await post(`/auto-docs/${prepared.id}/${action}`, {})).statusCode).toBe(200);
    expect(
      (await get("/portal/auto-docs")).json().autoDocs.map((row: { id: string }) => row.id),
    ).not.toContain(prepared.id);
    const history = await get("/portal/auto-doc-generations");
    expect(history.json().generations.map((row: { id: string }) => row.id)).toContain(generationId);
    expect((await get(path)).statusCode).toBe(200);
    expect((await get(`${path}/docx`)).statusCode).toBe(200);
    expect((await generate(prepared)).statusCode).toBe(409);
  }
});

it("refuses missing required answers and stale pairs without accepting a Generation", async () => {
  const prepared = await prepare();
  const empty = await post(
    `/portal/auto-docs/${prepared.id}/generations`,
    { ...prepared.pair, answers: {} },
    buyers[0]!.cookies,
  );
  expect(empty.statusCode, empty.body).toBe(400);
  const stale = await post(
    `/portal/auto-docs/${prepared.id}/generations`,
    {
      ...prepared.pair,
      formVersionId: "old-form",
      answers: { counterparty_name: "Keep this answer" },
    },
    buyers[0]!.cookies,
  );
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().detail).toContain("changed");
});

it("requires Administrator access for the default text and invalidates agreements when it changes", async () => {
  const prepared = await prepare("once");
  await acknowledge(prepared.id);
  const original = (await get("/auto-docs/settings", admin)).json().acknowledgementText;
  for (const cookies of [buyers[0]!.cookies, member])
    expect(
      (
        await h.app.inject({
          method: "PUT",
          url: "/api/v1/auto-docs/settings",
          payload: { acknowledgementText: "New words." },
          cookies,
        })
      ).statusCode,
    ).toBe(403);
  for (const text of ["Use only the new approved words.", original]) {
    const saved = await h.app.inject({
      method: "PUT",
      url: "/api/v1/auto-docs/settings",
      payload: { acknowledgementText: text },
      cookies: admin,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await formFor(prepared.id)).json().acknowledgement).toMatchObject({
      text,
      required: true,
    });
  }
});

it("refuses stale text, another person's acknowledgement, and keeps an every-use acknowledgement after invalid answers", async () => {
  const prepared = await prepare("every_use");
  const current = (await formFor(prepared.id)).json().acknowledgement;
  expect(
    (
      await post(
        `/portal/auto-docs/${prepared.id}/acknowledgements`,
        { textHash: "b".repeat(64) },
        buyers[0]!.cookies,
      )
    ).statusCode,
  ).toBe(409);
  const ack = await acknowledge(prepared.id);
  expect((await generate(prepared, ack, 1)).statusCode).toBe(409);
  const invalid = await post(
    `/portal/auto-docs/${prepared.id}/generations`,
    { ...prepared.pair, answers: {}, acknowledgementId: ack },
    buyers[0]!.cookies,
  );
  expect(invalid.statusCode, invalid.body).toBe(400);
  expect((await formFor(prepared.id, 0, ack)).json().acknowledgement).toMatchObject({
    required: false,
    textHash: current.textHash,
  });
  expect((await generate(prepared, ack)).statusCode).toBe(201);
});

it("withdraws owned history and downloads when the audience is revoked", async () => {
  const prepared = await prepare();
  const made = await generate(prepared);
  const id = made.json().generation.id;
  expect((await patch(prepared.id, { audience: "legal_only" })).statusCode).toBe(200);
  const path = `/portal/auto-docs/${prepared.id}/generations/${id}`;
  expect((await get(path)).statusCode).toBe(404);
  expect((await get(`${path}/docx`)).statusCode).toBe(404);
  expect(
    (await get("/portal/auto-doc-generations"))
      .json()
      .generations.some((row: { id: string }) => row.id === id),
  ).toBe(false);
});

async function entityFixture() {
  const [type] = await h.db.select().from(entityTypes).limit(1);
  const [listed, privateEntity] = await h.db
    .insert(entities)
    .values([
      { entityTypeId: type!.id, legalName: "Portal-visible Entity", portalListed: true },
      { entityTypeId: type!.id, legalName: "Internal-only Entity", portalListed: false },
    ])
    .returning();
  return { listed: listed!, privateEntity: privateEntity! };
}

it("offers only Portal-listed Entity names, requires an authored Entity answer, and refuses a forged choice", async () => {
  const prepared = await prepare();
  const { listed, privateEntity } = await entityFixture();
  const form = await post(`/auto-docs/${prepared.id}/form-versions`, {
    fields: [
      { slug: "counterparty_name", label: "Counterparty", fieldType: "text", required: true },
      { slug: "signing_date", label: "Signing date", fieldType: "date" },
      { slug: "entity", label: "Entity", fieldType: "entity", required: true },
    ],
  });
  expect(form.statusCode, form.body).toBe(201);
  prepared.pair.formVersionId = form.json().formVersion.id;
  expect((await post(`/auto-docs/${prepared.id}/publish`, prepared.pair)).statusCode).toBe(200);
  const loaded = (await formFor(prepared.id)).json();
  expect(loaded.form.entities).toContainEqual({ id: listed.id, name: listed.legalName });
  expect(loaded.form.entities.some((row: { id: string }) => row.id === privateEntity.id)).toBe(
    false,
  );
  expect((await generate(prepared)).statusCode).toBe(400);
  for (const [entity, status] of [
    [privateEntity.id, 400],
    [listed.id, 201],
  ] as const) {
    const response = await post(
      `/portal/auto-docs/${prepared.id}/generations`,
      { ...prepared.pair, answers: { counterparty_name: "Acme", entity } },
      buyers[0]!.cookies,
    );
    expect(response.statusCode, response.body).toBe(status);
  }
});

it("warns Legal about a private fixed Entity, then generates a targeted Contract with the Business User as Business Owner", async () => {
  const prepared = await prepare();
  const { listed, privateEntity } = await entityFixture();
  const type = await post("/contract-types", { displayName: "Portal generated NDA" });
  expect(type.statusCode, type.body).toBe(201);
  const configured = await patch(prepared.id, {
    targetContractTypeId: type.json().contractType.id,
    fixedEntityId: privateEntity.id,
  });
  expect(configured.statusCode, configured.body).toBe(200);
  expect(configured.json().portalWarnings.join(" ")).toContain("Portal-listed");
  const refused = await formFor(prepared.id);
  expect(refused.json()).toMatchObject({ form: null, availability: { ready: false } });
  expect(refused.body).not.toContain(privateEntity.legalName);
  expect((await generate(prepared)).statusCode).toBe(409);
  expect((await patch(prepared.id, { fixedEntityId: listed.id })).statusCode).toBe(200);
  const shown = await formFor(prepared.id);
  expect(
    shown.json().form.fields.some((field: { fieldType: string }) => field.fieldType === "entity"),
  ).toBe(false);
  expect(shown.json().form).not.toHaveProperty("businessOwners");
  const made = await generate(prepared);
  expect(made.statusCode, made.body).toBe(201);
  const generated = made.json().generation;
  expect(generated.createdContract).not.toBeNull();
  const [contract] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, generated.createdContract.id));
  expect(contract).toMatchObject({
    entityId: listed.id,
    businessOwnerId: buyers[0]!.id,
    createdBy: buyers[0]!.id,
  });
  expect((await get(`/portal/contracts/${generated.createdContract.number}`)).statusCode).toBe(200);
  const spoof = await post(
    `/portal/auto-docs/${prepared.id}/generations`,
    { ...prepared.pair, answers: { counterparty_name: "Acme" }, businessOwnerId: buyers[1]!.id },
    buyers[0]!.cookies,
  );
  expect(spoof.statusCode).toBe(400);
});

it.each(["everyone", "legal_only"])(
  "reports a draft/live Assignment gap for the %s audience",
  async (audience) => {
    const type = await post("/contract-types", { displayName: "Assignment gap NDA" });
    expect(type.statusCode).toBe(201);
    const prepared = await prepare("none", { targetContractTypeId: type.json().contractType.id });
    expect((await patch(prepared.id, { audience })).statusCode).toBe(200);
    const draft = await post(`/auto-docs/${prepared.id}/form-versions`, {
      fields: [
        { slug: "counterparty_name", label: "Counterparty", fieldType: "text" },
        { slug: "signing_date", label: "Signing date", fieldType: "date" },
        { slug: "new_region", label: "New region", fieldType: "text" },
      ],
    });
    expect(draft.statusCode).toBe(201);
    const [legal] = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
    const rules = await h.app.inject({
      method: "PUT",
      url: `/api/v1/auto-docs/${prepared.id}/assignment-rules`,
      cookies: admin,
      payload: {
        defaultLegalOwnerId: null,
        rules: [
          { fieldSlug: "new_region", operator: "is_set", value: null, legalOwnerId: legal!.id },
        ],
      },
    });
    expect(rules.statusCode, rules.body).toBe(200);
    expect(rules.json().portalWarnings.join(" ")).toContain("Publish a Form");
    if (audience === "legal_only") return;
    const shown = await formFor(prepared.id);
    expect(shown.json().availability.ready).toBe(false);
    expect(shown.body).not.toContain("new_region");
    expect((await patch(prepared.id, { targetContractTypeId: null })).statusCode).toBe(200);
    expect((await formFor(prepared.id)).json().availability.ready).toBe(true);
  },
);

it("pages owned Generation history without gaps or duplicates", async () => {
  const prepared = await prepare();
  const ids: string[] = [];
  for (let index = 0; index < 51; index++) {
    const made = await generate(prepared);
    expect(made.statusCode, made.body).toBe(201);
    ids.push(made.json().generation.id);
  }
  const first = (await get("/portal/auto-doc-generations")).json();
  expect(first.generations).toHaveLength(50);
  expect(first.generations.map((row: { id: string }) => row.id)).toEqual(ids.slice(1).reverse());
  const second = (await get(`/portal/auto-doc-generations?before=${first.nextCursor}`)).json();
  expect(second.generations[0].id).toBe(ids[0]);
  const firstIds = new Set(first.generations.map((row: { id: string }) => row.id));
  expect(second.generations.some((row: { id: string }) => firstIds.has(row.id))).toBe(false);
});

it("a per-Auto-Doc text edit preserves another Auto-Doc's once-per-Auto-Doc acknowledgement", async () => {
  const first = await prepare("once_per_auto_doc", {
    acknowledgementText: "Shared original statement.",
  });
  const second = await prepare("once_per_auto_doc", {
    acknowledgementText: "Shared original statement.",
  });
  await acknowledge(first.id);
  await acknowledge(second.id);
  expect(
    (await patch(first.id, { acknowledgementText: "First Auto-Doc's new statement." })).statusCode,
  ).toBe(200);
  expect((await formFor(first.id)).json().acknowledgement.required).toBe(true);
  expect((await formFor(second.id)).json().acknowledgement.required).toBe(false);
});
