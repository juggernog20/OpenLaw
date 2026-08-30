// SPDX-License-Identifier: AGPL-3.0-only

/** Knowledge types as TECH-023's sixth taxonomy mount. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, knowledgeItems, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "knowledge-member@example.com",
  displayName: "Knowledge Member",
  password: "correct-horse-battery",
} as const;

interface TypeRow {
  id: string;
  slug: string;
  displayName: string;
  archivedAt: string | null;
  inUseCount: number;
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let adminId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEST_ADMIN.email))
    .limit(1);
  expect(admin).toBeDefined();
  adminId = admin!.id;
});

afterAll(async () => harness.stop());

async function listTypes(): Promise<TypeRow[]> {
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/knowledge/types?includeArchived=true",
    cookies: adminCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().knowledgeTypes;
}

async function createType(displayName: string): Promise<TypeRow> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/knowledge/types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().knowledgeType;
}

describe("Knowledge type reads", () => {
  it("keeps the settings taxonomy Admin-only and lists the four seeds once", async () => {
    const refused = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge/types",
      cookies: memberCookies,
    });
    expect(refused.statusCode).toBe(403);

    const rows = await listTypes();
    expect(rows.map((row) => row.slug)).toEqual(["template", "precedent", "playbook", "article"]);
  });

  it("offers live picker values to Member+ while refusing an anonymous reader", async () => {
    const anonymous = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge/type-options",
    });
    expect(anonymous.statusCode).toBe(401);

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge/type-options",
      cookies: memberCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().knowledgeTypes.map((row: TypeRow) => row.slug)).toEqual([
      "template",
      "precedent",
      "playbook",
      "article",
    ]);
  });
});

describe("the archive guard", () => {
  it("has no protected slug: a seed with zero uses can be archived and restored", async () => {
    const article = (await listTypes()).find((row) => row.slug === "article")!;
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/types/${article.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/types/${article.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
  });

  it("counts and reassigns every referencing item, including archived items", async () => {
    const from = await createType("Guard source");
    const to = await createType("Guard destination");
    await harness.db.insert(knowledgeItems).values([
      {
        id: "knowledge-live-guard-item",
        title: "Live guard item",
        knowledgeTypeId: from.id,
        createdBy: adminId,
        updatedBy: adminId,
      },
      {
        id: "knowledge-archived-guard-item",
        title: "Archived guard item",
        knowledgeTypeId: from.id,
        createdBy: adminId,
        updatedBy: adminId,
        archivedAt: new Date("2026-08-29T12:00:00Z"),
      },
    ]);

    expect((await listTypes()).find((row) => row.id === from.id)!.inUseCount).toBe(2);
    const guarded = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/types/${from.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(guarded.statusCode).toBe(409);

    const reassigned = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/types/${from.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: to.id },
    });
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json().knowledgeType.archivedAt).not.toBeNull();

    const moved = await harness.db
      .select({ id: knowledgeItems.id, archivedAt: knowledgeItems.archivedAt })
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.knowledgeTypeId, to.id), eq(knowledgeItems.createdBy, adminId)));
    expect(moved.map((row) => row.id).sort()).toEqual([
      "knowledge-archived-guard-item",
      "knowledge-live-guard-item",
    ]);
    expect(
      moved.find((row) => row.id === "knowledge-archived-guard-item")!.archivedAt,
    ).not.toBeNull();
  });
});
