// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The converted-record projection (#465).
 *
 * The Inbox and staff detail keep their HTTP assertions in their own
 * suites. This pins the one reach-aware resolver both call and both
 * record arms M22 completed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractTeam,
  contractTypes,
  eq,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import type { AuthenticatedUser } from "../../auth/guards.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { selectConvertedRecords } from "./projection.js";

const MEMBER = {
  email: "projection-member@example.com",
  displayName: "Projection Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let requestTypeId: string;
let contractTypeId: string;
let requesterId: string;
let admin: AuthenticatedUser;
let member: AuthenticatedUser;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const memberRow = await provisionUser(harness.app.auth, MEMBER);
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, memberRow.id));

  const [[adminRow], [storedMember]] = await Promise.all([
    harness.db.select().from(users).where(eq(users.email, ADMIN.email)),
    harness.db.select().from(users).where(eq(users.id, memberRow.id)),
  ]);
  const [type] = await harness.db.select().from(requestTypes).limit(1);
  const [contractType] = await harness.db.select().from(contractTypes).limit(1);
  requesterId = memberRow.id;
  requestTypeId = type!.id;
  contractTypeId = contractType!.id;
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  admin = authenticated(adminRow!);
  member = authenticated(storedMember!);
});

afterAll(async () => {
  await harness.stop();
});

function authenticated(row: {
  id: string;
  email: string;
  displayName: string;
  role: AuthenticatedUser["role"];
  theme: AuthenticatedUser["theme"];
  timezone: string | null;
}): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    theme: row.theme,
    timezone: row.timezone,
  };
}

async function createContract(title: string, isConfidential: boolean) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId, isConfidential },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().contract as { id: string; number: number };
}

async function plantRequest(convertedContractId: string | null) {
  const [request] = await harness.db
    .insert(requests)
    .values({
      requestTypeId,
      requesterId,
      summary: "Projection fixture",
      urgency: "medium",
      status: convertedContractId === null ? "new" : "converted",
      convertedContractId,
    })
    .returning();
  return request!;
}

describe("selectConvertedRecords", () => {
  it("answers a module-aware reference for each reachable converted Request", async () => {
    const contract = await createContract("Reachable conversion", false);
    const converted = await plantRequest(contract.id);
    const undecided = await plantRequest(null);

    const records = await selectConvertedRecords(harness.db, member, [converted.id, undecided.id]);

    expect(records.get(converted.id)).toEqual({
      module: "contract",
      id: contract.id,
      number: contract.number,
    });
    expect(records.has(undecided.id)).toBe(false);
  });

  it("applies confidentiality reach and keeps the same answer for a team member", async () => {
    const contract = await createContract("Confidential conversion", true);
    const request = await plantRequest(contract.id);

    expect((await selectConvertedRecords(harness.db, member, [request.id])).has(request.id)).toBe(
      false,
    );
    expect((await selectConvertedRecords(harness.db, admin, [request.id])).get(request.id)).toEqual(
      {
        module: "contract",
        id: contract.id,
        number: contract.number,
      },
    );

    await harness.db
      .insert(contractTeam)
      .values({ contractId: contract.id, userId: member.id, role: "member" });
    expect(
      (await selectConvertedRecords(harness.db, member, [request.id])).get(request.id),
    ).toEqual({
      module: "contract",
      id: contract.id,
      number: contract.number,
    });
  });

  it("answers no reference for an archived converted record", async () => {
    const contract = await createContract("Archived conversion", false);
    const request = await plantRequest(contract.id);
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, contract.id));

    expect((await selectConvertedRecords(harness.db, admin, [request.id])).has(request.id)).toBe(
      false,
    );
  });
});
