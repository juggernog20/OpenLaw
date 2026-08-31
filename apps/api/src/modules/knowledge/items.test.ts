// SPDX-License-Identifier: AGPL-3.0-only

/** M28/3's Knowledge Item HTTP contract (#601). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  asc,
  eq,
  knowledgeFolders,
  knowledgeItems,
  knowledgeTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "knowledge-items-member@example.com",
  displayName: "Knowledge Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "knowledge-items-contributor@example.com",
  displayName: "Knowledge Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "knowledge-items-business@example.com",
  displayName: "Knowledge Business User",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let businessCookies: Record<string, string>;
let adminId: string;
let memberId: string;
let templateId: string;
let playbookId: string;
let parentFolderId: string;
let childFolderId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (role === "legal_team_member") memberId = user.id;
  }

  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);

  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEST_ADMIN.email));
  adminId = admin!.id;
  const types = await harness.db
    .select({ id: knowledgeTypes.id, slug: knowledgeTypes.slug })
    .from(knowledgeTypes);
  templateId = types.find((row) => row.slug === "template")!.id;
  playbookId = types.find((row) => row.slug === "playbook")!.id;

  const [parent] = await harness.db
    .insert(knowledgeFolders)
    .values({ name: "Commercial", displayOrder: 0 })
    .returning({ id: knowledgeFolders.id });
  const [child] = await harness.db
    .insert(knowledgeFolders)
    .values({ name: "NDAs", parentId: parent!.id, displayOrder: 0 })
    .returning({ id: knowledgeFolders.id });
  parentFolderId = parent!.id;
  childFolderId = child!.id;
}, 180_000);

afterAll(async () => harness.stop());

function create(
  cookies: Record<string, string>,
  body: { title: string; knowledgeTypeId: string; folderId?: string },
) {
  return harness.app.inject({ method: "POST", url: "/api/v1/knowledge", cookies, payload: body });
}

function list(query: Record<string, string> = {}) {
  const search = new URLSearchParams(query);
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/knowledge${search.size > 0 ? `?${search.toString()}` : ""}`,
    cookies: memberCookies,
  });
}

describe("the Knowledge Member+ boundary", () => {
  it("returns 401 anonymously and 403 to Contributors and Business Users", async () => {
    const attempts = (cookies?: Record<string, string>) => [
      harness.app.inject({ method: "GET", url: "/api/v1/knowledge", cookies }),
      harness.app.inject({ method: "GET", url: "/api/v1/knowledge/not-real", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/knowledge",
        cookies,
        payload: { title: "No entry", knowledgeTypeId: templateId },
      }),
      harness.app.inject({
        method: "PATCH",
        url: "/api/v1/knowledge/not-real",
        cookies,
        payload: { title: "No edit" },
      }),
    ];
    for (const response of await Promise.all(attempts())) expect(response.statusCode).toBe(401);
    for (const cookies of [contributorCookies, businessCookies]) {
      for (const response of await Promise.all(attempts(cookies))) {
        expect(response.statusCode, response.body).toBe(403);
        expect(response.headers["content-type"]).toContain("application/problem+json");
      }
    }
  });
});

describe("Knowledge Item create, read, and inline updates", () => {
  it("creates a draft Legal Only item, reads it, updates every M28/3 field, and audits both writes", async () => {
    const created = await create(memberCookies, {
      title: "  NDA playbook  ",
      knowledgeTypeId: playbookId,
      folderId: childFolderId,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().knowledgeItem).toMatchObject({
      title: "NDA playbook",
      knowledgeTypeId: playbookId,
      knowledgeTypeName: "Playbook",
      folderId: childFolderId,
      folderName: "NDAs",
      body: null,
      state: "draft",
      audience: "legal_only",
      createdBy: { id: memberId, displayName: MEMBER.displayName },
    });
    const id = created.json().knowledgeItem.id as string;

    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/knowledge/${id}`,
      cookies: adminCookies,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().knowledgeItem.id).toBe(id);

    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${id}`,
      cookies: memberCookies,
      payload: {
        title: "NDA guidance",
        knowledgeTypeId: templateId,
        body: "## Use this\n\n- Read it first\n- Ask Legal",
        folderId: parentFolderId,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().knowledgeItem).toMatchObject({
      title: "NDA guidance",
      knowledgeTypeId: templateId,
      knowledgeTypeName: "Template",
      folderId: parentFolderId,
      folderName: "Commercial",
      body: "## Use this\n\n- Read it first\n- Ask Legal",
      updatedBy: { id: memberId, displayName: MEMBER.displayName },
    });

    const activity = await harness.db
      .select({ action: activityLog.action, entityId: activityLog.entityId })
      .from(activityLog)
      .where(eq(activityLog.entityId, id))
      .orderBy(asc(activityLog.createdAt));
    expect(activity).toEqual([
      { action: "knowledge_item.created", entityId: id },
      { action: "knowledge_item.updated", entityId: id },
    ]);

    const feed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/activity",
      cookies: memberCookies,
      query: { entityType: "knowledge_item", entityId: id },
    });
    expect(feed.statusCode, feed.body).toBe(200);
    expect(feed.json().entries.map((entry: { action: string }) => entry.action)).toEqual([
      "knowledge_item.updated",
      "knowledge_item.created",
    ]);
    const contributorFeed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/activity",
      cookies: contributorCookies,
      query: { entityType: "knowledge_item", entityId: id },
    });
    expect(contributorFeed.statusCode, contributorFeed.body).toBe(404);
  });

  it("requires live types and real folders", async () => {
    const [archivedType] = await harness.db
      .insert(knowledgeTypes)
      .values({ slug: "archived-item-type", displayName: "Archived item type", displayOrder: 50 })
      .returning();
    await harness.db
      .update(knowledgeTypes)
      .set({ archivedAt: new Date() })
      .where(eq(knowledgeTypes.id, archivedType!.id));

    for (const body of [
      { title: "Archived type", knowledgeTypeId: archivedType!.id },
      { title: "Missing folder", knowledgeTypeId: templateId, folderId: "missing-folder" },
    ]) {
      const response = await create(memberCookies, body);
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it("refuses a replacement that is the item itself or archived, and accepts a live successor", async () => {
    const first = await create(memberCookies, { title: "Old answer", knowledgeTypeId: templateId });
    const successor = await create(memberCookies, {
      title: "Current answer",
      knowledgeTypeId: templateId,
    });
    const archived = await create(memberCookies, {
      title: "Archived answer",
      knowledgeTypeId: templateId,
    });
    const firstId = first.json().knowledgeItem.id as string;
    const successorId = successor.json().knowledgeItem.id as string;
    const archivedId = archived.json().knowledgeItem.id as string;
    await harness.db
      .update(knowledgeItems)
      .set({ archivedAt: new Date() })
      .where(eq(knowledgeItems.id, archivedId));

    for (const replacedById of [firstId, archivedId]) {
      const refused = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/knowledge/${firstId}`,
        cookies: memberCookies,
        payload: { replacedById },
      });
      expect(refused.statusCode, refused.body).toBe(409);
    }
    const accepted = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${firstId}`,
      cookies: memberCookies,
      payload: { replacedById: successorId },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().knowledgeItem.replacedBy).toEqual({
      id: successorId,
      title: "Current answer",
    });
  });
});

describe("Knowledge Item publishing and archive lifecycle", () => {
  it("publishes, unpublishes, archives with a successor, and restores through distinct verbs", async () => {
    const item = await create(memberCookies, {
      title: "Portal NDA guide",
      knowledgeTypeId: playbookId,
    });
    const successor = await create(memberCookies, {
      title: "Replacement NDA guide",
      knowledgeTypeId: playbookId,
    });
    const id = item.json().knowledgeItem.id as string;
    const successorId = successor.json().knowledgeItem.id as string;

    const audience = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${id}`,
      cookies: memberCookies,
      payload: { audience: "everyone" },
    });
    expect(audience.statusCode, audience.body).toBe(200);
    expect(audience.json().knowledgeItem).toMatchObject({
      audience: "everyone",
      state: "draft",
      publishedAt: null,
      archivedAt: null,
    });

    const published = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/publish`,
      cookies: memberCookies,
      payload: {},
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().knowledgeItem.state).toBe("published");
    expect(published.json().knowledgeItem.publishedAt).toEqual(expect.any(String));
    const firstPublishedAt = published.json().knowledgeItem.publishedAt as string;

    const publishNoop = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/publish`,
      cookies: adminCookies,
      payload: {},
    });
    expect(publishNoop.statusCode, publishNoop.body).toBe(200);
    expect(publishNoop.json().knowledgeItem.publishedAt).toBe(firstPublishedAt);

    const unpublished = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/unpublish`,
      cookies: memberCookies,
      payload: {},
    });
    expect(unpublished.statusCode, unpublished.body).toBe(200);
    expect(unpublished.json().knowledgeItem).toMatchObject({ state: "draft", publishedAt: null });

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/archive`,
      cookies: memberCookies,
      payload: { replacedById: successorId },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().knowledgeItem.archivedAt).toEqual(expect.any(String));
    expect(archived.json().knowledgeItem.replacedBy).toEqual({
      id: successorId,
      title: "Replacement NDA guide",
    });

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/restore`,
      cookies: adminCookies,
      payload: {},
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().knowledgeItem.archivedAt).toBeNull();

    const actions = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.entityId, id))
      .orderBy(asc(activityLog.createdAt));
    expect(actions.map((row) => row.action)).toEqual([
      "knowledge_item.created",
      "knowledge_item.updated",
      "knowledge_item.published",
      "knowledge_item.unpublished",
      "knowledge_item.archived",
      "knowledge_item.restored",
    ]);
  });

  it("keeps every lifecycle route at the Member+ floor", async () => {
    const attempts = (cookies?: Record<string, string>) =>
      ["publish", "unpublish", "archive", "restore"].map((verb) =>
        harness.app.inject({
          method: "POST",
          url: `/api/v1/knowledge/not-real/${verb}`,
          cookies,
          payload: {},
        }),
      );
    for (const response of await Promise.all(attempts())) expect(response.statusCode).toBe(401);
    for (const cookies of [contributorCookies, businessCookies]) {
      for (const response of await Promise.all(attempts(cookies))) {
        expect(response.statusCode, response.body).toBe(403);
      }
    }
  });
});

describe("the managed Knowledge list", () => {
  it("filters by type, state, audience, author, and a folder including descendants", async () => {
    await harness.db.insert(knowledgeItems).values([
      {
        id: "knowledge-list-parent",
        title: "Parent folder item",
        knowledgeTypeId: templateId,
        folderId: parentFolderId,
        createdBy: adminId,
        updatedBy: adminId,
      },
      {
        id: "knowledge-list-child",
        title: "Child folder item",
        knowledgeTypeId: playbookId,
        folderId: childFolderId,
        state: "published",
        audience: "everyone",
        createdBy: memberId,
        updatedBy: memberId,
      },
      {
        id: "knowledge-list-root",
        title: "Root item",
        knowledgeTypeId: templateId,
        createdBy: adminId,
        updatedBy: adminId,
      },
    ]);

    const ids = async (query: Record<string, string>) =>
      ((await list(query)).json().knowledgeItems as { id: string }[]).map((row) => row.id);
    expect(await ids({ folder: parentFolderId })).toEqual(
      expect.arrayContaining(["knowledge-list-parent", "knowledge-list-child"]),
    );
    expect(await ids({ folder: childFolderId })).toContain("knowledge-list-child");
    expect(await ids({ type: playbookId })).toContain("knowledge-list-child");
    expect(await ids({ state: "published" })).toContain("knowledge-list-child");
    expect(await ids({ audience: "everyone" })).toContain("knowledge-list-child");
    expect(await ids({ author: memberId })).toContain("knowledge-list-child");
    expect(await ids({ type: playbookId, state: "draft" })).not.toContain("knowledge-list-child");
  });

  it("supports every sort key and keyset-pages ties without gaps", async () => {
    const tiedAt = new Date("2026-08-30T12:00:00.000Z");
    await harness.db.insert(knowledgeItems).values(
      Array.from({ length: 52 }, (_, index) => ({
        id: `knowledge-page-${String(index).padStart(2, "0")}`,
        title: "Paged item",
        knowledgeTypeId: templateId,
        folderId: childFolderId,
        createdBy: adminId,
        updatedBy: adminId,
        createdAt: tiedAt,
        updatedAt: tiedAt,
      })),
    );

    for (const sort of [
      "title",
      "type",
      "state",
      "audience",
      "folder",
      "author",
      "created",
      "updated",
    ]) {
      const response = await list({ sort, dir: "asc" });
      expect(response.statusCode, response.body).toBe(200);
    }

    const first = await list({ type: templateId, sort: "created", dir: "asc" });
    expect(first.json().knowledgeItems).toHaveLength(50);
    expect(first.json().nextCursor).not.toBeNull();
    const second = await list({
      type: templateId,
      sort: "created",
      dir: "asc",
      cursor: first.json().nextCursor,
    });
    const rows = [...first.json().knowledgeItems, ...second.json().knowledgeItems] as {
      id: string;
    }[];
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining(["knowledge-page-00", "knowledge-page-51"]),
    );
  });
});
