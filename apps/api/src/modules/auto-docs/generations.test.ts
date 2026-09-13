// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-007: Generations cite the submitted pair and keep their own output. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  autoDocGenerations,
  autoDocs,
  documents,
  entities,
  entityTypes,
  eq,
  sql,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { templateTextParts } from "../../lib/auto-doc-template.js";
import { AutoDocFillError } from "../../lib/auto-doc-fill/engine.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let member: Record<string, string>;
let memberId: string;
let business: Record<string, string>;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  for (const role of ["legal_team_member", "business_user"] as const) {
    const person = await provisionUser(h.app.auth, {
      email: `generation-${role}@example.com`,
      displayName: role,
      password: "correct-horse-battery",
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    const cookies = await signInCookies(
      h.app,
      `generation-${role}@example.com`,
      "correct-horse-battery",
    );
    if (role === "legal_team_member") {
      member = cookies;
      memberId = person.id;
    } else business = cookies;
  }
});
afterAll(async () => {
  await h.stop();
});
const field = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  label: slug,
  fieldType: "text",
  ...extra,
});
/** DOC-012 mints a fresh key for each attempt, so a cleaned-up fill is
 * proved by an empty Generation directory rather than by one named key. */
async function storedBlobs(generationId: string) {
  return readdir(join(h.storageRoot, "auto-doc-generations", generationId)).catch(() => []);
}
async function call(
  id: string,
  suffix: string,
  payload?: Record<string, unknown>,
  cookies = member,
) {
  return h.app.inject({
    method: payload === undefined ? "GET" : "POST",
    url: `/api/v1/auto-docs/${id}/${suffix}`,
    cookies,
    ...(payload === undefined ? {} : { payload }),
  });
}
async function prepare(
  fields = [
    field("counterparty_name", { required: true }),
    field("signing_date", { fieldType: "date" }),
  ],
) {
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies: member,
    payload: { name: "Generation NDA" },
  });
  const id: string = created.json().autoDoc.id;
  const settings = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies: member,
    payload: { formats: "docx" },
  });
  expect(settings.statusCode, settings.body).toBe(200);
  const bytes = await readFile(
    new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url),
  );
  const uploaded = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies: member,
    headers: { "content-type": "multipart/form-data; boundary=generation" },
    payload: Buffer.concat([
      Buffer.from(
        '--generation\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--generation--\r\n"),
    ]),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const saved = await call(id, "form-versions", { fields });
  expect(saved.statusCode, saved.body).toBe(201);
  const pair = {
    documentVersionId: uploaded.json().template.versions[0].id as string,
    formVersionId: saved.json().formVersion.id as string,
  };
  expect((await call(id, "publish", pair)).statusCode).toBe(200);
  return { id, pair };
}

it("loads the live form, generates from that pair, and serves a separate immutable output", async () => {
  const { id, pair } = await prepare();
  await call(id, "form-versions", { fields: [field("later_only")] });
  const form = await call(id, "generate");
  expect(form.statusCode, form.body).toBe(200);
  expect(form.json()).toMatchObject({ autoDoc: { id, name: "Generation NDA" }, pair });
  expect(form.json().fields.map((item: { slug: string }) => item.slug)).toEqual([
    "counterparty_name",
    "signing_date",
  ]);
  const before = await h.db.select({ id: documents.id }).from(documents);
  const answers = { counterparty_name: "Acme", signing_date: "2026-09-13" };
  const made = await call(id, "generations", { ...pair, answers });
  expect(made.statusCode, made.body).toBe(201);
  const generation = made.json().generation;
  expect(generation).toMatchObject({
    autoDocId: id,
    ...pair,
    answers,
    state: "ready",
    generatedBy: memberId,
    failure: null,
  });
  expect(await h.db.select({ id: documents.id }).from(documents)).toEqual(before);
  const downloaded = await call(id, `generations/${generation.id}/docx`);
  expect(downloaded.statusCode, downloaded.body).toBe(200);
  expect(JSON.parse(templateTextParts(downloaded.rawPayload)[0]!.text).answers).toEqual(answers);
  expect(downloaded.headers["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  expect(downloaded.headers["content-disposition"]).toContain("Generation NDA.docx");
  const list = await call(id, "generations");
  expect(list.json().generations).toEqual([
    expect.objectContaining({
      id: generation.id,
      state: "ready",
      person: { id: memberId, displayName: "legal_team_member" },
      documentVersionNumber: 1,
      formVersionNumber: 2,
    }),
  ]);
  const activity = await h.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=auto_doc&entityId=${id}`,
    cookies: member,
  });
  expect(
    activity.json().entries.find((row: { action: string }) => row.action === "auto_doc.generated"),
  ).toMatchObject({
    payload: {
      name: "Generation NDA",
      generationId: generation.id,
      ...pair,
      personId: memberId,
      personName: "legal_team_member",
    },
  });
});

it("validates required answers and every field type before creating a Generation", async () => {
  const { id, pair } = await prepare([
    field("counterparty_name", { required: true }),
    field("signing_date", { fieldType: "date" }),
    field("count", { fieldType: "number" }),
    field("amount", { fieldType: "currency" }),
    field("agreed", { fieldType: "boolean" }),
    field("region", { fieldType: "single_select", options: ["US", "UK"] }),
    field("countries", { fieldType: "multi_select", options: ["US", "UK"] }),
    field("entity", { fieldType: "entity" }),
  ]);
  for (const answers of [
    {},
    { counterparty_name: " " },
    { counterparty_name: 7 },
    { counterparty_name: "Acme", signing_date: "2026-02-31" },
    { counterparty_name: "Acme", count: "3" },
    { counterparty_name: "Acme", amount: "USD" },
    { counterparty_name: "Acme", agreed: "yes" },
    { counterparty_name: "Acme", region: "FR" },
    { counterparty_name: "Acme", countries: ["US", "US"] },
    { counterparty_name: "Acme", entity: "missing" },
    { counterparty_name: "Acme", extra: "unknown" },
  ]) {
    const refused = await call(id, "generations", { ...pair, answers });
    expect(refused.statusCode, refused.body).toBe(400);
  }
  expect((await call(id, "generations")).json().generations).toEqual([]);
  const made = await call(id, "generations", {
    ...pair,
    answers: {
      counterparty_name: "Acme",
      signing_date: "2026-09-13",
      count: 0,
      amount: 1234.56,
      agreed: false,
      region: "US",
      countries: ["UK", "US"],
    },
  });
  expect(made.statusCode, made.body).toBe(201);
  expect(made.json().generation.answers).toMatchObject({
    count: 0,
    agreed: false,
    countries: ["US", "UK"],
  });
});

it("names a changed pair and every unpublished state, and preserves old Generations", async () => {
  const { id, pair } = await prepare();
  const original = await call(id, "generations", {
    ...pair,
    answers: { counterparty_name: "Acme" },
  });
  const generationId = original.json().generation.id;
  const saved = await call(id, "form-versions", {
    fields: [field("counterparty_name"), field("signing_date")],
  });
  const newPair = { ...pair, formVersionId: saved.json().formVersion.id };
  await call(id, "publish", newPair);
  const stale = await call(id, "generations", {
    ...pair,
    answers: { counterparty_name: "Keep my answer" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().detail).toContain("changed");
  for (const action of ["unpublish", "archive", "restore"]) {
    expect((await call(id, action, {})).statusCode).toBe(200);
    const refused = await call(id, "generations", {
      ...newPair,
      answers: { counterparty_name: "Keep my answer" },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().detail).toContain("not published");
    expect((await call(id, `generations/${generationId}/docx`)).statusCode).toBe(200);
  }
});

it("records a failed fill with its reason and no output file", async () => {
  const { id, pair } = await prepare();
  h.fillEngine.failure = new AutoDocFillError("The Word fill timed out. Try again.");
  try {
    const made = await call(id, "generations", { ...pair, answers: { counterparty_name: "Acme" } });
    expect(made.statusCode, made.body).toBe(201);
    const generation = made.json().generation;
    expect(generation).toMatchObject({
      state: "failed",
      failure: { detail: "The Word fill timed out. Try again." },
    });
    const [stored] = await h.db
      .select()
      .from(autoDocGenerations)
      .where(eq(autoDocGenerations.id, generation.id));
    expect(stored!.docxFileRef).toBeNull();
    expect(await storedBlobs(generation.id)).toEqual([]);
    expect((await call(id, `generations/${generation.id}/docx`)).statusCode).toBe(409);
    expect((await call(id, "generations")).json().generations[0]).toMatchObject({
      state: "failed",
      failure: { detail: "The Word fill timed out. Try again." },
    });
  } finally {
    h.fillEngine.failure = null;
  }
});

it("keeps app Generation routes Member+ and refuses a Generation under another Auto-Doc", async () => {
  const { id, pair } = await prepare();
  const made = await call(id, "generations", { ...pair, answers: { counterparty_name: "Acme" } });
  const generationId = made.json().generation.id;
  for (const suffix of [
    "generate",
    "generations",
    `generations/${generationId}`,
    `generations/${generationId}/docx`,
    `generations/${generationId}/pdf`,
  ])
    expect((await call(id, suffix, undefined, business)).statusCode).toBe(403);
  expect((await call(id, "generations", { ...pair, answers: {} }, business)).statusCode).toBe(403);
  expect((await call(id, `generations/${generationId}/retry`, {}, business)).statusCode).toBe(403);
  const other = await prepare();
  expect((await call(other.id, `generations/${generationId}/retry`, {})).statusCode).toBe(404);
  expect((await call(other.id, `generations/${generationId}/pdf`)).statusCode).toBe(404);
  expect((await call(other.id, `generations/${generationId}`)).statusCode).toBe(404);
  expect((await call(other.id, `generations/${generationId}/docx`)).statusCode).toBe(404);
});

it("enforces the Generation pair's ownership in Postgres, including later reparenting", async () => {
  const a = await prepare();
  const b = await prepare();
  await expect(
    h.db.insert(autoDocGenerations).values({
      autoDocId: a.id,
      documentVersionId: a.pair.documentVersionId,
      formVersionId: b.pair.formVersionId,
      generatedBy: memberId,
      answers: {},
    }),
  ).rejects.toThrow();
  await call(a.id, "generations", { ...a.pair, answers: { counterparty_name: "Acme" } });
  await call(a.id, "unpublish", {});
  await expect(
    h.db.transaction(async (tx) => {
      await tx.update(autoDocs).set({ templateDocumentId: null }).where(eq(autoDocs.id, a.id));
      await tx.execute(sql`update documents set auto_doc_id = ${b.id} where auto_doc_id = ${a.id}`);
    }),
  ).rejects.toThrow();
});

it("offers only live reachable Entities and prints their names while storing ids", async () => {
  const [type] = await h.db.select().from(entityTypes).limit(1);
  const [open, confidential, archived] = await h.db
    .insert(entities)
    .values([
      { legalName: "Generation Open Entity", entityTypeId: type!.id },
      { legalName: "Generation Confidential Entity", entityTypeId: type!.id, isConfidential: true },
      { legalName: "Generation Archived Entity", entityTypeId: type!.id, archivedAt: new Date() },
    ])
    .returning();
  const { id, pair } = await prepare([
    field("counterparty_name"),
    field("signing_date"),
    field("our_entity", { fieldType: "entity", required: true }),
  ]);
  const form = await call(id, "generate");
  const options = form.json().entities;
  expect(options).toContainEqual({ id: open!.id, name: open!.legalName });
  expect(options.map((option: { id: string }) => option.id)).not.toContain(confidential!.id);
  expect(options.map((option: { id: string }) => option.id)).not.toContain(archived!.id);
  for (const entity of [confidential!, archived!])
    expect(
      (await call(id, "generations", { ...pair, answers: { our_entity: entity.id } })).statusCode,
    ).toBe(400);
  const made = await call(id, "generations", { ...pair, answers: { our_entity: open!.id } });
  expect(made.statusCode, made.body).toBe(201);
  expect(made.json().generation.answers.our_entity).toBe(open!.id);
  const downloaded = await call(id, `generations/${made.json().generation.id}/docx`);
  expect(downloaded.statusCode).toBe(200);
  expect(JSON.parse(templateTextParts(downloaded.rawPayload)[0]!.text)).toMatchObject({
    answers: { our_entity: open!.id },
    displayValues: { our_entity: open!.legalName },
  });
});

it("requires a failed Generation to have a named, nonempty failure", async () => {
  const { id, pair } = await prepare();
  for (const failure of [
    null,
    [],
    {},
    { code: "fill_failed" },
    { code: "", detail: "Reason" },
    { code: "fill_failed", detail: " " },
    { code: 7, detail: "Reason" },
  ]) {
    await expect(
      h.db.execute(sql`
      insert into auto_doc_generations
        (id, auto_doc_id, document_version_id, form_version_id, generated_by, answers, state, failure)
      values
        (${crypto.randomUUID()}, ${id}, ${pair.documentVersionId}, ${pair.formVersionId}, ${memberId}, '{}', 'failed', ${JSON.stringify(failure)}::jsonb)
    `),
    ).rejects.toThrow();
  }
});

it("removes a completed blob when recording its ready state fails", async () => {
  const { id, pair } = await prepare();
  await h.db.execute(
    sql`create function refuse_generation_ready() returns trigger language plpgsql as $$ begin if NEW.state = 'ready' then raise exception 'forced ready failure'; end if; return NEW; end; $$`,
  );
  await h.db.execute(
    sql`create trigger refuse_generation_ready before update on auto_doc_generations for each row execute function refuse_generation_ready()`,
  );
  try {
    const made = await call(id, "generations", { ...pair, answers: { counterparty_name: "Acme" } });
    expect(made.statusCode, made.body).toBe(201);
    const generation = made.json().generation;
    expect(generation).toMatchObject({ state: "failed", hasDocx: false });
    expect(await storedBlobs(generation.id)).toEqual([]);
  } finally {
    await h.db.execute(sql`drop trigger refuse_generation_ready on auto_doc_generations`);
    await h.db.execute(sql`drop function refuse_generation_ready()`);
  }
});
