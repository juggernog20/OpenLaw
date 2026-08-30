// SPDX-License-Identifier: AGPL-3.0-only

/** M28/3's global Knowledge folder tree HTTP contract (#601). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, eq, knowledgeItems, knowledgeTypes, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "knowledge-folders-member@example.com",
  displayName: "Folder Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "knowledge-folders-contributor@example.com",
  displayName: "Folder Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let memberId: string;
let typeId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const member = await provisionUser(harness.app.auth, MEMBER);
  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  memberId = member.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  const [type] = await harness.db.select({ id: knowledgeTypes.id }).from(knowledgeTypes).limit(1);
  typeId = type!.id;
}, 180_000);

afterAll(async () => harness.stop());

async function create(name: string, parentId?: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/knowledge/folders",
    cookies: memberCookies,
    payload: { name, ...(parentId ? { parentId } : {}) },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().folders as Folder[];
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  displayOrder: number;
  itemCount: number;
}

describe("Knowledge folders", () => {
  it("is Member+ only on every route", async () => {
    const attempts = (cookies?: Record<string, string>) => [
      harness.app.inject({ method: "GET", url: "/api/v1/knowledge/folders", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/knowledge/folders",
        cookies,
        payload: { name: "No" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: "/api/v1/knowledge/folders/no",
        cookies,
        payload: { name: "No" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/knowledge/folders/order",
        cookies,
        payload: { parentId: null, ids: [] },
      }),
      harness.app.inject({
        method: "DELETE",
        url: "/api/v1/knowledge/folders/no",
        cookies,
      }),
    ];
    for (const response of await Promise.all(attempts())) expect(response.statusCode).toBe(401);
    for (const response of await Promise.all(attempts(contributorCookies))) {
      expect(response.statusCode, response.body).toBe(403);
    }
  });

  it("creates a nested, ordered whole-tree answer and enforces the shared name rule", async () => {
    let folders = await create("  Playbooks  ");
    const root = folders.find((row) => row.name === "Playbooks")!;
    folders = await create("Commercial", root.id);
    const child = folders.find((row) => row.name === "Commercial")!;
    folders = await create("NDAs", child.id);
    const grandchild = folders.find((row) => row.name === "NDAs")!;
    expect(folders.map((row) => row.id).indexOf(root.id)).toBeLessThan(
      folders.map((row) => row.id).indexOf(child.id),
    );
    expect(folders.map((row) => row.id).indexOf(child.id)).toBeLessThan(
      folders.map((row) => row.id).indexOf(grandchild.id),
    );

    for (const name of ["", "   ", ".", "..", "Bad/name", "Bad\\name"]) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/knowledge/folders",
        cookies: memberCookies,
        payload: { name },
      });
      expect(response.statusCode, `${name}: ${response.body}`).toBe(400);
    }
    const duplicate = await harness.app.inject({
      method: "POST",
      url: "/api/v1/knowledge/folders",
      cookies: memberCookies,
      payload: { name: "playbooks" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
  });

  it("renames, moves, refuses cycles, and reorders an exact sibling set", async () => {
    await create("Reorder A");
    await create("Reorder B");
    const folders = await create("Move parent");
    const a = folders.find((row) => row.name === "Reorder A")!;
    const b = folders.find((row) => row.name === "Reorder B")!;
    const parent = folders.find((row) => row.name === "Move parent")!;

    const renamed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/folders/${a.id}`,
      cookies: memberCookies,
      payload: { name: "Renamed A", parentId: parent.id },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().folders.find((row: Folder) => row.id === a.id)).toMatchObject({
      name: "Renamed A",
      parentId: parent.id,
    });

    const cycle = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/folders/${parent.id}`,
      cookies: memberCookies,
      payload: { parentId: a.id },
    });
    expect(cycle.statusCode, cycle.body).toBe(409);

    const roots = (renamed.json().folders as Folder[]).filter((row) => row.parentId === null);
    const ids = roots.map((row) => row.id);
    const reorderedIds = [b.id, ...ids.filter((id) => id !== b.id)];
    const reordered = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/knowledge/folders/order",
      cookies: memberCookies,
      payload: { parentId: null, ids: reorderedIds },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(
      (reordered.json().folders as Folder[])
        .filter((row) => row.parentId === null)
        .map((row) => row.id),
    ).toEqual(reorderedIds);

    const incomplete = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/knowledge/folders/order",
      cookies: memberCookies,
      payload: { parentId: null, ids: [b.id] },
    });
    expect(incomplete.statusCode, incomplete.body).toBe(400);
  });

  it("deletes by moving child folders and items to the parent, without losing either", async () => {
    let folders = await create("Delete parent");
    const parent = folders.find((row) => row.name === "Delete parent")!;
    folders = await create("Dissolve me", parent.id);
    const target = folders.find((row) => row.name === "Dissolve me")!;
    folders = await create("Keep child", target.id);
    const child = folders.find((row) => row.name === "Keep child")!;
    await harness.db.insert(knowledgeItems).values({
      id: "knowledge-folder-delete-item",
      title: "Keep item",
      knowledgeTypeId: typeId,
      folderId: target.id,
      createdBy: memberId,
      updatedBy: memberId,
    });

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/knowledge/folders/${target.id}`,
      cookies: memberCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      (deleted.json().folders as Folder[]).find((row) => row.id === target.id),
    ).toBeUndefined();
    expect((deleted.json().folders as Folder[]).find((row) => row.id === child.id)?.parentId).toBe(
      parent.id,
    );
    const [item] = await harness.db
      .select({ folderId: knowledgeItems.folderId })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, "knowledge-folder-delete-item"));
    expect(item!.folderId).toBe(parent.id);

    const actions = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.actorId, memberId));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "knowledge_folder.created",
        "knowledge_folder.renamed",
        "knowledge_folder.moved",
        "knowledge_folder.reordered",
        "knowledge_folder.deleted",
        "knowledge_item.updated",
      ]),
    );
  });
});
