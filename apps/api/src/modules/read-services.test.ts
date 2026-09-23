// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  autoDocs,
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
  users,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";
import { NO_PERMISSION } from "../auth/guards.js";
import { provisionUser } from "../auth/instance.js";
import { signInCookies, startHarness, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { getEntity, listEntities } from "./entities/service.js";
import {
  getKnowledgeItem,
  listKnowledgeItems,
  portalKnowledgeScope,
  readPortalKnowledgeItem,
} from "./knowledge/service.js";
import { listAutoDocs, listPortalAutoDocs } from "./auto-docs/service.js";
import { getPortalEntity, listPortalEntities } from "../lib/portal-entities.js";
import { groupedSearch, flatSearch } from "./search/service.js";
import { listContractDocuments, readDocumentVersionText } from "./documents/service.js";
import { listPortalDocuments } from "./portal/document-service.js";

let h: TestHarness;
let user: AuthenticatedUser;
let cookies: Record<string, string>;
let businessCookies: Record<string, string>;
let entityId: string;
let itemId: string;

beforeAll(async () => {
  h = await startHarness();
  const setup = await h.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  user = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!;
  const business = {
    email: "read-service-business@example.com",
    displayName: "Read service Business User",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(h.app.auth, business);
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
  businessCookies = await signInCookies(h.app, business.email, business.password);
  const type = (await h.db.select().from(entityTypes).limit(1))[0]!;
  entityId = (
    await h.db
      .insert(entities)
      .values({ legalName: "Service registry", entityTypeId: type.id, portalListed: true })
      .returning()
  )[0]!.id;
  const knowledgeType = (await h.db.select().from(knowledgeTypes).limit(1))[0]!;
  itemId = (
    await h.db
      .insert(knowledgeItems)
      .values({
        title: "Service knowledge",
        knowledgeTypeId: knowledgeType.id,
        createdBy: user.id,
        updatedBy: user.id,
        state: "published",
        audience: "everyone",
      })
      .returning()
  )[0]!.id;
  await h.db
    .insert(autoDocs)
    .values({ name: "Service Auto-Doc", createdBy: user.id, updatedBy: user.id });
});
afterAll(async () => h?.stop());

it("returns the same staff reads through services and HTTP", async () => {
  for (const [url, read] of [
    ["/entities?sort=name&dir=desc", () => listEntities(h.db, user, { sort: "name", dir: "desc" })],
    [`/entities/${entityId}`, () => getEntity(h.db, user, entityId)],
    ["/knowledge?sort=title", () => listKnowledgeItems(h.db, user, { sort: "title" })],
    [`/knowledge/${itemId}`, () => getKnowledgeItem(h.db, user, itemId)],
    ["/auto-docs", () => listAutoDocs(h.db, user)],
    ["/portal/auto-docs", () => listPortalAutoDocs(h.db, user)],
    ["/portal/entities", async () => ({ entities: await listPortalEntities(h.db, user) })],
    ["/search?q=Service", () => groupedSearch(h.db, user, "Service")],
    ["/search?q=Service&limit=1", () => flatSearch(h.db, user, "Service", { limit: 1 })],
  ] as const) {
    const response = await h.app.inject({ method: "GET", url: `/api/v1${url}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(JSON.stringify(await read()))).toEqual(response.json());
  }
});

it("enforces the staff floor without HTTP guards", async () => {
  const business = { ...user, role: "business_user" as const };
  for (const read of [
    () => listEntities(h.db, business),
    () => getEntity(h.db, business, entityId),
    () => listKnowledgeItems(h.db, business),
    () => getKnowledgeItem(h.db, business, itemId),
    () => listAutoDocs(h.db, business),
    () => listContractDocuments(h.db, business, 1),
  ])
    await expect(read()).rejects.toMatchObject({ statusCode: 403, message: NO_PERMISSION });
  const response = await h.app.inject({
    method: "GET",
    url: "/api/v1/auto-docs",
    cookies: businessCookies,
  });
  expect(response.statusCode, response.body).toBe(403);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toMatchObject({ status: 403, detail: NO_PERMISSION });
});

it("keeps Confidential Entities out of staff reads and Portal name reads", async () => {
  await h.db
    .update(entities)
    .set({ isConfidential: true, portalListed: false })
    .where(eq(entities.id, entityId));
  expect((await listEntities(h.db, user)).entities.map((row) => row.id)).not.toContain(entityId);
  await expect(getEntity(h.db, user, entityId)).rejects.toMatchObject({ statusCode: 404 });
  expect(await listPortalEntities(h.db, user)).not.toContainEqual({
    id: entityId,
    name: "Service registry",
  });
  await expect(getPortalEntity(h.db, user, entityId)).rejects.toMatchObject({ statusCode: 404 });
  const grouped = await groupedSearch(h.db, user, "Service");
  expect(grouped.results.map((row) => row.id)).not.toContain(entityId);
  const flat = await flatSearch(h.db, user, "Service", { kind: "entity" });
  expect(flat.results).toEqual([]);
  const response = await h.app.inject({
    method: "GET",
    url: "/api/v1/search?q=Service",
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual(grouped);
});

it("shares the published, Everyone, live Knowledge predicate with direct reads", async () => {
  const business = { ...user, role: "business_user" as const };
  expect(await readPortalKnowledgeItem(h.db, business, itemId)).toMatchObject({ id: itemId });
  for (const patch of [
    { state: "draft" as const, audience: "everyone" as const, archivedAt: null },
    { state: "published" as const, audience: "legal_only" as const, archivedAt: null },
    { state: "published" as const, audience: "everyone" as const, archivedAt: new Date() },
  ]) {
    await h.db.update(knowledgeItems).set(patch).where(eq(knowledgeItems.id, itemId));
    expect(
      await h.db.select().from(knowledgeItems).where(portalKnowledgeScope(h.db, business)),
    ).toEqual([]);
    expect(await readPortalKnowledgeItem(h.db, business, itemId)).toBeNull();
    expect((await getKnowledgeItem(h.db, user, itemId)).knowledgeItem.id).toBe(itemId);
  }
  expect(await readPortalKnowledgeItem(h.db, business, "missing")).toBeNull();
});

it("refuses an unreachable Version before reading its text", async () => {
  await expect(
    readDocumentVersionText(h.db, user, { documentId: "missing", versionId: "missing" }),
  ).rejects.toMatchObject({ statusCode: 404 });
});

it("keeps Document chains and text states behind record and Document access", async () => {
  const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const status = (await h.db.select().from(contractStatuses).limit(1))[0]!;
  const contract = (
    await h.db
      .insert(contracts)
      .values({ title: "Service paper", contractTypeId: type.id, statusId: status.id })
      .returning()
  )[0]!;
  await h.db.insert(contractTeam).values({ contractId: contract.id, userId: user.id });
  const document = (
    await h.db
      .insert(documents)
      .values({ contractId: contract.id, title: "Service paper", createdBy: user.id })
      .returning()
  )[0]!;
  const version = (
    await h.db
      .insert(documentVersions)
      .values({
        documentId: document.id,
        versionNumber: 1,
        kind: "draft_ours",
        originalFilename: "paper.pdf",
        mimeType: "application/pdf",
        fileRef: "local:service/paper",
        byteSize: 1,
        checksumSha256: "a".repeat(64),
        createdBy: user.id,
      })
      .returning()
  )[0]!;
  const params = { documentId: document.id, versionId: version.id };
  const business = { ...user, role: "business_user" as const };
  expect((await listContractDocuments(h.db, user, contract.number)).documents).toMatchObject([
    { id: document.id, versions: [{ id: version.id, isCurrent: true }] },
  ]);
  expect(
    (await listPortalDocuments(h.db, business, "contract", contract.number)).documents,
  ).toMatchObject([{ id: document.id }]);
  expect((await readDocumentVersionText(h.db, business, params)).text.state).toBe("pending");
  await h.db.insert(documentVersionText).values({
    versionId: version.id,
    state: "ready",
    source: "native_layer",
    text: "Extracted service words",
  });
  for (const [url, read] of [
    [
      `/contracts/${contract.number}/documents`,
      () => listContractDocuments(h.db, user, contract.number),
    ],
    [
      `/portal/contracts/${contract.number}/documents`,
      () => listPortalDocuments(h.db, user, "contract", contract.number),
    ],
    [
      `/documents/${document.id}/versions/${version.id}/text`,
      () => readDocumentVersionText(h.db, user, params),
    ],
  ] as const) {
    const response = await h.app.inject({ method: "GET", url: `/api/v1${url}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    expect(await read()).toEqual(response.json());
  }
  await h.db
    .update(documentVersions)
    .set({ originalFilename: "paper.png", mimeType: "image/png" })
    .where(eq(documentVersions.id, version.id));
  await h.db.delete(documentVersionText).where(eq(documentVersionText.versionId, version.id));
  expect((await readDocumentVersionText(h.db, business, params)).text.state).toBe("unsupported");
  await h.db.delete(contractTeam).where(eq(contractTeam.contractId, contract.id));
  await h.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contract.id));
  for (const read of [
    () => listContractDocuments(h.db, user, contract.number),
    () => listPortalDocuments(h.db, business, "contract", contract.number),
    () => readDocumentVersionText(h.db, user, params),
  ])
    await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
