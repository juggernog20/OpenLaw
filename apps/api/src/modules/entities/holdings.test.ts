// SPDX-License-Identifier: AGPL-3.0-only

/** M27/5's ownership graph and chart at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "entity-holdings-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "entity-holdings-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let corporationId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  corporationId = types
    .json()
    .entityTypes.find((row: { slug: string }) => row.slug === "corporation").id;
});

afterAll(async () => harness.stop());

async function newEntity(legalName: string, jurisdiction: string | null = null, status = "active") {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: {
      legalName,
      entityTypeId: corporationId,
      ...(jurisdiction ? { jurisdiction } : {}),
      status,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().entity as { id: string; legalName: string };
}

function createHolding(
  entityId: string,
  direction: "owner" | "owned",
  relatedEntityId: string,
  ownershipPercent: number,
) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${entityId}/holdings`,
    cookies: memberCookies,
    payload: { direction, relatedEntityId, ownershipPercent },
  });
}

describe("Entity Holdings", () => {
  it("keeps topology while rendering an unreachable side as restricted and nameless", async () => {
    const parent = await newEntity("Visible Chart Parent");
    const secret = await newEntity("Invisible Acquisition Vehicle");
    expect((await createHolding(parent.id, "owned", secret.id, 100)).statusCode).toBe(201);
    const sealed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${secret.id}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(sealed.statusCode, sealed.body).toBe(200);

    const holdings = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${parent.id}/holdings`,
      cookies: memberCookies,
    });
    expect(holdings.statusCode, holdings.body).toBe(200);
    expect(holdings.body).not.toContain("Invisible Acquisition Vehicle");
    expect(holdings.json().owned).toEqual([
      expect.objectContaining({ owned: { restricted: true }, ownershipPercent: 100 }),
    ]);

    const chart = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/chart",
      cookies: memberCookies,
    });
    expect(chart.statusCode, chart.body).toBe(200);
    expect(chart.body).not.toContain("Invisible Acquisition Vehicle");
    expect(chart.json().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parent.id, restricted: false }),
        expect.objectContaining({ id: secret.id, restricted: true }),
      ]),
    );
  });

  it("creates from either side and reads the same row in both directions", async () => {
    const parent = await newEntity("Holdings Delaware Parent", "Delaware");
    const uk = await newEntity("Holdings UK Subsidiary", "England & Wales");
    const uae = await newEntity("Holdings UAE Subsidiary", "Dubai");

    const fromOwnedSide = await createHolding(uk.id, "owner", parent.id, 100);
    expect(fromOwnedSide.statusCode, fromOwnedSide.body).toBe(201);
    const firstRow = fromOwnedSide.json().holding;
    expect(firstRow).toMatchObject({
      owner: { id: parent.id, legalName: parent.legalName },
      owned: { id: uk.id, legalName: uk.legalName },
      ownershipPercent: 100,
    });
    expect(fromOwnedSide.json().warnings).toEqual([]);

    const fromOwnerSide = await createHolding(parent.id, "owned", uae.id, 75.5);
    expect(fromOwnerSide.statusCode, fromOwnerSide.body).toBe(201);
    expect(fromOwnerSide.json().holding).toMatchObject({
      owner: { id: parent.id, legalName: parent.legalName },
      owned: { id: uae.id, legalName: uae.legalName },
      ownershipPercent: 75.5,
    });

    const parentRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${parent.id}/holdings`,
      cookies: memberCookies,
    });
    const ukRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${uk.id}/holdings`,
      cookies: memberCookies,
    });
    expect(parentRead.statusCode, parentRead.body).toBe(200);
    expect(parentRead.json().owners).toEqual([]);
    expect(parentRead.json().owned).toEqual(
      expect.arrayContaining([firstRow, fromOwnerSide.json().holding]),
    );
    expect(ukRead.statusCode, ukRead.body).toBe(200);
    expect(ukRead.json().owners).toEqual([firstRow]);
    expect(ukRead.json().owned).toEqual([]);
  });

  it("updates, deletes, and records each action on both affected Entities", async () => {
    const owner = await newEntity("Holding Activity Owner");
    const owned = await newEntity("Holding Activity Owned");
    const created = await createHolding(owner.id, "owned", owned.id, 25);
    expect(created.statusCode, created.body).toBe(201);

    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${owner.id}/holdings/${owned.id}`,
      cookies: memberCookies,
      payload: { ownershipPercent: 40 },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().holding).toMatchObject({
      owner: { id: owner.id },
      owned: { id: owned.id },
      ownershipPercent: 40,
    });

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${owned.id}/holdings/${owner.id}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const actions = await harness.db
      .select({ action: activityLog.action, entityId: activityLog.entityId })
      .from(activityLog)
      .where(
        and(
          inArray(activityLog.entityId, [owner.id, owned.id]),
          inArray(activityLog.action, [
            "entity_holding.created",
            "entity_holding.updated",
            "entity_holding.deleted",
          ]),
        ),
      );
    expect(actions).toHaveLength(6);
    for (const entityId of [owner.id, owned.id]) {
      expect(actions.filter((row) => row.entityId === entityId).map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "entity_holding.created",
          "entity_holding.updated",
          "entity_holding.deleted",
        ]),
      );
    }
  });

  it("refuses a self-holding as a clean 400", async () => {
    const entity = await newEntity("Self Holding Refused");
    const response = await createHolding(entity.id, "owned", entity.id, 100);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json().detail).toContain("cannot own itself");
  });

  it("refuses a three-hop cycle in the write transaction and names the loop", async () => {
    const alpha = await newEntity("Cycle Alpha");
    const beta = await newEntity("Cycle Beta");
    const gamma = await newEntity("Cycle Gamma");
    expect((await createHolding(alpha.id, "owned", beta.id, 100)).statusCode).toBe(201);
    expect((await createHolding(beta.id, "owned", gamma.id, 100)).statusCode).toBe(201);

    const response = await createHolding(gamma.id, "owned", alpha.id, 100);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().type).toBe("urn:openlaw:problem:entity-holding-cycle");
    expect(response.json().detail).toContain(
      "Cycle Gamma → Cycle Alpha → Cycle Beta → Cycle Gamma",
    );
  });

  it("returns an over-100 warning without refusing the write", async () => {
    const first = await newEntity("Warning First Owner");
    const second = await newEntity("Warning Second Owner");
    const owned = await newEntity("Warning Owned Entity");
    expect((await createHolding(first.id, "owned", owned.id, 70)).statusCode).toBe(201);
    const response = await createHolding(owned.id, "owner", second.id, 40);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().warnings).toEqual([
      {
        code: "ownership-over-100",
        ownedEntityId: owned.id,
        legalName: owned.legalName,
        totalPercent: 110,
      },
    ]);
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${owned.id}/holdings`,
      cookies: memberCookies,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().warnings).toEqual(response.json().warnings);
  });

  it("keeps every Holdings route at the Member+ floor", async () => {
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/entities/none/holdings" }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/entities/none/holdings",
        cookies: contributorCookies,
        payload: { direction: "owned", relatedEntityId: "other", ownershipPercent: 10 },
      }),
    ];
    const [anonymous, contributor] = await Promise.all(attempts);
    expect(anonymous!.statusCode).toBe(401);
    expect(contributor!.statusCode).toBe(403);
  });
});

describe("GET /entities/chart", () => {
  it("returns reachable nodes, Holdings, the majority spine, and legal-name tie-breaks", async () => {
    const high = await newEntity("Chart High Owner");
    const low = await newEntity("Chart Low Owner");
    const majorityChild = await newEntity("Chart Majority Child", "England & Wales", "dormant");
    const tieZulu = await newEntity("Chart Zulu Owner");
    const tieAlpha = await newEntity("Chart Alpha Owner");
    const tieChild = await newEntity("Chart Tie Child");
    const unconnected = await newEntity("Chart Unconnected");
    const archived = await newEntity("Chart Archived Reachable");

    expect((await createHolding(high.id, "owned", majorityChild.id, 70)).statusCode).toBe(201);
    expect((await createHolding(low.id, "owned", majorityChild.id, 30)).statusCode).toBe(201);
    expect((await createHolding(tieZulu.id, "owned", tieChild.id, 50)).statusCode).toBe(201);
    expect((await createHolding(tieAlpha.id, "owned", tieChild.id, 50)).statusCode).toBe(201);
    const archivedResponse = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${archived.id}/archive`,
      cookies: memberCookies,
    });
    expect(archivedResponse.statusCode, archivedResponse.body).toBe(200);

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/chart",
      cookies: memberCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    const chart = response.json() as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    expect(chart.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: majorityChild.id,
          legalName: majorityChild.legalName,
          type: "Corporation",
          jurisdiction: "England & Wales",
          status: "dormant",
          primaryOwnerId: high.id,
        }),
        expect.objectContaining({ id: tieChild.id, primaryOwnerId: tieAlpha.id }),
        expect.objectContaining({ id: unconnected.id, primaryOwnerId: null }),
        expect.objectContaining({ id: archived.id, primaryOwnerId: null }),
      ]),
    );
    expect(chart.edges).toEqual(
      expect.arrayContaining([
        { ownerEntityId: high.id, ownedEntityId: majorityChild.id, ownershipPercent: 70 },
        { ownerEntityId: low.id, ownedEntityId: majorityChild.id, ownershipPercent: 30 },
      ]),
    );
  });
});
