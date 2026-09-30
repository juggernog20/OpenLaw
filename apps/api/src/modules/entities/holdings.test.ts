// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M27/5's ownership graph and chart at the HTTP seam. A Holding is
 * projected from the owned Entity's share register (ENT-012), so every
 * fixture here is an allotment; the register's own rules are in
 * `share-register.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
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
    [CONTRIBUTOR, "business_user"],
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

async function newEntity(
  legalName: string,
  jurisdiction: string | null = null,
  status = "active",
  cookies = memberCookies,
) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies,
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

const classes = new Map<string, string>();

/**
 * Allots `quantity` shares of `owned` to a holder, on one Ordinary class
 * per Entity. A holder's percentage is its allotted shares over the
 * register's total, so a test fills each register to a round number.
 */
async function allot(
  owned: { id: string },
  holder: { id: string } | string,
  quantity: number,
  cookies = memberCookies,
) {
  let shareClassId = classes.get(owned.id);
  if (!shareClassId) {
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${owned.id}/share-classes`,
      cookies,
      payload: { name: "Ordinary" },
    });
    expect(created.statusCode, created.body).toBe(201);
    shareClassId = (created.json().classes as { id: string; name: string }[]).find(
      (row) => row.name === "Ordinary",
    )!.id;
    classes.set(owned.id, shareClassId);
  }
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${owned.id}/share-entries`,
    cookies,
    payload: {
      kind: "allotment",
      effectiveOn: "2024-01-01",
      shareClassId,
      quantity,
      to:
        typeof holder === "string"
          ? { kind: "individual", name: holder }
          : { kind: "entity", entityId: holder.id },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function seal(entityId: string) {
  const sealed = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/entities/${entityId}`,
    cookies: adminCookies,
    payload: { isConfidential: true },
  });
  expect(sealed.statusCode, sealed.body).toBe(200);
}

describe("Entity Holdings", () => {
  it("keeps topology while rendering an unreachable side as restricted and nameless", async () => {
    const parent = await newEntity("Visible Chart Parent");
    const secret = await newEntity("Invisible Acquisition Vehicle", null, "active", adminCookies);
    await allot(secret, parent, 100, adminCookies);
    await seal(secret.id);

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

  it("draws no edge between two walled Entities, even when each touches a visible one", async () => {
    const parent = await newEntity("Visible Twin Parent");
    const first = await newEntity("Walled Twin First", null, "active", adminCookies);
    const second = await newEntity("Walled Twin Second", null, "active", adminCookies);
    await allot(first, parent, 100, adminCookies);
    await allot(second, parent, 50, adminCookies);
    await allot(second, first, 50, adminCookies);
    for (const id of [first.id, second.id]) await seal(id);
    const chart = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/chart",
      cookies: memberCookies,
    });
    expect(chart.statusCode, chart.body).toBe(200);
    const edges = chart.json().edges as { ownerEntityId: string; ownedEntityId: string }[];
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerEntityId: parent.id, ownedEntityId: first.id }),
        expect.objectContaining({ ownerEntityId: parent.id, ownedEntityId: second.id }),
      ]),
    );
    expect(edges.some((edge) => edge.ownerEntityId === first.id)).toBe(false);
  });

  it("reads the same projected row from the owner and from the owned Entity", async () => {
    const parent = await newEntity("Holdings Delaware Parent", "Delaware");
    const uk = await newEntity("Holdings UK Subsidiary", "England & Wales");
    const uae = await newEntity("Holdings UAE Subsidiary", "Dubai");
    await allot(uk, parent, 100);
    await allot(uae, parent, 151);
    await allot(uae, "Minority Holder", 49);

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
    expect(parentRead.json().owned).toEqual([
      expect.objectContaining({
        owner: { restricted: false, id: parent.id, legalName: parent.legalName },
        owned: { restricted: false, id: uae.id, legalName: uae.legalName },
        ownershipPercent: 75.5,
      }),
      expect.objectContaining({
        owner: { restricted: false, id: parent.id, legalName: parent.legalName },
        owned: { restricted: false, id: uk.id, legalName: uk.legalName },
        ownershipPercent: 100,
      }),
    ]);
    expect(ukRead.statusCode, ukRead.body).toBe(200);
    expect(ukRead.json().owners).toEqual([parentRead.json().owned[1]]);
    expect(ukRead.json().owned).toEqual([]);
  });

  it("has no route that writes a Holding by hand", async () => {
    const owner = await newEntity("Typed Holding Owner");
    const owned = await newEntity("Typed Holding Owned");
    const attempts = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: `/api/v1/entities/${owner.id}/holdings`,
        cookies: memberCookies,
        payload: { direction: "owned", relatedEntityId: owned.id, ownershipPercent: 100 },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/entities/${owner.id}/holdings/${owned.id}`,
        cookies: memberCookies,
        payload: { ownershipPercent: 10 },
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/entities/${owner.id}/holdings/${owned.id}`,
        cookies: memberCookies,
      }),
    ]);
    for (const refused of attempts) expect(refused.statusCode, refused.body).toBe(404);
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${owner.id}/holdings`,
      cookies: memberCookies,
    });
    expect(read.json()).toEqual({ owners: [], owned: [] });
  });

  it("keeps both Holdings routes at the Member+ floor", async () => {
    for (const url of ["/api/v1/entities/none/holdings", "/api/v1/entities/chart"]) {
      const anonymous = await harness.app.inject({ method: "GET", url });
      expect(anonymous.statusCode, anonymous.body).toBe(401);
      const contributor = await harness.app.inject({
        method: "GET",
        url,
        cookies: contributorCookies,
      });
      expect(contributor.statusCode, contributor.body).toBe(403);
    }
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

    await allot(majorityChild, high, 70);
    await allot(majorityChild, low, 30);
    await allot(tieChild, tieZulu, 50);
    await allot(tieChild, tieAlpha, 50);
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

it("uses the largest Holding as the primary owner even below fifty percent", async () => {
  const largest = await newEntity("Minority largest owner");
  const other = await newEntity("Minority other owner");
  const child = await newEntity("Minority owned Entity");
  await allot(child, largest, 30);
  await allot(child, other, 20);
  await allot(child, "First Minority Person", 25);
  await allot(child, "Second Minority Person", 25);
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/chart",
    cookies: memberCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().nodes).toContainEqual(
    expect.objectContaining({ id: child.id, primaryOwnerId: largest.id }),
  );
});

it("lists a register's individual holders as owners and draws them on the chart", async () => {
  const company = await newEntity("Individual-owned company");
  const corporateOwner = await newEntity("Corporate co-owner");
  await allot(company, corporateOwner, 60);
  await allot(company, "Alex Morgan", 40);
  const read = await harness.app.inject({
    method: "GET",
    url: `/api/v1/entities/${company.id}/holdings`,
    cookies: memberCookies,
  });
  expect(read.statusCode, read.body).toBe(200);
  const person = (
    read.json().owners as { owner: { id: string; kind?: string; legalName: string } }[]
  ).find((row) => row.owner.kind === "individual")!.owner;
  expect(person).toMatchObject({ kind: "individual", legalName: "Alex Morgan", restricted: false });
  const chart = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/chart",
    cookies: memberCookies,
  });
  expect(chart.json().nodes).toContainEqual(
    expect.objectContaining({
      id: person.id,
      kind: "individual",
      legalName: "Alex Morgan",
      status: null,
    }),
  );
  expect(chart.json().edges).toContainEqual({
    ownerEntityId: person.id,
    ownedEntityId: company.id,
    ownershipPercent: 40,
  });
});

it("protects individual names behind the owned Entity's access", async () => {
  const company = await newEntity("Private person holding", null, "active", adminCookies);
  await allot(company, "Private Person", 100, adminCookies);
  const before = await harness.app.inject({
    method: "GET",
    url: `/api/v1/entities/${company.id}/holdings`,
    cookies: memberCookies,
  });
  const personId = before.json().owners[0].owner.id as string;
  await seal(company.id);
  const chart = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/chart",
    cookies: memberCookies,
  });
  expect(chart.body).not.toContain("Private Person");
  expect(chart.body).not.toContain(personId);
  const walled = await harness.app.inject({
    method: "GET",
    url: `/api/v1/entities/${company.id}/holdings`,
    cookies: memberCookies,
  });
  expect(walled.statusCode, walled.body).toBe(404);
});
