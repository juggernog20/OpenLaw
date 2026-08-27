// SPDX-License-Identifier: AGPL-3.0-only

/** DD-014 search reach, compared across five viewers of one install. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractStatuses,
  contractTeam,
  contractTypes,
  eq,
  matters,
  matterStatuses,
  matterTeam,
  matterTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const PEOPLE = {
  onTeam: {
    email: "search-on-team@example.com",
    displayName: "On Team Member",
    password: "correct-horse-battery",
    role: "legal_team_member",
  },
  offTeam: {
    email: "search-off-team@example.com",
    displayName: "Off Team Member",
    password: "correct-horse-battery",
    role: "legal_team_member",
  },
  contributor: {
    email: "search-contributor@example.com",
    displayName: "Search Contributor",
    password: "correct-horse-battery",
    role: "contributor",
  },
  business: {
    email: "search-business@example.com",
    displayName: "Search Business User",
    password: "correct-horse-battery",
    role: "business_user",
  },
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
let confidentialContractId = "";
let confidentialMatterId = "";
let publicContractId = "";

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies.set("administrator", await signInCookies(harness.app, ADMIN.email, ADMIN.password));
  const adminId = (
    await harness.db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email))
  )[0]!.id;

  const ids = new Map<string, string>();
  for (const person of Object.values(PEOPLE)) {
    const user = await provisionUser(harness.app.auth, person);
    await harness.db.update(users).set({ role: person.role }).where(eq(users.id, user.id));
    ids.set(person.role === "contributor" ? "contributor" : person.email, user.id);
    cookies.set(person.email, await signInCookies(harness.app, person.email, person.password));
  }

  const contractTypeId = (await harness.db.select({ id: contractTypes.id }).from(contractTypes))[0]!
    .id;
  const contractStatusId = (
    await harness.db.select({ id: contractStatuses.id }).from(contractStatuses)
  )[0]!.id;
  const matterTypeId = (await harness.db.select({ id: matterTypes.id }).from(matterTypes))[0]!.id;
  const matterStatusId = (
    await harness.db.select({ id: matterStatuses.id }).from(matterStatuses)
  )[0]!.id;

  const [confidentialContract] = await harness.db
    .insert(contracts)
    .values({
      title: "Sealedsearch Confidential Contract",
      contractTypeId,
      statusId: contractStatusId,
      isConfidential: true,
    })
    .returning({ id: contracts.id });
  confidentialContractId = confidentialContract!.id;
  const [confidentialMatter] = await harness.db
    .insert(matters)
    .values({
      title: "Sealedsearch Confidential Matter",
      matterTypeId,
      statusId: matterStatusId,
      createdBy: adminId,
      isConfidential: true,
    })
    .returning({ id: matters.id });
  confidentialMatterId = confidentialMatter!.id;
  const [publicContract] = await harness.db
    .insert(contracts)
    .values({
      title: "Public Contract",
      description: "Sealedsearch lower-ranked public result",
      contractTypeId,
      statusId: contractStatusId,
    })
    .returning({ id: contracts.id });
  publicContractId = publicContract!.id;

  for (const userId of [ids.get(PEOPLE.onTeam.email)!, ids.get("contributor")!]) {
    await harness.db.insert(contractTeam).values({
      contractId: confidentialContractId,
      userId,
      role: userId === ids.get("contributor") ? "contributor" : "member",
    });
    await harness.db.insert(matterTeam).values({
      matterId: confidentialMatterId,
      userId,
      role: userId === ids.get("contributor") ? "contributor" : "member",
    });
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function search(
  as: string,
  suffix = "",
): Promise<{ results: { id: string }[]; nextCursor: string | null }> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/search?q=sealedsearch${suffix}`,
    cookies: cookies.get(as)!,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

describe("the DD-014 gate in search", () => {
  it("requires a session", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/search?q=sealedsearch",
    });
    expect(response.statusCode, response.body).toBe(401);
  });

  it("answers Administrators, on-team Members, and Contributors from their reach", async () => {
    for (const viewer of ["administrator", PEOPLE.onTeam.email, PEOPLE.contributor.email]) {
      const ids = (await search(viewer)).results.map((row) => row.id);
      expect(ids).toContain(confidentialContractId);
      expect(ids).toContain(confidentialMatterId);
    }
  });

  it("omits off-team confidential rows before the limit, with no gap", async () => {
    const answer = await search(PEOPLE.offTeam.email, "&limit=1");
    expect(answer.results).toEqual([expect.objectContaining({ id: publicContractId })]);
    expect(answer.nextCursor).toBeNull();
    expect((await search(PEOPLE.offTeam.email, "&kind=matter")).results).toEqual([]);
  });

  it("gives a Business User the empty answer through the scope predicates", async () => {
    expect(await search(PEOPLE.business.email)).toEqual({ results: [], nextCursor: null });
  });
});
