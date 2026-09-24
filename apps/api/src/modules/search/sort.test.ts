// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractTypes,
  contractStatuses,
  matters,
  matterTypes,
  matterStatuses,
  documents,
  documentVersions,
  entities,
  entityTypes,
  counterparties,
  requests,
  requestTypes,
  knowledgeItems,
  knowledgeTypes,
  users,
  eq,
  sql,
} from "@openlaw/db";
import { SEARCH_KINDS, simpleSearchQuestion, type SearchQuestion } from "@openlaw/shared";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

type Row = { id: string; kind: SearchQuestion["kinds"][number]; title: string; rank: number };
type Answer = { results: Row[]; total: number; nextCursor: string | null };
let harness: TestHarness;
let cookies: Record<string, string>;
const seeded: (Omit<Row, "rank"> & { createdAt: string; expiry: string | null })[] = [];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const identity = (row: Pick<Row, "kind" | "id">) => `${row.kind}:${row.id}`;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const [user] = await harness.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user!.id));
  const [ct] = await harness.db.select().from(contractTypes).limit(1);
  const [cs] = await harness.db.select().from(contractStatuses).limit(1);
  const [mt] = await harness.db.select().from(matterTypes).limit(1);
  const [ms] = await harness.db.select().from(matterStatuses).limit(1);
  const [et] = await harness.db.select().from(entityTypes).limit(1);
  const [rt] = await harness.db.select().from(requestTypes).limit(1);
  const [kt] = await harness.db.select().from(knowledgeTypes).limit(1);
  for (const kind of SEARCH_KINDS) {
    for (let i = 0; i < 5; i++) {
      // IDs deliberately overlap across kinds. Keys tie within and across kinds.
      const id = `sort-${i}`;
      const title = [
        "alpha sortneedle",
        "ALPHA sortneedle",
        "Beta sortneedle sortneedle",
        "zeta sortneedle",
        `zeta sortneedle ${"界".repeat(200)}`,
      ][i]!;
      const createdAt = [
        "2025-01-01T00:00:00.000001Z",
        "2025-01-01T00:00:00.000001Z",
        "2025-01-01T00:00:00.000002Z",
        "2025-02-01T00:00:00.000000Z",
        "2025-02-01T00:00:00.000000Z",
      ][i]!;
      const expiry =
        kind === "contract" ? ["2027-02-01", "2027-02-01", null, "2027-01-01", null][i]! : null;
      const base = { id, title, createdAt: sql`${createdAt}::timestamptz` };
      if (kind === "contract")
        await harness.db
          .insert(contracts)
          .values({ ...base, contractTypeId: ct!.id, statusId: cs!.id, expiryDate: expiry });
      if (kind === "matter")
        await harness.db
          .insert(matters)
          .values({ ...base, matterTypeId: mt!.id, statusId: ms!.id, createdBy: user!.id });
      if (kind === "entity")
        await harness.db
          .insert(entities)
          .values({ ...base, legalName: title, entityTypeId: et!.id });
      if (kind === "counterparty")
        await harness.db.insert(counterparties).values({ ...base, name: title });
      if (kind === "request")
        await harness.db
          .insert(requests)
          .values({ ...base, requestTypeId: rt!.id, requesterId: user!.id, urgency: "low" });
      if (kind === "knowledge_item")
        await harness.db
          .insert(knowledgeItems)
          .values({ ...base, knowledgeTypeId: kt!.id, createdBy: user!.id, updatedBy: user!.id });
      if (kind === "document") {
        await harness.db.insert(documents).values({
          ...base,
          createdAt: new Date("2020-01-01"),
          contractId: "sort-0",
          createdBy: user!.id,
        });
        for (const versionNumber of [1, 2])
          await harness.db.insert(documentVersions).values({
            documentId: id,
            versionNumber,
            createdAt: versionNumber === 2 ? base.createdAt : new Date("2020-01-01"),
            fileRef: `local:sort/${i}/${versionNumber}`,
            kind: "draft_ours",
            originalFilename: "paper.pdf",
            mimeType: "application/pdf",
            byteSize: 1,
            checksumSha256: "a".repeat(64),
            createdBy: user!.id,
          });
      }
      seeded.push({ kind, id, title, createdAt, expiry });
    }
  }
  await harness.db.insert(contracts).values({
    title: "Hidden sortneedle",
    contractTypeId: ct!.id,
    statusId: cs!.id,
    isConfidential: true,
    expiryDate: "2020-01-01",
  });
  await harness.db
    .insert(counterparties)
    .values({ name: "Archived sortneedle", archivedAt: new Date() });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function run(sort: SearchQuestion["sort"], options: object = {}) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/search/query",
    cookies,
    payload: { ...simpleSearchQuestion("sortneedle"), sort, limit: 100, ...options },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Answer>();
}

const relevance = (a: Row, b: Row) =>
  b.rank - a.rank || compare(b.id, a.id) || compare(b.kind, a.kind);

describe("question sorts", () => {
  it.each(["relevance", "newest", "oldest", "expiry", "title"] as const)(
    "orders and pages %s across all kinds, tied keys and IDs",
    async (sort) => {
      const answer = await run(sort);
      expect(answer.total).toBe(seeded.length);
      const expected = seeded.map((row) => ({
        ...row,
        rank: answer.results.find((hit) => identity(hit) === identity(row))!.rank,
      }));
      expected.sort((a, b) => {
        if (sort === "relevance") return relevance(a, b);
        if (sort === "expiry") {
          if (a.kind !== "contract" && b.kind !== "contract") return relevance(a, b);
          if (a.kind !== b.kind) return a.kind === "contract" ? -1 : 1;
          return compare(a.expiry ?? "9999", b.expiry ?? "9999") || compare(b.id, a.id);
        }
        const direction = sort === "newest" ? -1 : 1;
        const key =
          sort === "title"
            ? compare(a.title.toLowerCase(), b.title.toLowerCase())
            : compare(a.createdAt, b.createdAt);
        return direction * (key || compare(a.id, b.id) || compare(a.kind, b.kind));
      });
      expect(answer.results.map(identity)).toEqual(expected.map(identity));
      for (const limit of [1, 3, 8]) {
        const rows: Row[] = [];
        let cursor: string | null = null;
        do {
          const page = await run(sort, { limit, ...(cursor ? { cursor } : {}) });
          expect(page.total).toBe(seeded.length);
          expect(page.results.length).toBeGreaterThan(0);
          rows.push(...page.results);
          expect(rows.length).toBeLessThanOrEqual(seeded.length);
          cursor = page.nextCursor;
        } while (cursor);
        expect(rows.map(identity)).toEqual(expected.map(identity));
      }
    },
  );

  it("keeps the header answer grouped by kind and relevance", async () => {
    const header = await harness.app.inject({
      method: "GET",
      url: "/api/v1/search?q=sortneedle",
      cookies,
    });
    expect(header.statusCode, header.body).toBe(200);
    const before = header.json<Answer>();
    for (const sort of ["newest", "oldest", "expiry", "title"] as const) await run(sort);
    const after = await harness.app.inject({
      method: "GET",
      url: "/api/v1/search?q=sortneedle",
      cookies,
    });
    expect(after.json()).toEqual(before);
    expect(before.results).toEqual(
      [...before.results].sort(
        (a, b) => SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind) || relevance(a, b),
      ),
    );
  });

  it("refuses a cursor from another sort", async () => {
    const page = await run("relevance", { limit: 1 });
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/search/query",
      cookies,
      payload: { ...simpleSearchQuestion("sortneedle"), sort: "title", cursor: page.nextCursor },
    });
    expect(response.statusCode).toBe(400);
  });
});
