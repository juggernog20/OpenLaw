// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractStatuses,
  contractTypes,
  entities,
  entityTypes,
  eq,
  fields,
  matters,
  matterStatuses,
  matterTypeFields,
  matterTypes,
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
  email: "entity-rollups@example.com",
  displayName: "Entity Rollups",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "entity-rollups-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let cookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let entityId: string;
/** Confidential, with no grant for MEMBER: walled from the roll-ups. */
let walledEntityId: string;

const ROLL_UP_PATHS = ["contracts", "matters", "linked-record-counts"] as const;

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  cookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, contributor.id));
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const [entityType] = await harness.db.select({ id: entityTypes.id }).from(entityTypes).limit(1);
  const [entity] = await harness.db
    .insert(entities)
    .values({ legalName: "UK Subsidiary", entityTypeId: entityType!.id })
    .returning({ id: entities.id });
  entityId = entity!.id;
  const [walled] = await harness.db
    .insert(entities)
    .values({ legalName: "Walled Vehicle", entityTypeId: entityType!.id, isConfidential: true })
    .returning({ id: entities.id });
  walledEntityId = walled!.id;
  const [contractType] = await harness.db
    .select({ id: contractTypes.id })
    .from(contractTypes)
    .limit(1);
  const [contractStatus] = await harness.db
    .select({ id: contractStatuses.id })
    .from(contractStatuses)
    .limit(1);
  await harness.db.insert(contracts).values([
    {
      title: "Visible signed contract",
      contractTypeId: contractType!.id,
      statusId: contractStatus!.id,
      entityId,
    },
    {
      title: "Walled signed contract",
      contractTypeId: contractType!.id,
      statusId: contractStatus!.id,
      entityId,
      isConfidential: true,
    },
  ]);

  const [matterType] = await harness.db.select({ id: matterTypes.id }).from(matterTypes).limit(1);
  const [matterStatus] = await harness.db
    .select({ id: matterStatuses.id })
    .from(matterStatuses)
    .limit(1);
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug: "named-entity",
      displayName: "Named Entity",
      moduleScope: "matter",
      fieldType: "entity",
    })
    .returning({ id: fields.id });
  await harness.db
    .insert(matterTypeFields)
    .values({ typeId: matterType!.id, fieldId: field!.id, displayOrder: 1 });
  await harness.db.insert(matters).values([
    {
      title: "Visible Entity matter",
      matterTypeId: matterType!.id,
      statusId: matterStatus!.id,
      createdBy: member.id,
      customFields: { "named-entity": entityId },
    },
    {
      title: "Walled Entity matter",
      matterTypeId: matterType!.id,
      statusId: matterStatus!.id,
      createdBy: member.id,
      customFields: { "named-entity": entityId },
      isConfidential: true,
    },
  ]);
});

afterAll(async () => harness.stop());

describe("Entity linked-record roll-ups", () => {
  it("omits independently walled targets from rows and counts", async () => {
    const [contractsAnswer, mattersAnswer, counts] = await Promise.all([
      harness.app.inject({ method: "GET", url: `/api/v1/entities/${entityId}/contracts`, cookies }),
      harness.app.inject({ method: "GET", url: `/api/v1/entities/${entityId}/matters`, cookies }),
      harness.app.inject({
        method: "GET",
        url: `/api/v1/entities/${entityId}/linked-record-counts`,
        cookies,
      }),
    ]);
    expect(contractsAnswer.statusCode, contractsAnswer.body).toBe(200);
    expect(mattersAnswer.statusCode, mattersAnswer.body).toBe(200);
    expect(contractsAnswer.json().records.map((row: { title: string }) => row.title)).toEqual([
      "Visible signed contract",
    ]);
    expect(mattersAnswer.json().records.map((row: { title: string }) => row.title)).toEqual([
      "Visible Entity matter",
    ]);
    expect(counts.json()).toEqual({ contracts: 1, matters: 1 });
    expect(contractsAnswer.json()).toMatchObject({
      total: 1,
      nextCursor: null,
      records: [{ contractTypeName: expect.any(String), manager: null }],
    });
    expect(mattersAnswer.json()).toMatchObject({
      total: 1,
      nextCursor: null,
      records: [{ matterTypeName: expect.any(String), priority: expect.any(String) }],
    });
  });

  it("sorts and pages full rows within the Entity scope", async () => {
    const [type] = await harness.db.select().from(entityTypes).limit(1);
    const [entity] = await harness.db
      .insert(entities)
      .values({ legalName: "Paged vehicle", entityTypeId: type!.id })
      .returning();
    const [contract] = await harness.db.select().from(contracts).limit(1);
    const [matter] = await harness.db.select().from(matters).limit(1);
    await harness.db.insert(contracts).values(
      Array.from({ length: 51 }, (_, index) => ({
        title: `Contract ${String(index).padStart(2, "0")}`,
        entityId: entity!.id,
        contractTypeId: contract!.contractTypeId,
        statusId: contract!.statusId,
      })),
    );
    await harness.db.insert(matters).values(
      Array.from({ length: 51 }, (_, index) => ({
        title: `Matter ${String(index).padStart(2, "0")}`,
        customFields: { "named-entity": entity!.id },
        matterTypeId: matter!.matterTypeId,
        statusId: matter!.statusId,
        createdBy: matter!.createdBy,
      })),
    );
    for (const kind of ["contracts", "matters"]) {
      const url = `/api/v1/entities/${entity!.id}/${kind}?sort=title&dir=asc`;
      const first = await harness.app.inject({ method: "GET", url, cookies });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().total).toBe(51);
      expect(first.json().records).toHaveLength(50);
      expect(first.json().records[0].title).toMatch(/00$/);
      const last = await harness.app.inject({
        method: "GET",
        url: `${url}&cursor=${first.json().nextCursor}`,
        cookies,
      });
      expect(last.statusCode, last.body).toBe(200);
      expect(last.json().records).toHaveLength(1);
      expect(last.json().records[0].title).toMatch(/50$/);
      expect(last.json().nextCursor).toBeNull();
    }
  });

  it("answers 404 for a confidential Entity the Legal Team Member holds no grant on", async () => {
    for (const path of ROLL_UP_PATHS) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/entities/${walledEntityId}/${path}`,
        cookies,
      });
      expect(response.statusCode, `${path}: ${response.body}`).toBe(404);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.body).not.toContain("Walled Vehicle");
    }
  });

  it("refuses a Contributor and an anonymous caller on every roll-up", async () => {
    for (const path of ROLL_UP_PATHS) {
      const contributor = await harness.app.inject({
        method: "GET",
        url: `/api/v1/entities/${entityId}/${path}`,
        cookies: contributorCookies,
      });
      expect(contributor.statusCode, `${path}: ${contributor.body}`).toBe(403);
      const anonymous = await harness.app.inject({
        method: "GET",
        url: `/api/v1/entities/${entityId}/${path}`,
      });
      expect(anonymous.statusCode, `${path}: ${anonymous.body}`).toBe(401);
    }
  });
});
