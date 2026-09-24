// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  apiKeyRequests,
  autoDocGenerations,
  autoDocGenerationOrigins,
  activityLog,
  entities,
  entityTypes,
  contracts,
  contractTeam,
  users,
  orgSettings,
  eq,
  and,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
let h: TestHarness;
let admin: Record<string, string>;
let legalCookies: Record<string, string>;
let businessCookies: Record<string, string>;
let legalId: string;
let businessId: string;
let legal: Client;
let business: Client;
let readOnly: Client;
const clients: Client[] = [];
const credentialIds = new Map<Client, string>();
const post = (path: string, payload: Record<string, unknown>, cookies = admin) =>
  h.app.inject({ method: "POST", url: `/api/v1${path}`, payload, cookies });
const patch = (id: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "PATCH", url: `/api/v1/auto-docs/${id}`, payload, cookies: admin });
beforeAll(async () => {
  h = await startHarness({ runPipelineWorkers: false });
  await post("/auth/setup", TEST_ADMIN);
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  for (const role of ["legal_team_member", "business_user"] as const) {
    const person = await provisionUser(h.app.auth, {
      email: `${role}@example.com`,
      displayName: role,
      password: TEST_ADMIN.password,
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    const cookies = await signInCookies(h.app, `${role}@example.com`, TEST_ADMIN.password);
    if (role === "business_user") {
      businessCookies = cookies;
      businessId = person.id;
    } else {
      legalCookies = cookies;
      legalId = person.id;
    }
    for (const scope of role === "business_user" ? ["write"] : ["write", "read"]) {
      const asked = await post(
        "/api-key-requests",
        { clientName: "Auto-Docs test", toolsets: ["auto-docs"], scope },
        cookies,
      );
      expect(asked.statusCode, asked.body).toBe(201);
      await post(`/api-key-requests/${asked.json().id}/approve`, {});
      const key = await h.app.inject({
        url: `/api/v1/api-key-requests/${asked.json().id}`,
        cookies,
      });
      const client = new Client({ name: "Auto-Docs test", version: "1" });
      const [credential] = await h.db
        .select()
        .from(apiKeyRequests)
        .where(eq(apiKeyRequests.id, asked.json().id));
      credentialIds.set(client, credential!.keyId!);
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(endpoint, {
          requestInit: { headers: { "x-api-key": key.json().key } },
        }),
      );
      if (role === "business_user") business = client;
      else if (scope === "read") readOnly = client;
      else legal = client;
    }
  }
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65536);
  return result.structuredContent as {
    autoDocs: { id: string }[];
    nextCursor: string | null;
    autoDocForm: {
      pair: { documentVersionId: string; formVersionId: string };
      fields: { slug: string; required: boolean }[];
      entities: { id: string }[];
    };
    generation: {
      id: string;
      state: string;
      answers: Record<string, unknown>;
      createdContract: { id: string } | null;
      downloads: { docx: string | null; pdf: string | null };
    };
    generations: { id: string; downloads: { docx: string | null; pdf: string | null } }[];
  };
}
async function refused(client: Client, name: string, args: Record<string, unknown>, code: string) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBe(true);
  expect(JSON.stringify(result)).toContain(code);
  return JSON.stringify(result);
}
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
    new URL("../testing/fixtures/auto-docs/plain.docx", import.meta.url),
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

it("offers all three Tools to both audiences and gates writes", async () => {
  for (const client of [legal, business])
    for (const name of ["auto_docs_list", "auto_doc_generate", "generations_list"])
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(`openlaw_${name}`);
  const p = await prepare();
  await refused(
    readOnly,
    "auto_doc_generate",
    { id: p.id, ...p.pair, answers: {} },
    "mcp_read_only",
  );
});
it("lists reached Auto-Docs with cursor pages and hides unpublished Portal entries", async () => {
  const p = await prepare();
  const hidden = await prepare("none", { audience: "legal_only" });
  expect((await call(business, "auto_docs_list")).autoDocs.map((r) => r.id)).toContain(p.id);
  expect((await call(business, "auto_docs_list")).autoDocs.map((r) => r.id)).not.toContain(
    hidden.id,
  );
  expect((await call(legal, "auto_docs_list")).autoDocs.map((r) => r.id)).toContain(hidden.id);
  const first = await call(business, "auto_docs_list", { limit: 1 });
  const second = await call(business, "auto_docs_list", { limit: 1, cursor: first.nextCursor });
  expect(second.autoDocs[0]!.id).not.toBe(first.autoDocs[0]!.id);
  await refused(business, "form_get", { kind: "auto_doc", typeId: hidden.id }, "not_found");
  await refused(
    business,
    "auto_doc_generate",
    { id: hidden.id, ...hidden.pair, answers: {} },
    "not_found",
  );
  await post(`/auto-docs/${p.id}/unpublish`, {});
  expect((await call(business, "auto_docs_list")).autoDocs.map((r) => r.id)).not.toContain(p.id);
});
it("refuses owed acknowledgements on read and generation and points at the Portal", async () => {
  const p = await prepare("once_per_auto_doc");
  const args = { id: p.id, ...p.pair, answers: { counterparty_name: "Acme" } };
  for (const [name, input] of [
    ["form_get", { kind: "auto_doc", typeId: p.id }],
    ["auto_doc_generate", args],
  ] as const) {
    const refusal = await refused(business, name, input, "acknowledgement_required");
    expect(refusal).toContain(`/portal/auto-docs/${p.id}/generate`);
    expect(refusal).toContain("Acknowledge the current text");
  }
  expect(
    await h.db.select().from(autoDocGenerations).where(eq(autoDocGenerations.autoDocId, p.id)),
  ).toHaveLength(0);
  const portal = await h.app.inject({
    url: `/api/v1/portal/auto-docs/${p.id}/generate`,
    cookies: businessCookies,
  });
  expect(portal.json().form).toBeNull();
  await post(
    `/portal/auto-docs/${p.id}/acknowledgements`,
    { textHash: portal.json().acknowledgement.textHash },
    businessCookies,
  );
  const form = await call(business, "form_get", { kind: "auto_doc", typeId: p.id });
  expect(form.autoDocForm.pair).toEqual(p.pair);
  expect((await call(business, "auto_doc_generate", args)).generation.state).toBe("ready");
  await h.db.update(orgSettings).set({ autoDocAcknowledgementFrequency: "every_use" });
  // An every-use acknowledgement is consumed by the Portal Generation it
  // precedes, so the refusal sends the whole Generation to the Portal.
  for (const [name, input] of [
    ["form_get", { kind: "auto_doc", typeId: p.id }],
    ["auto_doc_generate", args],
  ] as const) {
    const refusal = await refused(business, name, input, "acknowledgement_required");
    expect(refusal).toContain("at every use, so generate this Auto-Doc in the Portal at");
    expect(refusal).not.toContain("Acknowledge the current text");
  }
  const portalRefusal = await post(
    `/portal/auto-docs/${p.id}/generations`,
    { ...p.pair, answers: args.answers },
    businessCookies,
  );
  expect(portalRefusal.statusCode, portalRefusal.body).toBe(409);
  expect(portalRefusal.json()).toMatchObject({
    type: "urn:openlaw:problem:acknowledgement-required",
    frequency: "every_use",
  });
});
it("uses the UI form, validates answers and the pair, and produces the same output", async () => {
  const p = await prepare();
  for (const [client, cookies, prefix] of [
    [legal, legalCookies, ""],
    [business, businessCookies, "/portal"],
  ] as const) {
    const form = await call(client, "form_get", { kind: "auto_doc", typeId: p.id });
    const ui = await h.app.inject({ url: `/api/v1${prefix}/auto-docs/${p.id}/generate`, cookies });
    const uiForm = prefix ? ui.json().form : ui.json();
    expect(form.autoDocForm).toMatchObject({
      pair: uiForm.pair,
      fields: uiForm.fields,
      entities: uiForm.entities,
    });
    await refused(
      client,
      "auto_doc_generate",
      { id: p.id, ...p.pair, answers: {} },
      "validation_error",
    );
    await refused(
      client,
      "auto_doc_generate",
      {
        id: p.id,
        ...p.pair,
        formVersionId: crypto.randomUUID(),
        answers: { counterparty_name: "Acme" },
      },
      "conflict",
    );
    const answers = { counterparty_name: "Acme", signing_date: "2026-09-24" };
    const tool = (await call(client, "auto_doc_generate", { id: p.id, ...p.pair, answers }))
      .generation;
    const uiMade = await post(
      `${prefix}/auto-docs/${p.id}/generations`,
      { ...p.pair, answers },
      cookies,
    );
    expect(uiMade.statusCode, uiMade.body).toBe(201);
    expect(tool).toMatchObject({
      state: uiMade.json().generation.state,
      answers: uiMade.json().generation.answers,
    });
    const download = await h.app.inject({ url: tool.downloads.docx!, cookies });
    const uiDownload = await h.app.inject({
      url: `/api/v1${prefix}/auto-docs/${p.id}/generations/${uiMade.json().generation.id}/docx`,
      cookies,
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(uiDownload.rawPayload);
    expect(tool.downloads.pdf).toBeNull();
    const rows = await call(client, "generations_list");
    expect(rows.generations.map((r) => r.id)).toContain(tool.id);
    expect(JSON.stringify(rows)).not.toMatch(/fileRef|contractSnapshot|UEsDB/);
    const other = await call(client === legal ? business : legal, "generations_list");
    expect(other.generations.map((r) => r.id)).not.toContain(tool.id);
    const [activity] = await h.db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, p.id),
          eq(activityLog.action, "auto_doc.generated"),
          eq(activityLog.actorId, client === legal ? legalId : businessId),
        ),
      );
    expect(activity!.payload.generationId).toBe(tool.id);
    expect(activity).toMatchObject({
      viaKind: "api_key",
      viaId: credentialIds.get(client),
      viaClientName: "Auto-Docs test",
      visibility: "legal_only",
    });
  }
});
it("uses generationDefinition for targeted Entity fields and creates the same Contract as the Portal", async () => {
  const p = await prepare();
  const [entityType] = await h.db.select().from(entityTypes).limit(1);
  const [listed, privateEntity] = await h.db
    .insert(entities)
    .values([
      { entityTypeId: entityType!.id, legalName: "Listed Entity", portalListed: true },
      { entityTypeId: entityType!.id, legalName: "Private Entity", portalListed: false },
    ])
    .returning();
  const type = await post("/contract-types", { displayName: "Generated MCP NDA" });
  expect(type.statusCode, type.body).toBe(201);
  const form = await post(`/auto-docs/${p.id}/form-versions`, {
    fields: [
      { slug: "counterparty_name", label: "Counterparty", fieldType: "text", required: true },
      { slug: "signing_date", label: "Signing date", fieldType: "date" },
      {
        slug: "entity",
        label: "Entity",
        fieldType: "entity",
        required: true,
        contractAttribute: "entity",
      },
    ],
  });
  expect(form.statusCode, form.body).toBe(201);
  p.pair.formVersionId = form.json().formVersion.id;
  expect((await post(`/auto-docs/${p.id}/publish`, p.pair)).statusCode).toBe(200);
  expect(
    (await call(business, "form_get", { kind: "auto_doc", typeId: p.id })).autoDocForm.fields.find(
      (f) => f.slug === "entity",
    )!.required,
  ).toBe(true);
  expect(
    (
      await patch(p.id, {
        targetContractTypeId: type.json().contractType.id,
      })
    ).statusCode,
  ).toBe(200);
  const rules = await h.app.inject({
    method: "PUT",
    url: `/api/v1/auto-docs/${p.id}/assignment-rules`,
    cookies: admin,
    payload: { rules: [], defaultLegalOwnerId: legalId },
  });
  expect(rules.statusCode, rules.body).toBe(200);
  for (const [client, cookies, prefix] of [
    [legal, legalCookies, ""],
    [business, businessCookies, "/portal"],
  ] as const) {
    const toolForm = (await call(client, "form_get", { kind: "auto_doc", typeId: p.id }))
      .autoDocForm;
    const ui = await h.app.inject({ url: `/api/v1${prefix}/auto-docs/${p.id}/generate`, cookies });
    expect(toolForm).toMatchObject(
      prefix
        ? ui.json().form
        : { pair: ui.json().pair, fields: ui.json().fields, entities: ui.json().entities },
    );
    expect(toolForm.fields.find((f) => f.slug === "entity")!.required).toBe(false);
    expect(toolForm.entities.some((e) => e.id === privateEntity!.id)).toBe(client === legal);
  }
  await refused(
    business,
    "auto_doc_generate",
    { id: p.id, ...p.pair, answers: { counterparty_name: "Acme", entity: privateEntity!.id } },
    "validation_error",
  );
  expect((await patch(p.id, { fixedEntityId: listed!.id })).statusCode).toBe(200);
  expect(
    (await call(business, "form_get", { kind: "auto_doc", typeId: p.id })).autoDocForm.fields.some(
      (f) => f.slug === "entity",
    ),
  ).toBe(false);
  const args = { ...p.pair, answers: { counterparty_name: "Acme" } };
  const tool = (await call(business, "auto_doc_generate", { id: p.id, ...args })).generation;
  const ui = await post(`/portal/auto-docs/${p.id}/generations`, args, businessCookies);
  expect(ui.statusCode, ui.body).toBe(201);
  const [actual] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, tool.createdContract!.id));
  const [expected] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, ui.json().generation.createdContract.id));
  for (const key of [
    "title",
    "contractTypeId",
    "entityId",
    "businessOwnerId",
    "managerId",
    "statusId",
    "customFields",
  ] as const)
    expect(actual![key]).toEqual(expected![key]);
  expect(actual).toMatchObject({
    entityId: listed!.id,
    businessOwnerId: businessId,
    managerId: legalId,
  });
  const staff = (await call(legal, "auto_doc_generate", { id: p.id, ...args })).generation;
  await h.db
    .update(contracts)
    .set({ isConfidential: true, managerId: null })
    .where(eq(contracts.id, staff.createdContract!.id));
  await h.db
    .delete(contractTeam)
    .where(
      and(eq(contractTeam.contractId, staff.createdContract!.id), eq(contractTeam.userId, legalId)),
    );
  expect((await call(legal, "generations_list")).generations.map((g) => g.id)).not.toContain(
    staff.id,
  );
});
it("pages owned history, keeps it after Archive, and rechecks the Portal audience", async () => {
  const p = await prepare();
  const args = { id: p.id, ...p.pair, answers: { counterparty_name: "Acme" } };
  const one = (await call(business, "auto_doc_generate", args)).generation;
  const two = (await call(business, "auto_doc_generate", args)).generation;
  const first = await call(business, "generations_list", { limit: 1 });
  expect(first.generations[0]!.id).toBe(two.id);
  const next = await call(business, "generations_list", { limit: 1, cursor: first.nextCursor });
  expect(next.generations[0]!.id).toBe(one.id);
  expect((await call(legal, "generations_list", { cursor: one.id })).generations).toEqual([]);
  expect((await post(`/auto-docs/${p.id}/archive`, {})).statusCode).toBe(200);
  expect((await call(business, "generations_list")).generations.map((g) => g.id)).toContain(one.id);
  expect((await post(`/auto-docs/${p.id}/restore`, {})).statusCode).toBe(200);
  expect((await patch(p.id, { audience: "legal_only" })).statusCode).toBe(200);
  expect((await call(business, "generations_list")).generations.map((g) => g.id)).not.toContain(
    one.id,
  );
  expect(
    (await h.app.inject({ url: one.downloads.docx!, cookies: businessCookies })).statusCode,
  ).toBe(404);
});
it("applies the shared per-person pending cap to Tool and UI submissions", async () => {
  const p = await prepare();
  const origins = await h.db
    .insert(autoDocGenerationOrigins)
    .values(Array.from({ length: 5 }, () => ({})))
    .returning();
  await h.db.insert(autoDocGenerations).values(
    origins.map((o) => ({
      id: o.id,
      autoDocId: p.id,
      ...p.pair,
      generatedBy: businessId,
      answers: {},
      formats: "docx" as const,
    })),
  );
  const args = { ...p.pair, answers: { counterparty_name: "Acme" } };
  expect(
    await refused(business, "auto_doc_generate", { id: p.id, ...args }, "generation_limit_reached"),
  ).toContain("5 Generations");
  expect(
    (await post(`/portal/auto-docs/${p.id}/generations`, args, businessCookies)).statusCode,
  ).toBe(429);
  expect(
    await h.db.select().from(autoDocGenerations).where(eq(autoDocGenerations.autoDocId, p.id)),
  ).toHaveLength(5);
  expect((await call(legal, "auto_doc_generate", { id: p.id, ...args })).generation.state).toBe(
    "ready",
  );
});
