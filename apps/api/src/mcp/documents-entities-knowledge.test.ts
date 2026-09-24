// SPDX-License-Identifier: AGPL-3.0-only
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  contracts,
  contractStatuses,
  contractTeam,
  contractTypes,
  documents,
  documentVersions,
  documentVersionText,
  entities,
  entityTypes,
  eq,
  knowledgeItems,
  knowledgeTypes,
  orgSettings,
  users,
} from "@openlaw/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { provisionUser } from "../auth/instance.js";
import { signInCookies, startHarness, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { toolRegister } from "./register.js";
let h: TestHarness;
let cookies: Record<string, string>;
let legal: Client;
let business: Client;
let userId: string;
let businessId: string;
let number: number;
let contractId: string;
let entityId: string;
let itemId: string;
const clients: Client[] = [];
beforeAll(async () => {
  h = await startHarness({ maxUploadBytes: 64 });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  userId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  const person = await provisionUser(h.app.auth, {
    email: "documents-business@example.com",
    displayName: "Business",
    password: TEST_ADMIN.password,
  });
  businessId = person.id;
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, businessId));
  const businessCookies = await signInCookies(
    h.app,
    "documents-business@example.com",
    TEST_ADMIN.password,
  );
  for (const auth of [cookies, businessCookies]) {
    const asked = await h.app.inject({
      method: "POST",
      url: "/api/v1/api-key-requests",
      cookies: auth,
      payload: {
        clientName: "Documents test",
        toolsets: ["documents", "entities", "knowledge"],
        scope: "write",
      },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    let key = asked.json().key;
    if (!key) {
      await h.app.inject({
        method: "POST",
        url: `/api/v1/api-key-requests/${asked.json().id}/approve`,
        cookies,
        payload: {},
      });
      key = (
        await h.app.inject({
          method: "GET",
          url: `/api/v1/api-key-requests/${asked.json().id}`,
          cookies: auth,
        })
      ).json().key;
    }
    const client = new Client({ name: "Documents test", version: "1" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { "x-api-key": key } },
      }),
    );
  }
  [legal, business] = clients as [Client, Client];
  const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const status = (await h.db.select().from(contractStatuses).limit(1))[0]!;
  const record = (
    await h.db
      .insert(contracts)
      .values({
        title: "MCP paper",
        contractTypeId: type.id,
        statusId: status.id,
        createdBy: userId,
      })
      .returning()
  )[0]!;
  number = record.number;
  contractId = record.id;
  await h.db.insert(contractTeam).values({ contractId, userId: businessId });
  const et = (await h.db.select().from(entityTypes).limit(1))[0]!;
  entityId = (
    await h.db
      .insert(entities)
      .values({ legalName: "Portal company", entityTypeId: et.id, portalListed: true })
      .returning()
  )[0]!.id;
  const kt = (await h.db.select().from(knowledgeTypes).limit(1))[0]!;
  itemId = (
    await h.db
      .insert(knowledgeItems)
      .values({
        title: "Guidance",
        body: "Quasar indemnity guidance",
        knowledgeTypeId: kt.id,
        createdBy: userId,
        updatedBy: userId,
        state: "published",
        audience: "everyone",
      })
      .returning()
  )[0]!.id;
});
afterAll(async () => {
  vi.useRealTimers();
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65536);
  const tool = toolRegister.find((t) => t.name === `openlaw_${name}`)!;
  expect(tool.outputSchema.safeParse(result.structuredContent).success).toBe(true);
  return result.structuredContent as {
    uploadUrl: string;
    headers: Record<string, string>;
    versionId: string;
    documentId: string;
    documents: {
      id: string;
      versions: { id: string; versionNumber: number }[];
      currentVersion: { id: string };
    }[];
    entities: { id: string; name?: string }[];
    entity: { id: string };
    officers: unknown[];
    obligations: unknown[];
    shareRegister: unknown;
    results: { id: string }[];
    knowledgeItem: { body: string };
    text: { text: string };
    nextCursor: string | null;
  };
}
async function refused(client: Client, name: string, args: Record<string, unknown>, code: string) {
  const result = await client.callTool({ name: `openlaw_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBe(true);
  expect(JSON.stringify(result)).toContain(code);
}
const target = () => ({ ownerType: "contract", number });
async function prepare(client = legal) {
  return call(client, "document_upload", {
    ...target(),
    filename: "paper.txt",
    mimeType: "text/plain",
  });
}
async function put(
  upload: { uploadUrl: string; headers: Record<string, string> },
  payload: string,
) {
  const url = new URL(upload.uploadUrl);
  return h.app.inject({
    method: "PUT",
    url: url.pathname + url.search,
    headers: { ...upload.headers, origin: "https://external-client.example" },
    payload,
  });
}
it("completes a signed upload without cookies or an API key and never overwrites its Version", async () => {
  const upload = await prepare();
  expect(
    await h.db.select().from(documentVersions).where(eq(documentVersions.id, upload.versionId)),
  ).toHaveLength(0);
  const response = await put(upload, "Uploaded paper");
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json().document.versions[0]!.id).toBe(upload.versionId);
  expect((await put(upload, "Replacement")).statusCode).toBe(409);
  const listed = await call(legal, "documents_list", target());
  expect(listed.documents[0]!.versions[0]!.id).toBe(upload.versionId);
  const portal = await call(business, "documents_list", target());
  expect(portal.documents).toHaveLength(1);
  const download = await h.app.inject({
    method: "GET",
    url: `/api/v1/documents/${listed.documents[0]!.id}/versions/${upload.versionId}/download`,
    cookies,
  });
  expect(download.body).toBe("Uploaded paper");
});
it("refuses oversized, expired and tampered URLs without creating a Version", async () => {
  const oversized = await prepare();
  expect((await put(oversized, "x".repeat(65))).statusCode).toBe(413);
  const expired = await prepare();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
  try {
    expect((await put(expired, "unused")).statusCode).toBe(401);
  } finally {
    vi.restoreAllMocks();
  }
  const tampered = { ...(await prepare()) };
  tampered.uploadUrl += "x";
  expect((await put(tampered, "tampered")).statusCode).toBe(401);
  for (const upload of [oversized, expired, tampered])
    expect(
      await h.db.select().from(documentVersions).where(eq(documentVersions.id, upload.versionId)),
    ).toHaveLength(0);
});
it("pages exactly the UI extracted text and refuses an unreached Document", async () => {
  const upload = await prepare();
  const done = await put(upload, "text");
  const documentId = done.json().document.id;
  const text = 'Words "quoted" 🌍 '.repeat(3000);
  await h.db
    .insert(documentVersionText)
    .values({ versionId: upload.versionId, state: "ready", source: "native_layer", text })
    .onConflictDoUpdate({
      target: documentVersionText.versionId,
      set: { state: "ready", source: "native_layer", text },
    });
  const ui = await h.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${upload.versionId}/text`,
    cookies,
  });
  expect(ui.statusCode, ui.body).toBe(200);
  let cursor: string | null = null;
  let collected = "";
  let pages = 0;
  do {
    const page = await call(business, "document_read", {
      documentId,
      versionId: upload.versionId,
      ...(cursor ? { cursor } : {}),
    });
    collected += page.text.text;
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  expect(collected).toBe(ui.json().text.text);
  await h.db.delete(contractTeam).where(eq(contractTeam.contractId, contractId));
  await refused(
    business,
    "document_read",
    { documentId, versionId: upload.versionId },
    "not_found",
  );
  await refused(business, "documents_list", target(), "not_found");
  await refused(business, "document_upload", { ...target(), filename: "no.txt" }, "not_found");
  await h.db.insert(contractTeam).values({ contractId, userId: businessId });
});
it("lists Portal-listed Entities and includes the staff Entity record sections", async () => {
  const list = await call(business, "entities_list");
  expect(list.entities).toContainEqual({ id: entityId, name: "Portal company" });
  expect((await call(legal, "entities_list", { q: "Portal" })).entities.map((e) => e.id)).toContain(
    entityId,
  );
  const detail = await call(legal, "entity_get", { id: entityId });
  expect(detail.entity.id).toBe(entityId);
  expect(detail.officers).toEqual([]);
  expect(detail.documents).toEqual([]);
  expect(detail.obligations).toEqual([]);
  expect(detail.shareRegister).toBeDefined();
  await refused(business, "entity_get", { id: entityId }, "tool_outside_grant");
  await h.db.update(entities).set({ portalListed: false }).where(eq(entities.id, entityId));
  expect((await call(business, "entities_list")).entities).toEqual([]);
});
it("searches published Knowledge text and applies Portal readability to search and get", async () => {
  for (const client of [legal, business]) {
    expect(
      (await call(client, "knowledge_search", { query: "Quasar" })).results.map(
        (r: { id: string }) => r.id,
      ),
    ).toContain(itemId);
    const item = await call(client, "knowledge_get", { id: itemId });
    expect(item.knowledgeItem.body).toContain("Quasar");
    expect(item.documents).toEqual([]);
  }
  await h.db
    .update(knowledgeItems)
    .set({ audience: "legal_only" })
    .where(eq(knowledgeItems.id, itemId));
  expect((await call(business, "knowledge_search", { query: "Quasar" })).results).toEqual([]);
  await refused(business, "knowledge_get", { id: itemId }, "not_found");
  await h.db.update(knowledgeItems).set({ state: "draft" }).where(eq(knowledgeItems.id, itemId));
  expect((await call(legal, "knowledge_search", { query: "Quasar" })).results).toEqual([]);
  await refused(legal, "knowledge_get", { id: itemId }, "not_found");
});

it("appends a Business User's Version without moving the primary or executed designation", async () => {
  const upload = await prepare(business);
  const first = await put(upload, "First portal paper");
  expect(first.statusCode, first.body).toBe(201);
  const original = (await h.db.select().from(contracts).where(eq(contracts.id, contractId)))[0]!;
  const next = await call(business, "document_upload", {
    ...target(),
    documentId: upload.documentId,
    filename: "revision.txt",
  });
  const responses = await Promise.all([put(next, "Second"), put(next, "Concurrent")]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  const chain = (await call(business, "documents_list", target())).documents.find(
    (d: { id: string }) => d.id === upload.documentId,
  );
  expect(chain!.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  const current = (await h.db.select().from(contracts).where(eq(contracts.id, contractId)))[0]!;
  expect(current.primaryDocumentId).toBe(original.primaryDocumentId);
  const page = await call(business, "documents_list", { ...target(), limit: 1 });
  expect(page.documents).toHaveLength(1);
  expect(page.nextCursor).toBeTruthy();
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await call(business, "documents_list", {
      ...target(),
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...result.documents.map((d: { id: string }) => d.id));
    cursor = result.nextCursor;
  } while (cursor);
  expect(ids).toEqual(
    (await call(business, "documents_list", target())).documents.map((d: { id: string }) => d.id),
  );
});

it("counts streamed bytes without Content-Length and requires the signed URL even with a session", async () => {
  const upload = await prepare();
  const url = new URL(upload.uploadUrl);
  const { Readable } = await import("node:stream");
  const response = await h.app.inject({
    method: "PUT",
    url: url.pathname + url.search,
    headers: upload.headers,
    payload: Readable.from([Buffer.alloc(40), Buffer.alloc(40)]),
  });
  expect(response.statusCode, response.body).toBe(413);
  expect(
    await h.db.select().from(documentVersions).where(eq(documentVersions.id, upload.versionId)),
  ).toHaveLength(0);
  const unsigned = await h.app.inject({
    method: "PUT",
    url: "/mcp/uploads",
    cookies,
    headers: upload.headers,
    payload: "No URL",
  });
  expect(unsigned.statusCode).toBe(401);
});

it("rechecks record membership and MCP policy when a signed URL is used", async () => {
  const upload = await prepare(business);
  await h.db.delete(contractTeam).where(eq(contractTeam.contractId, contractId));
  expect((await put(upload, "Revoked reach")).statusCode).toBe(404);
  expect(
    await h.db.select().from(documentVersions).where(eq(documentVersions.id, upload.versionId)),
  ).toHaveLength(0);
  await h.db.insert(contractTeam).values({ contractId, userId: businessId });
  const disabled = await prepare();
  await h.db.update(orgSettings).set({ mcpReadOnly: true });
  try {
    expect((await put(disabled, "Read only")).statusCode).toBe(403);
  } finally {
    await h.db.update(orgSettings).set({ mcpReadOnly: false });
  }
});

it("reads only the current Portal Knowledge Version and keeps its confidential paper hidden", async () => {
  await h.db
    .update(knowledgeItems)
    .set({ state: "published", audience: "everyone" })
    .where(eq(knowledgeItems.id, itemId));
  const args = { ownerType: "knowledge_item", id: itemId, filename: "guidance.txt" };
  const upload = await call(legal, "document_upload", args);
  const first = await put(upload, "Public guidance");
  expect(first.statusCode, first.body).toBe(201);
  await h.db.insert(documentVersionText).values({
    versionId: upload.versionId,
    state: "ready",
    source: "native_layer",
    text: "Public guidance",
  });
  expect(
    (await call(business, "knowledge_get", { id: itemId })).documents[0]!.currentVersion.id,
  ).toBe(upload.versionId);
  expect(
    (
      await call(business, "document_read", {
        documentId: upload.documentId,
        versionId: upload.versionId,
      })
    ).text.text,
  ).toBe("Public guidance");
  const next = await call(legal, "document_upload", { ...args, documentId: upload.documentId });
  expect((await put(next, "Current guidance")).statusCode).toBe(201);
  await refused(
    business,
    "document_read",
    { documentId: upload.documentId, versionId: upload.versionId },
    "not_found",
  );
  await h.db
    .update(documents)
    .set({ isConfidential: true })
    .where(eq(documents.id, upload.documentId));
  expect((await call(business, "knowledge_get", { id: itemId })).documents).toEqual([]);
  expect(
    (await call(business, "documents_list", { ownerType: "knowledge_item", id: itemId })).documents,
  ).toEqual([]);
  await refused(
    business,
    "document_read",
    { documentId: upload.documentId, versionId: next.versionId },
    "not_found",
  );
});

it("accepts the maximum Unicode upload metadata in its signed URL", async () => {
  const upload = await call(legal, "document_upload", {
    ...target(),
    filename: "界".repeat(251) + ".txt",
    note: "界".repeat(2000),
  });
  const response = await put(upload, "Unicode metadata");
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json().document.versions[0].note).toBe("界".repeat(2000));
});
