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

let harness: TestHarness;
let cookies: Record<string, string>;
let entityId: string;

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  cookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const [entityType] = await harness.db.select({ id: entityTypes.id }).from(entityTypes).limit(1);
  const [entity] = await harness.db
    .insert(entities)
    .values({ legalName: "UK Subsidiary", entityTypeId: entityType!.id })
    .returning({ id: entities.id });
  entityId = entity!.id;
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
      fieldTag: "legal",
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
  });
});
