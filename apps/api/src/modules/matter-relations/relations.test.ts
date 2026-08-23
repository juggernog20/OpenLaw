// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-015's hierarchy and undirected related-Matter graph at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, matterRelations, matterTeam, matters, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "matter-relations-member@example.com",
  displayName: "Morgan Member",
  password: "correct-horse-battery",
} as const;
const VIEWER = {
  email: "matter-relations-viewer@example.com",
  displayName: "Val Viewer",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-relations-contributor@example.com",
  displayName: "Cory Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let viewerCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let contributorId = "";
let matterTypeId = "";

interface MatterRow {
  id: string;
  number: number;
  title: string;
}

type Relative =
  | { restricted: true }
  | {
      restricted: false;
      number: number;
      title: string;
      statusName: string;
      statusCategory: "open" | "closed";
    };

interface Relations {
  parent: Relative | null;
  children: Relative[];
  related: Relative[];
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
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const viewer = await provisionUser(harness.app.auth, VIEWER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, viewer.id));
  viewerCookies = await signInCookies(harness.app, VIEWER.email, VIEWER.password);

  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  contributorId = contributor.id;
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: memberCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  matterTypeId = (options.json().matterTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "other",
  )!.id;
});

afterAll(async () => {
  await harness.stop();
});

async function create(title: string, extra: Record<string, unknown> = {}): Promise<MatterRow> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: memberCookies,
    payload: { title, matterTypeId, ...extra },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matter as MatterRow;
}

async function read(number: number, cookies = memberCookies): Promise<Relations> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matters/${number}/relations`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Relations;
}

describe("Matter hierarchy (MTR-015)", () => {
  it("creates a sub-Matter with its parent preselected and projects both ends", async () => {
    const parent = await create("Parent project");
    const child = await create("Child workstream", { parentMatterNumber: parent.number });

    expect(await read(child.number)).toMatchObject({
      parent: { restricted: false, number: parent.number, title: parent.title },
      children: [],
      related: [],
    });
    expect((await read(parent.number)).children).toEqual([
      expect.objectContaining({ restricted: false, number: child.number, title: child.title }),
    ]);
  });

  it("sets, re-parents, and removes a parent without changing either Matter", async () => {
    const first = await create("First parent");
    const second = await create("Second parent");
    const child = await create("Movable child", { priority: "critical", isConfidential: true });

    for (const parent of [first, second]) {
      const response = await harness.app.inject({
        method: "PUT",
        url: `/api/v1/matters/${child.number}/parent`,
        cookies: memberCookies,
        payload: { parentMatterNumber: parent.number },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().parent.number).toBe(parent.number);
    }

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${child.number}/parent`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().parent).toBeNull();

    const [storedChild] = await harness.db.select().from(matters).where(eq(matters.id, child.id));
    const [storedParent] = await harness.db.select().from(matters).where(eq(matters.id, second.id));
    expect(storedChild).toMatchObject({ priority: "critical", isConfidential: true });
    expect(storedParent!.parentId).toBeNull();
  });

  it("refuses self-parenting and an arbitrary-depth cycle with one stable problem type", async () => {
    const root = await create("Cycle root");
    const middle = await create("Cycle middle", { parentMatterNumber: root.number });
    const leaf = await create("Cycle leaf", { parentMatterNumber: middle.number });

    for (const [childNumber, parentMatterNumber] of [
      [root.number, root.number],
      [root.number, leaf.number],
    ]) {
      const response = await harness.app.inject({
        method: "PUT",
        url: `/api/v1/matters/${childNumber}/parent`,
        cookies: memberCookies,
        payload: { parentMatterNumber },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().type).toBe("urn:openlaw:problem:matter-parent-cycle");
    }

    expect((await read(root.number)).parent).toBeNull();
    expect((await read(leaf.number)).parent).toMatchObject({ number: middle.number });
  });
});

describe("undirected related Matters (MTR-015)", () => {
  it("stores one canonical row, reads it from both ends, and removes it from either end", async () => {
    const a = await create("Related Alpha");
    const b = await create("Related Beta");

    const added = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: b.number },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().related).toEqual([expect.objectContaining({ number: b.number })]);
    expect((await read(b.number)).related).toEqual([expect.objectContaining({ number: a.number })]);

    const rows = await harness.db.select().from(matterRelations);
    const row = rows.find((candidate) => [candidate.matterAId, candidate.matterBId].includes(a.id));
    expect(row).toBeDefined();
    expect(row!.matterAId < row!.matterBId).toBe(true);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${b.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: a.number },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await read(a.number)).related).toEqual([]);
  });

  it("refuses self links, duplicates from either direction, and concurrent duplicates deterministically", async () => {
    const a = await create("Duplicate Alpha");
    const b = await create("Duplicate Beta");
    const post = (from: number, to: number) =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/matters/${from}/relations`,
        cookies: memberCookies,
        payload: { relatedMatterNumber: to },
      });

    const self = await post(a.number, a.number);
    expect(self.statusCode).toBe(409);
    expect(self.json().type).toBe("urn:openlaw:problem:matter-self-relation");

    expect((await post(a.number, b.number)).statusCode).toBe(201);
    const reverse = await post(b.number, a.number);
    expect(reverse.statusCode).toBe(409);
    expect(reverse.json().type).toBe("urn:openlaw:problem:matter-relation-exists");

    const c = await create("Race Alpha");
    const d = await create("Race Beta");
    const raced = await Promise.all([post(c.number, d.number), post(d.number, c.number)]);
    expect(raced.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(raced.find((response) => response.statusCode === 409)!.json().type).toBe(
      "urn:openlaw:problem:matter-relation-exists",
    );
  });
});

describe("reach, archives, and Activity", () => {
  it("lets a reached Contributor read but not mutate, and emits Restricted matter without leaks", async () => {
    const open = await create("Contributor anchor");
    const confidential = await create("Secret investigation", { isConfidential: true });
    await harness.db.insert(matterTeam).values({
      matterId: open.id,
      userId: contributorId,
      role: "contributor",
    });
    const linked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${open.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: confidential.number },
    });
    expect(linked.statusCode, linked.body).toBe(201);

    const contributorRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${open.number}/relations`,
      cookies: contributorCookies,
    });
    expect(contributorRead.statusCode, contributorRead.body).toBe(200);
    expect(contributorRead.json().related).toEqual([{ restricted: true }]);
    expect(contributorRead.body).not.toContain(confidential.title);
    expect(contributorRead.body).not.toContain(String(confidential.number));

    const contributorWrite = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${open.number}/relations`,
      cookies: contributorCookies,
      payload: { relatedMatterNumber: confidential.number },
    });
    expect(contributorWrite.statusCode).toBe(403);

    const unreachableWrite = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${open.number}/relations`,
      cookies: viewerCookies,
      payload: { relatedMatterNumber: confidential.number },
    });
    expect(unreachableWrite.statusCode).toBe(404);
  });

  it("omits archived relatives and picker candidates while preserving links for restore", async () => {
    const anchor = await create("Archive anchor");
    const relative = await create("Archive relative");
    const linked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${anchor.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: relative.number },
    });
    expect(linked.statusCode, linked.body).toBe(201);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${relative.number}/archive`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    expect((await read(anchor.number)).related).toEqual([]);
    const candidates = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${anchor.number}/relation-candidates?q=Archive`,
      cookies: memberCookies,
    });
    expect(candidates.statusCode, candidates.body).toBe(200);
    expect(candidates.body).not.toContain(relative.title);
    expect(
      await harness.db
        .select()
        .from(matterRelations)
        .where(
          and(eq(matterRelations.matterAId, anchor.id), eq(matterRelations.matterBId, relative.id)),
        ),
    ).toHaveLength(1);

    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${relative.number}/restore`,
      cookies: memberCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect((await read(anchor.number)).related).toEqual([
      expect.objectContaining({ restricted: false, number: relative.number }),
    ]);
  });

  it("writes exactly one acted-Matter Activity entry for every relationship action", async () => {
    const parent = await create("Activity parent");
    const child = await create("Activity child");
    const related = await create("Activity related");

    const parented = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/matters/${child.number}/parent`,
      cookies: memberCookies,
      payload: { parentMatterNumber: parent.number },
    });
    expect(parented.statusCode, parented.body).toBe(200);
    const unparented = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${child.number}/parent`,
      cookies: memberCookies,
    });
    expect(unparented.statusCode, unparented.body).toBe(200);
    const linked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${child.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: related.number },
    });
    expect(linked.statusCode, linked.body).toBe(201);
    const unlinked = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matters/${child.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: related.number },
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);

    const entries = await harness.db
      .select({ action: activityLog.action, actorId: activityLog.actorId })
      .from(activityLog)
      .where(eq(activityLog.entityId, child.id));
    for (const action of [
      "matter.parent_set",
      "matter.parent_removed",
      "matter.relation_added",
      "matter.relation_removed",
    ]) {
      expect(entries.filter((entry) => entry.action === action)).toEqual([
        expect.objectContaining({ actorId: expect.any(String) }),
      ]);
    }
  });
});
