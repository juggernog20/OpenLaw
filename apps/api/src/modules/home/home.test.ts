// SPDX-License-Identifier: AGPL-3.0-only

/** The M29 Home read, through the real app factory and real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractApprovals, contracts, contractTeam, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const REQUESTER = {
  email: "home-requester@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const APPROVER = {
  email: "home-approver@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery",
} as const;
const OTHER = {
  email: "home-other@example.com",
  displayName: "Marcus Webb",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "home-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

interface ApprovalSection {
  type: "approvals";
  total: number;
  rows: Array<{
    id: string;
    contract: { id: string; number: number; title: string; isConfidential: boolean };
    requestedBy: { id: string; displayName: string };
    requestedAt: string;
  }>;
}

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => userIds.get(fixture.email)!;
const as = (fixture: { email: string }): Record<string, string> => cookies.get(fixture.email)!;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  userIds.set(ADMIN.email, admin!.id);
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  for (const [fixture, role] of [
    [REQUESTER, "legal_team_member"],
    [APPROVER, "legal_team_member"],
    [OTHER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
}, 180_000);

afterAll(async () => harness?.stop());

async function newContract(title: string): Promise<ContractRow> {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(REQUESTER),
  });
  const type = (options.json().contractTypes as Array<{ id: string; slug: string }>).find(
    (row) => row.slug === "nda",
  );
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(REQUESTER),
    payload: { title, contractTypeId: type!.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().contract as ContractRow;
}

async function ask(contract: ContractRow, approver = APPROVER): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(contract.number)}/approvals`,
    cookies: as(REQUESTER),
    payload: { approverIds: [idOf(approver)] },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json().approvals as Array<{ id: string }>).at(-1)!.id;
}

async function home(fixture: { email: string }) {
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/home",
    cookies: as(fixture),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { sections: ApprovalSection[] };
}

describe("GET /api/v1/home", () => {
  it("caps and totals the viewer's pending approvals, oldest first", async () => {
    const eligible: Array<{ contract: ContractRow; approvalId: string }> = [];
    for (const title of ["Oldest ask", "Second ask", "Third ask", "Newest ask"]) {
      const contract = await newContract(title);
      eligible.push({ contract, approvalId: await ask(contract) });
    }
    for (const [index, row] of eligible.entries()) {
      await harness.db
        .update(contractApprovals)
        .set({ createdAt: new Date(`2026-08-${String(10 + index).padStart(2, "0")}T09:00:00Z`) })
        .where(eq(contractApprovals.id, row.approvalId));
    }

    const decidedContract = await newContract("Already decided");
    const decidedId = await ask(decidedContract);
    const decided = await harness.app.inject({
      method: "POST",
      url: `/api/v1/approvals/${decidedId}/decision`,
      cookies: as(APPROVER),
      payload: { decision: "approved" },
    });
    expect(decided.statusCode, decided.body).toBe(200);

    const archivedContract = await newContract("Archived contract");
    await ask(archivedContract);
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date("2026-08-20T09:00:00Z") })
      .where(eq(contracts.id, archivedContract.id));

    const result = await home(APPROVER);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ type: "approvals", total: 4 });
    expect(result.sections[0]!.rows).toHaveLength(3);
    expect(result.sections[0]!.rows.map((row) => row.contract.title)).toEqual([
      "Oldest ask",
      "Second ask",
      "Third ask",
    ]);
    expect(result.sections[0]!.rows[0]).toMatchObject({
      requestedBy: { id: idOf(REQUESTER), displayName: REQUESTER.displayName },
      contract: { isConfidential: false },
    });
    expect(result.sections[0]!.rows[0]!.requestedAt).toBe("2026-08-10T09:00:00.000Z");
  });

  it("omits the section for a non-approver", async () => {
    expect((await home(OTHER)).sections).toEqual([]);
  });

  it("admits a Contributor without widening the Approvals projection", async () => {
    expect((await home(CONTRIBUTOR)).sections).toEqual([]);
  });

  it("silently removes a Confidential Contract the approver no longer reaches", async () => {
    const contract = await newContract("Confidential acquisition");
    const team = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/team`,
      cookies: as(REQUESTER),
      payload: { userId: idOf(APPROVER), role: "member" },
    });
    expect(team.statusCode, team.body).toBe(201);
    await ask(contract);
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, contract.id));
    await harness.db.delete(contractTeam).where(eq(contractTeam.contractId, contract.id));

    const section = (await home(APPROVER)).sections[0]!;
    expect(section.total).toBe(4);
    expect(section.rows).toHaveLength(3);
    expect(section.rows.some((row) => row.contract.id === contract.id)).toBe(false);
  });
});
