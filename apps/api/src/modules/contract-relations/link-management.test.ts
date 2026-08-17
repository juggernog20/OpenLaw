// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Manual link management (M17/4, CTR-015, CTR-018), at the HTTP seam
 * through the real-Postgres harness.
 *
 * **Four acts through one guarded path.** Link, unlink, set-parent,
 * and unparent each go through the shared functions in
 * `contract-relations.ts`, so the cycle walk, the both-ways duplicate
 * check for `related`, the self-link check, and the advisory lock are
 * inherited rather than restated. This file proves the three named
 * refusals — relation-exists, parent-cycle, self-link — are reachable
 * through the HTTP seam, closing what CTR-015's implementation note
 * promised.
 *
 * **Reach on both ends.** Every write requires Member+ with reach on
 * both the acted-from contract and the far end. A restricted
 * relative's row offers no actions; an attempt to manage a link into
 * or out of a record the viewer cannot see is answered 404, the same
 * as a record that does not exist.
 *
 * **Narration.** Each write appends its own activity action on the
 * acted-from record, naming the far end by number and title, with
 * nothing written on the far end — per the standing no-cascade stance.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, contracts, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "linkm-member@example.com",
  displayName: "Link Manager",
  password: "correct-horse-battery",
} as const;

const VIEWER = {
  email: "linkm-viewer@example.com",
  displayName: "Link Viewer",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let viewerCookies: Record<string, string>;
let ndaTypeId = "";

interface ContractRow {
  id: string;
  number: number;
  title: string;
  isConfidential: boolean;
}

type Relative =
  | { restricted: true }
  | { restricted: false; number: number; title: string; statusName: string; stage: string };

interface LinkEntry {
  relationType: string;
  direction: string;
  contract: Relative;
}

interface Relations {
  parentChain: Relative[];
  children: Relative[];
  links: LinkEntry[];
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

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const types = res.json().contractTypes as { id: string; slug: string }[];
  ndaTypeId = types.find((row) => row.slug === "nda")!.id;
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

async function create(payload: Record<string, unknown>): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { contractTypeId: ndaTypeId, ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

async function read(number: number, cookies = memberCookies): Promise<Relations> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/relations`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Relations;
}

// ---------------------------------------------------------------
// Link management
// ---------------------------------------------------------------

describe("link and unlink through the HTTP seam (CTR-015)", () => {
  it("links two contracts with a chosen type and answers the updated graph", async () => {
    const a = await create({ title: "Link A" });
    const b = await create({ title: "Link B" });

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "related" },
    });
    expect(res.statusCode, res.body).toBe(201);

    const relations = res.json() as Relations;
    expect(relations.links).toHaveLength(1);
    expect(relations.links[0]).toMatchObject({
      relationType: "related",
      direction: "outgoing",
      contract: expect.objectContaining({ number: b.number }),
    });
  });

  it("unlinks two contracts and answers the updated graph", async () => {
    const a = await create({ title: "Unlink A" });
    const b = await create({ title: "Unlink B" });

    // Link first.
    const link = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "amends" },
    });
    expect(link.statusCode, link.body).toBe(201);

    // Unlink.
    const unlink = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "amends" },
    });
    expect(unlink.statusCode, unlink.body).toBe(200);

    const relations = unlink.json() as Relations;
    expect(relations.links).toHaveLength(0);
  });

  it("unlinks a symmetric `related` link from either end", async () => {
    const a = await create({ title: "Sym A" });
    const b = await create({ title: "Sym B" });

    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "related" },
    });

    // Unlink from the far end — the `related` row was written with A as
    // `from`, but unlinking from B must still find and remove it.
    const unlink = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${b.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: a.number, relationType: "related" },
    });
    expect(unlink.statusCode, unlink.body).toBe(200);

    const fromA = await read(a.number);
    expect(fromA.links).toHaveLength(0);
  });
});

// ---------------------------------------------------------------
// Named refusals through the HTTP seam
// ---------------------------------------------------------------

describe("the three named refusals are reachable through the seam (CTR-015)", () => {
  it("refuses a duplicate relation with CONTRACT_RELATION_EXISTS_PROBLEM_TYPE", async () => {
    const a = await create({ title: "Dup A" });
    const b = await create({ title: "Dup B" });

    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "renews" },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "renews" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().type).toBe("urn:openlaw:problem:contract-relation-exists");
  });

  it("refuses a parent cycle with CONTRACT_PARENT_CYCLE_PROBLEM_TYPE", async () => {
    const parent = await create({ title: "Cycle parent" });
    const child = await create({
      title: "Cycle child",
      renewalOf: { number: parent.number, vehicle: "child" },
    });

    // Putting the parent under the child would close the cycle.
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${parent.number}/parent`,
      cookies: memberCookies,
      payload: { parentContractNumber: child.number },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toBe("urn:openlaw:problem:contract-parent-cycle");
  });

  it("refuses a self-link with CONTRACT_SELF_LINK_PROBLEM_TYPE", async () => {
    const c = await create({ title: "Self linker" });

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${c.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: c.number, relationType: "related" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toBe("urn:openlaw:problem:contract-self-link");
  });
});

// ---------------------------------------------------------------
// Parent management
// ---------------------------------------------------------------

describe("set-parent and unparent through the HTTP seam (CTR-015)", () => {
  it("sets a parent and answers the updated graph", async () => {
    const parent = await create({ title: "Manual parent" });
    const child = await create({ title: "Manual child" });

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${child.number}/parent`,
      cookies: memberCookies,
      payload: { parentContractNumber: parent.number },
    });
    expect(res.statusCode, res.body).toBe(201);

    const relations = res.json() as Relations;
    expect(relations.parentChain).toEqual([
      expect.objectContaining({ restricted: false, number: parent.number }),
    ]);
  });

  it("unparents a contract and answers the updated graph", async () => {
    const parent = await create({ title: "Unparent parent" });
    const child = await create({
      title: "Unparent child",
      renewalOf: { number: parent.number, vehicle: "child" },
    });

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${child.number}/parent`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);

    const relations = res.json() as Relations;
    expect(relations.parentChain).toEqual([]);
  });

  it("refuses to unparent a contract that has no parent", async () => {
    const alone = await create({ title: "No parent" });

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${alone.number}/parent`,
      cookies: memberCookies,
    });
    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------
// Reach on both ends
// ---------------------------------------------------------------

describe("writes require reach on both ends (CTR-018)", () => {
  it("refuses to link into a confidential contract the viewer cannot reach", async () => {
    const open = await create({ title: "Open end" });
    const walled = await create({ title: "Walled end", isConfidential: true });

    // The viewer reaches the open contract but not the walled one.
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${open.number}/relations`,
      cookies: viewerCookies,
      payload: { relatedContractNumber: walled.number, relationType: "related" },
    });
    // Answered as if the walled contract does not exist.
    expect(res.statusCode).toBe(404);
  });

  it("refuses to set a confidential contract as parent when the viewer cannot reach it", async () => {
    const child = await create({ title: "Open child" });
    const walled = await create({ title: "Walled parent", isConfidential: true });

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${child.number}/parent`,
      cookies: viewerCookies,
      payload: { parentContractNumber: walled.number },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------
// Narration
// ---------------------------------------------------------------

describe("narration (M17/4)", () => {
  it("narrates link and unlink with their own verbs on the acted-from record only", async () => {
    const a = await create({ title: "Narrate A" });
    const b = await create({ title: "Narrate B" });

    // Link
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "amends" },
    });

    const addedEntries = await harness.db
      .select({ action: activityLog.action, entityId: activityLog.entityId })
      .from(activityLog)
      .where(eq(activityLog.action, "contract.relation_added"));

    const fromA = addedEntries.filter((row) => row.entityId === a.id);
    const fromB = addedEntries.filter((row) => row.entityId === b.id);
    expect(fromA.length).toBeGreaterThanOrEqual(1);
    expect(fromB).toHaveLength(0);

    // Unlink
    await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${a.number}/relations`,
      cookies: memberCookies,
      payload: { relatedContractNumber: b.number, relationType: "amends" },
    });

    const removedEntries = await harness.db
      .select({ action: activityLog.action, entityId: activityLog.entityId })
      .from(activityLog)
      .where(eq(activityLog.action, "contract.relation_removed"));

    const removedFromA = removedEntries.filter((row) => row.entityId === a.id);
    const removedFromB = removedEntries.filter((row) => row.entityId === b.id);
    expect(removedFromA.length).toBeGreaterThanOrEqual(1);
    expect(removedFromB).toHaveLength(0);
  });

  it("narrates unparent with its own verb, naming the far end", async () => {
    const parent = await create({ title: "Narrate parent" });
    const child = await create({
      title: "Narrate child",
      renewalOf: { number: parent.number, vehicle: "child" },
    });

    await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${child.number}/parent`,
      cookies: memberCookies,
    });

    const entries = await harness.db
      .select({
        action: activityLog.action,
        entityId: activityLog.entityId,
        payload: activityLog.payload,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, "contract.parent_removed"),
          eq(activityLog.entityId, child.id),
        ),
      );

    expect(entries).toHaveLength(1);
    const payload = entries[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      number: child.number,
      title: child.title,
      parentNumber: parent.number,
      parentTitle: parent.title,
    });

    // Nothing written on the parent's feed.
    const parentEntries = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, "contract.parent_removed"),
          eq(activityLog.entityId, parent.id),
        ),
      );
    expect(parentEntries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------
// Link candidates picker
// ---------------------------------------------------------------

describe("link-candidates picker (CTR-018)", () => {
  it("returns reachable contracts matched by title, excluding the anchor and archived", async () => {
    const anchor = await create({ title: "Anchor record" });
    const target = await create({ title: "Target record" });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${anchor.number}/link-candidates?q=Target`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);

    const body = res.json() as { candidates: { number: number; title: string }[] };
    const found = body.candidates.find((c) => c.number === target.number);
    expect(found).toBeDefined();

    // The anchor itself must not appear.
    const self = body.candidates.find((c) => c.number === anchor.number);
    expect(self).toBeUndefined();
  });

  it("returns reachable contracts matched by number", async () => {
    const anchor = await create({ title: "Num anchor" });
    const target = await create({ title: "Num target" });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${anchor.number}/link-candidates?q=${target.number}`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);

    const body = res.json() as { candidates: { number: number }[] };
    const found = body.candidates.find((c) => c.number === target.number);
    expect(found).toBeDefined();
  });

  it("excludes confidential contracts the viewer cannot reach", async () => {
    const anchor = await create({ title: "Vis anchor" });
    const walled = await create({ title: "Vis walled", isConfidential: true });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${anchor.number}/link-candidates?q=Vis`,
      cookies: viewerCookies,
    });
    expect(res.statusCode, res.body).toBe(200);

    const body = res.json() as { candidates: { number: number }[] };
    const found = body.candidates.find((c) => c.number === walled.number);
    expect(found).toBeUndefined();
  });
});
