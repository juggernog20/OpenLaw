// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-002 matter-status CRUD, lifecycle invariants, and reassignment. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, matters, matterStatuses, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;

interface StatusRow {
  id: string;
  slug: string;
  displayName: string;
  category: "open" | "closed";
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
});

afterAll(async () => {
  await harness.stop();
});

async function list(includeArchived = false): Promise<StatusRow[]> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matter-statuses${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().matterStatuses;
}

async function bySlug(slug: string): Promise<StatusRow> {
  const row = (await list(true)).find((candidate) => candidate.slug === slug);
  expect(row, slug).toBeDefined();
  return row!;
}

async function createStatus(displayName: string, category: "open" | "closed") {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-statuses",
    cookies: adminCookies,
    payload: { displayName, category },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterStatus as StatusRow;
}

async function createMatter(title: string) {
  const typeResponse = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
  });
  expect(typeResponse.statusCode, typeResponse.body).toBe(200);
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: adminCookies,
    payload: { title, matterTypeId: typeResponse.json().matterTypes[0].id },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matter as { id: string; number: number; statusId: string };
}

describe("GET and POST /matter-statuses", () => {
  it("lists the four seeds and accepts only a fixed category at creation", async () => {
    expect((await list()).map(({ slug, category }) => [slug, category])).toEqual([
      ["open", "open"],
      ["in_progress", "open"],
      ["on_hold", "open"],
      ["closed", "closed"],
    ]);

    const created = await createStatus("Awaiting input", "open");
    expect(created).toMatchObject({
      slug: "awaiting_input",
      displayName: "Awaiting input",
      category: "open",
      isSystemDefault: false,
      inUseCount: 0,
    });
    const invalid = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-statuses",
      cookies: adminCookies,
      payload: { displayName: "Unknown", category: "pending" },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);
  });

  it("is Administrator-only", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/v1/matter-statuses" });
    expect(response.statusCode, response.body).toBe(401);
    const memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
    const mutation = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-statuses",
      cookies: memberCookies,
      payload: { displayName: "Not allowed", category: "open" },
    });
    expect(mutation.statusCode, mutation.body).toBe(403);
    expect(mutation.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("rename and category immutability", () => {
  it("renames without changing the slug or category and refuses a category key", async () => {
    const target = await bySlug("awaiting_input");
    const renamed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-statuses/${target.id}`,
      cookies: adminCookies,
      payload: { displayName: "Awaiting client" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().matterStatus).toMatchObject({
      slug: "awaiting_input",
      displayName: "Awaiting client",
      category: "open",
    });

    const categoryChange = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-statuses/${target.id}`,
      cookies: adminCookies,
      payload: { displayName: "Awaiting client", category: "closed" },
    });
    expect(categoryChange.statusCode, categoryChange.body).toBe(400);
    expect((await bySlug("awaiting_input")).category).toBe("open");
  });
});

describe("reorder and the new-matter default", () => {
  it("makes the first live open status the default after reorder", async () => {
    const before = await list();
    const onHold = before.find((row) => row.slug === "on_hold")!;
    const reordered = [onHold, ...before.filter((row) => row.id !== onHold.id)];
    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-statuses/order",
      cookies: adminCookies,
      payload: { ids: reordered.map((row) => row.id) },
    });
    expect(response.statusCode, response.body).toBe(200);

    const created = await createMatter("Reordered status default");
    expect(created.statusId).toBe(onHold.id);

    const restore = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-statuses/order",
      cookies: adminCookies,
      payload: { ids: before.map((row) => row.id) },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });
});

describe("archive and delete invariants", () => {
  it("protects open and closed on both archive and delete", async () => {
    for (const slug of ["open", "closed"]) {
      const target = await bySlug(slug);
      const archive = await harness.app.inject({
        method: "POST",
        url: `/api/v1/matter-statuses/${target.id}/archive`,
        cookies: adminCookies,
        payload: {},
      });
      expect(archive.statusCode, archive.body).toBe(409);
      expect(archive.json().detail).toContain("system-protected");
      const remove = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/matter-statuses/${target.id}`,
        cookies: adminCookies,
      });
      expect(remove.statusCode, remove.body).toBe(409);
    }
  });

  it("refuses to archive the last live status in a category", async () => {
    const onlyCustomClosed = await createStatus("Settled", "closed");
    const closed = await bySlug("closed");
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/matter-statuses/${onlyCustomClosed.id}/archive`,
          cookies: adminCookies,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const lone = await createStatus("Lone closed replacement", "closed");
    await harness.db
      .update(matterStatuses)
      .set({ archivedAt: new Date() })
      .where(eq(matterStatuses.id, closed.id));
    const floor = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-statuses/${lone.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(floor.statusCode, floor.body).toBe(409);
    expect(floor.json().detail).toContain("last unarchived status");
    await harness.db
      .update(matterStatuses)
      .set({ archivedAt: null })
      .where(eq(matterStatuses.id, closed.id));
  });

  it("requires a target for an in-use status, moves every matter, and narrates each move", async () => {
    const source = await createStatus("Discovery", "open");
    const target = await createStatus("Investigation", "open");
    const first = await createMatter("First reassigned matter");
    const second = await createMatter("Second reassigned matter");
    await harness.db.update(matters).set({ statusId: source.id }).where(eq(matters.id, first.id));
    await harness.db.update(matters).set({ statusId: source.id }).where(eq(matters.id, second.id));
    expect((await bySlug(source.slug)).inUseCount).toBe(2);

    const guarded = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-statuses/${source.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(guarded.statusCode, guarded.body).toBe(409);
    expect(guarded.json().detail).toContain("2 matters");

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-statuses/${source.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: target.id },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().matterStatus.archivedAt).not.toBeNull();
    const moved = await harness.db
      .select({ id: matters.id, statusId: matters.statusId })
      .from(matters)
      .where(eq(matters.statusId, target.id));
    expect(moved.map((row) => row.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    const narration = await harness.db
      .select({ entityId: activityLog.entityId, payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.action, "matter.status_reassigned"))
      .orderBy(asc(activityLog.createdAt));
    expect(narration.map((row) => row.entityId)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(narration.at(-1)!.payload).toMatchObject({ from: "Discovery", to: "Investigation" });
  });
});
