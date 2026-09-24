// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  contracts,
  contractTypes,
  contractStatuses,
  contractCounterparties,
  documents,
  documentVersions,
  documentVersionText,
  documentTypes,
  entities,
  entityTypes,
  entityHoldings,
  entityObligations,
  counterparties,
  requests,
  requestTypes,
  knowledgeItems,
  knowledgeTypes,
  knowledgeFolders,
  users,
  eq,
} from "@openlaw/db";
import { simpleSearchQuestion, type SearchQuestion } from "@openlaw/shared";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

type Kind = SearchQuestion["kinds"][number];
let h: TestHarness;
let cookies: Record<string, string>;
let viewer: string;
const ids: Record<string, string[]> = {};
const types: Record<string, string> = {};
let folder: string;
let owner: string;
let contract: string;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  viewer = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, viewer));
  const ct = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const cs = (await h.db.select().from(contractStatuses).limit(1))[0]!;
  contract = (
    await h.db
      .insert(contracts)
      .values({ title: "Owner", contractTypeId: ct.id, statusId: cs.id })
      .returning()
  )[0]!.id;
  types.entity = (await h.db.select().from(entityTypes).limit(1))[0]!.id;
  types.request = (await h.db.select().from(requestTypes).limit(1))[0]!.id;
  types.knowledge_item = (await h.db.select().from(knowledgeTypes).limit(1))[0]!.id;
  types.document = (
    await h.db
      .insert(documentTypes)
      .values({
        slug: "search-paper",
        displayName: "Search paper",
        module: "contract",
        displayOrder: 0,
      })
      .returning()
  )[0]!.id;
  folder = (
    await h.db.insert(knowledgeFolders).values({ name: "Playbooks", displayOrder: 0 }).returning()
  )[0]!.id;
  for (const kind of ["entity", "request", "counterparty", "knowledge_item", "document"] as const) {
    ids[kind] = [];
    for (let i = 0; i < 3; i++) {
      const archivedAt = i === 2 ? new Date() : null;
      const title = `Condition ${kind} ${i}`;
      let id: string;
      if (kind === "entity")
        id = (
          await h.db
            .insert(entities)
            .values({
              legalName: title,
              entityTypeId: types.entity!,
              jurisdiction: i === 0 ? "United Arab Emirates" : "France",
              status: i === 0 ? "active" : "dissolved",
              archivedAt,
            })
            .returning()
        )[0]!.id;
      else if (kind === "counterparty")
        id = (
          await h.db
            .insert(counterparties)
            .values({
              name: title,
              jurisdiction: i === 0 ? "United Arab Emirates" : null,
              archivedAt,
            })
            .returning()
        )[0]!.id;
      else if (kind === "request")
        id = (
          await h.db
            .insert(requests)
            .values({
              title,
              requestTypeId: types.request!,
              requesterId: viewer,
              urgency: i === 0 ? "high" : "low",
              status: i === 0 ? "new" : "resolved",
              createdAt: new Date("2026-01-10T23:30:00Z"),
              archivedAt,
            })
            .returning()
        )[0]!.id;
      else if (kind === "knowledge_item")
        id = (
          await h.db
            .insert(knowledgeItems)
            .values({
              title,
              knowledgeTypeId: types.knowledge_item!,
              folderId: i === 0 ? folder : null,
              state: i === 0 ? "published" : "draft",
              createdBy: viewer,
              updatedBy: viewer,
              archivedAt,
            })
            .returning()
        )[0]!.id;
      else {
        id = (
          await h.db
            .insert(documents)
            .values({ title, contractId: contract, createdBy: viewer, archivedAt })
            .returning()
        )[0]!.id;
        for (const versionNumber of [1, 2]) {
          const version = (
            await h.db
              .insert(documentVersions)
              .values({
                documentId: id,
                versionNumber,
                fileRef: `local:conditions/${i}/${versionNumber}`,
                kind: "general",
                documentTypeId: i === 0 && versionNumber === 2 ? types.document : null,
                originalFilename: i === 1 ? "photo.png" : "paper.pdf",
                mimeType: i === 1 ? "image/png" : "application/pdf",
                byteSize: 1,
                checksumSha256: "a".repeat(64),
                createdBy: viewer,
                createdAt: new Date(versionNumber === 2 ? "2026-01-10T23:30:00Z" : "2020-01-01"),
              })
              .returning()
          )[0]!;
          if (versionNumber === 1 || i === 2)
            await h.db.insert(documentVersionText).values({
              versionId: version.id,
              state: "ready",
              source: "native_layer",
              text: "Earlier extraction",
            });
        }
      }
      ids[kind]!.push(id);
    }
  }
  owner = ids.entity![1]!;
  await h.db
    .insert(entityHoldings)
    .values({ ownerEntityId: owner, ownedEntityId: ids.entity![0]!, ownershipPercent: "60" });
  await h.db.insert(entityObligations).values([
    { entityId: ids.entity![0]!, label: "Next", nextDueOn: "2026-02-10" },
    {
      entityId: ids.entity![0]!,
      label: "Done",
      nextDueOn: "2026-01-01",
      completedOn: "2026-01-01",
    },
  ]);
  await h.db
    .insert(contractCounterparties)
    .values({ contractId: contract, counterpartyId: ids.counterparty![0]!, isPrimary: true });
});
afterAll(async () => {
  await h?.stop();
});

const condition = (
  kind: Kind,
  property: string,
  operator: string,
  value: SearchQuestion["conditions"][number]["value"],
) => ({ kind, property, operator, value });
async function run(conditions: SearchQuestion["conditions"], extra = {}) {
  const kinds = [...new Set(conditions.map((c) => c.kind))];
  const response = await h.app.inject({
    method: "POST",
    url: "/api/v1/search/query",
    cookies,
    payload: { ...simpleSearchQuestion("", kinds), conditions, ...extra },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ results: { id: string }[]; total: number }>();
}
async function check(
  kind: Kind,
  property: string,
  value: SearchQuestion["conditions"][number]["value"],
  expected: string[],
  operator = "is_any_of",
) {
  const answer = await run([condition(kind, property, operator, value)]);
  expect(answer.results.map((r) => r.id).sort()).toEqual([...expected].sort());
  expect(answer.total).toBe(expected.length);
}

it("filters every new choice property, including null-safe exclusion", async () => {
  for (const [kind, property, value, expected] of [
    ["document", "owner", "contract", ids.document!.slice(0, 2)],
    ["document", "format", "pdf", [ids.document![0]!]],
    ["document", "type", types.document!, [ids.document![0]!]],
    ["document", "counterparty", ids.counterparty![0]!, ids.document!.slice(0, 2)],
    ["document", "uploader", "me", ids.document!.slice(0, 2)],
    ["entity", "type", types.entity!, ids.entity!.slice(0, 2)],
    ["entity", "jurisdiction", "United Arab Emirates", [ids.entity![0]!]],
    ["entity", "status", "active", [ids.entity![0]!]],
    ["entity", "majorityOwner", owner, [ids.entity![0]!]],
    ["request", "type", types.request!, ids.request!.slice(0, 2)],
    ["request", "urgency", "high", [ids.request![0]!]],
    ["request", "status", "new", [ids.request![0]!]],
    ["request", "requester", "me", ids.request!.slice(0, 2)],
    ["knowledge_item", "type", types.knowledge_item!, ids.knowledge_item!.slice(0, 2)],
    ["knowledge_item", "state", "published", [ids.knowledge_item![0]!]],
    ["knowledge_item", "folder", folder, [ids.knowledge_item![0]!]],
  ] as const) {
    await check(kind, property, [value], [...expected]);
    await check(
      kind,
      property,
      [value],
      ids[kind]!.slice(0, 2).filter((id) => !expected.includes(id)),
      "is_none_of",
    );
  }
});
it("filters Counterparty jurisdiction as escaped case-insensitive text", async () => {
  await check("counterparty", "jurisdiction", "ARAB", [ids.counterparty![0]!], "contains");
  await check("counterparty", "jurisdiction", "ARAB", [ids.counterparty![1]!], "does_not_contain");
  await check("counterparty", "jurisdiction", "%", [], "contains");
});
it("uses current upload and received dates in the viewer timezone, and the next incomplete obligation", async () => {
  for (const [kind, property, date, expected] of [
    ["document", "uploaded", "2026-01-10", ids.document!.slice(0, 2)],
    ["request", "received", "2026-01-10", ids.request!.slice(0, 2)],
    ["entity", "nextObligation", "2026-02-10", [ids.entity![0]!]],
  ] as const) {
    await check(kind, property, date, [...expected], "on");
    await check(kind, property, [date, date], [...expected], "between");
    await check(kind, property, "2026-03-01", [...expected], "before");
    await check(kind, property, "2026-01-01", [...expected], "after");
  }
  for (const [kind, property] of [
    ["document", "uploaded"],
    ["request", "received"],
  ] as const)
    expect(
      (await run([condition(kind, property, "on", "2026-01-11")], { timeZone: "Asia/Dubai" }))
        .total,
    ).toBe(2);
});
it("includes archived Documents and Entities only when requested", async () => {
  for (const kind of ["document", "entity"] as const) {
    await check(kind, "includeArchived", true, ids[kind]!, "is");
    await check(kind, "includeArchived", false, ids[kind]!.slice(0, 2), "is");
  }
});
it("finds pending, failed, unsupported and ready text on the current Version", async () => {
  await check("document", "textState", ["pending"], [ids.document![0]!]);
  await check("document", "textState", ["unsupported"], [ids.document![1]!]);
  const current = (
    await h.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, ids.document![0]!))
  ).find((v) => v.versionNumber === 2)!;
  await h.db.insert(documentVersionText).values({ versionId: current.id, state: "failed" });
  await check("document", "textState", ["failed"], [ids.document![0]!]);
  await h.db
    .update(documentVersionText)
    .set({ state: "pending" })
    .where(eq(documentVersionText.versionId, current.id));
  await check("document", "textState", ["pending"], [ids.document![0]!]);
  await h.db
    .update(documentVersionText)
    .set({ state: "ready", source: "native_layer", text: "Ready" })
    .where(eq(documentVersionText.versionId, current.id));
  await check("document", "textState", ["ready"], [ids.document![0]!]);
});
it("answers the union of three kinds' own filtered hits under both match modes", async () => {
  const conditions = [
    condition("document", "format", "is_any_of", ["pdf"]),
    condition("entity", "status", "is_any_of", ["active"]),
    condition("request", "urgency", "is_any_of", ["high"]),
  ];
  for (const match of ["all", "any"])
    expect((await run(conditions, { match })).results.map((r) => r.id).sort()).toEqual(
      [ids.document![0], ids.entity![0], ids.request![0]].sort(),
    );
});

it("keeps reach outside Match any, archived inclusion, totals and paging", async () => {
  await h.db.update(entities).set({ isConfidential: true }).where(eq(entities.id, ids.entity![0]!));
  await h.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contract));
  try {
    for (const match of ["all", "any"])
      for (const kind of ["document", "entity"] as const) {
        const conditions = [
          condition(kind, "includeArchived", "is", true),
          condition(kind, "type", "is_any_of", [types[kind]!]),
        ];
        const answer = await run(conditions, { match, limit: 1 });
        expect(answer.total).toBe(kind === "document" ? 0 : 2);
        expect(answer.results).toHaveLength(kind === "document" ? 0 : 1);
        expect(answer.results.map((row) => row.id)).not.toContain(ids[kind]![0]);
      }
  } finally {
    await h.db
      .update(entities)
      .set({ isConfidential: false })
      .where(eq(entities.id, ids.entity![0]!));
    await h.db.update(contracts).set({ isConfidential: false }).where(eq(contracts.id, contract));
  }
});

it("filters Knowledge-owned Documents by the inherited type and uses filename fallback for format and text state", async () => {
  const [document] = await h.db
    .insert(documents)
    .values({
      title: "Knowledge paper",
      knowledgeItemId: ids.knowledge_item![0]!,
      createdBy: viewer,
    })
    .returning();
  await h.db.insert(documentVersions).values({
    documentId: document!.id,
    versionNumber: 1,
    fileRef: "local:conditions/knowledge",
    kind: "general",
    originalFilename: "PLAYBOOK.DOCX",
    mimeType: "application/octet-stream",
    byteSize: 1,
    checksumSha256: "a".repeat(64),
    createdBy: viewer,
  });
  await check("document", "type", [types.knowledge_item!], [document!.id]);
  await check("document", "owner", ["knowledge_item"], [document!.id]);
  await check("document", "format", ["word"], [document!.id]);
  await check("document", "textState", ["pending"], [document!.id]);
  const answer = await run([
    condition("document", "counterparty", "is_none_of", [ids.counterparty![0]!]),
  ]);
  expect(answer.results.map((row) => row.id)).toEqual([document!.id]);
});
