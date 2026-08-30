// SPDX-License-Identifier: AGPL-3.0-only

/** M27/9's filtered, sorted, keyset-paged Entity registry. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entities, entityHoldings, entityObligations, entityTypes, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "entity-list-member@example.com",
  displayName: "Elena Entity",
  password: "correct-horse-battery",
} as const;

interface EntityListAnswer {
  entities: {
    id: string;
    legalName: string;
    entityTypeId: string;
    entityTypeName: string;
    jurisdiction: string | null;
    status: "active" | "dormant" | "dissolved" | "divested";
    archivedAt: string | null;
    createdAt: string;
    nextObligation: { label: string; dueOn: string } | null;
  }[];
  nextCursor: string | null;
}

let harness: TestHarness;
let memberCookies: Record<string, string>;
let corporationId = "";
let llcId = "";
const targetIds = ["entity-list-target-a", "entity-list-target-b"] as const;
const ownerIds = ["entity-list-owner-a", "entity-list-owner-b"] as const;

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

  const types = await harness.db.select().from(entityTypes);
  corporationId = types.find((row) => row.slug === "corporation")!.id;
  llcId = types.find((row) => row.slug === "llc")!.id;
  const tiedCreatedAt = new Date("2026-08-30T08:00:00.000Z");

  await harness.db.insert(entities).values([
    {
      id: ownerIds[0],
      legalName: "Alpha Parent",
      entityTypeId: corporationId,
      jurisdiction: "England & Wales",
      createdAt: new Date("2026-08-29T08:00:00.000Z"),
    },
    {
      id: ownerIds[1],
      legalName: "Beta Parent",
      entityTypeId: corporationId,
      jurisdiction: "England & Wales",
      createdAt: tiedCreatedAt,
    },
    {
      id: targetIds[0],
      legalName: "Twin Registry Name",
      entityTypeId: llcId,
      jurisdiction: "United Arab Emirates",
      status: "dormant",
      createdAt: tiedCreatedAt,
    },
    {
      id: targetIds[1],
      legalName: "Twin Registry Name",
      entityTypeId: llcId,
      jurisdiction: "United Arab Emirates",
      status: "dormant",
      createdAt: tiedCreatedAt,
    },
    {
      id: "entity-list-archived",
      legalName: "Archived Registry Row",
      entityTypeId: corporationId,
      archivedAt: new Date("2026-08-29T00:00:00.000Z"),
    },
    ...Array.from({ length: 49 }, (_, index) => ({
      id: `entity-list-page-${String(index).padStart(2, "0")}`,
      legalName: `Paged Entity ${String(index).padStart(2, "0")}`,
      entityTypeId: corporationId,
      jurisdiction: "Paging Jurisdiction",
      createdAt: tiedCreatedAt,
    })),
  ]);
  await harness.db.insert(entityHoldings).values([
    { ownerEntityId: ownerIds[0], ownedEntityId: targetIds[0], ownershipPercent: "60" },
    { ownerEntityId: ownerIds[1], ownedEntityId: targetIds[0], ownershipPercent: "40" },
    { ownerEntityId: ownerIds[0], ownedEntityId: targetIds[1], ownershipPercent: "40" },
    { ownerEntityId: ownerIds[1], ownedEntityId: targetIds[1], ownershipPercent: "60" },
  ]);
  await harness.db.insert(entityObligations).values([
    {
      id: "entity-list-obligation-later",
      entityId: targetIds[0],
      label: "Later filing",
      nextDueOn: "2026-12-01",
    },
    {
      id: "entity-list-obligation-first",
      entityId: targetIds[0],
      label: "First filing",
      nextDueOn: "2026-10-01",
    },
    {
      id: "entity-list-obligation-completed",
      entityId: targetIds[0],
      label: "Completed filing",
      nextDueOn: "2026-09-01",
      completedOn: "2026-08-01",
    },
    {
      id: "entity-list-obligation-tied",
      entityId: targetIds[1],
      label: "Same-day filing",
      nextDueOn: "2026-10-01",
    },
  ]);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function list(query: Record<string, string> = {}): Promise<EntityListAnswer> {
  const search = new URLSearchParams(query);
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/entities${search.size ? `?${search.toString()}` : ""}`,
    cookies: memberCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as EntityListAnswer;
}

describe("the managed Entity registry", () => {
  it("applies every filter alone and composes them with AND", async () => {
    expect((await list({ type: llcId })).entities.map((row) => row.id)).toEqual(targetIds);
    expect((await list({ status: "dormant" })).entities.map((row) => row.id)).toEqual(targetIds);
    expect(
      (await list({ jurisdiction: "United Arab Emirates" })).entities.map((row) => row.id),
    ).toEqual(targetIds);
    expect((await list({ majorityOwner: ownerIds[0] })).entities.map((row) => row.id)).toEqual([
      targetIds[0],
    ]);
    expect(
      (
        await list({
          type: llcId,
          status: "dormant",
          jurisdiction: "United Arab Emirates",
          majorityOwner: ownerIds[0],
        })
      ).entities.map((row) => row.id),
    ).toEqual([targetIds[0]]);
  });

  it("sorts every supported value and uses the Entity id as the stable tie-break", async () => {
    const keys = ["name", "type", "jurisdiction", "status", "nextObligation", "created"] as const;
    const value = (row: EntityListAnswer["entities"][number], key: (typeof keys)[number]) => {
      switch (key) {
        case "name":
          return row.legalName.toLowerCase();
        case "type":
          return row.entityTypeName.toLowerCase();
        case "jurisdiction":
          return row.jurisdiction?.toLowerCase() ?? null;
        case "status":
          return row.status;
        case "nextObligation":
          return row.nextObligation?.dueOn ?? null;
        case "created":
          return row.createdAt;
      }
    };
    for (const sort of keys) {
      for (const dir of ["asc", "desc"] as const) {
        const answer = await list({ sort, dir });
        for (let index = 1; index < answer.entities.length; index += 1) {
          const previous = answer.entities[index - 1]!;
          const current = answer.entities[index]!;
          const previousValue = value(previous, sort);
          const currentValue = value(current, sort);
          if (previousValue === null) expect(currentValue).toBeNull();
          else if (currentValue !== null) {
            const compared = previousValue.localeCompare(currentValue);
            expect(dir === "asc" ? compared <= 0 : compared >= 0).toBe(true);
            if (compared === 0) expect(previous.id.localeCompare(current.id)).toBeLessThan(0);
          }
        }
      }
      const tiedAsc = await list({ type: llcId, sort, dir: "asc" });
      const tiedDesc = await list({ type: llcId, sort, dir: "desc" });
      expect(tiedAsc.entities.map((row) => row.id)).toEqual(targetIds);
      expect(tiedDesc.entities.map((row) => row.id)).toEqual(targetIds);
    }
  });

  it("pages after filtering and sorting without duplicates or gaps", async () => {
    const first = await list({ sort: "created", dir: "asc" });
    expect(first.entities).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await list({ sort: "created", dir: "asc", cursor: first.nextCursor! });
    const ids = [...first.entities, ...second.entities].map((row) => row.id);
    expect(ids).toHaveLength(53);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.nextCursor).toBeNull();
  });

  it("projects the soonest open obligation and ignores a completed earlier one", async () => {
    const answer = await list({ majorityOwner: ownerIds[0] });
    expect(answer.entities[0]!.nextObligation).toEqual({
      label: "First filing",
      dueOn: "2026-10-01",
    });
    expect((await list({ jurisdiction: "Paging Jurisdiction" })).entities[0]!.nextObligation).toBe(
      null,
    );
  });

  it("keeps archived rows out by default and includes them on request", async () => {
    expect((await list()).entities.some((row) => row.id === "entity-list-archived")).toBe(false);
    expect(
      (await list({ includeArchived: "true" })).entities.some(
        (row) => row.id === "entity-list-archived",
      ),
    ).toBe(true);
  });

  it("rejects unsupported sort and status values at the HTTP boundary", async () => {
    for (const query of ["sort=updated", "status=liquidated"]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/entities?${query}`,
        cookies: memberCookies,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
