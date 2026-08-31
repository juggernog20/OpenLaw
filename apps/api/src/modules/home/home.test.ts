// SPDX-License-Identifier: AGPL-3.0-only

/** The M29 Home read, through the real app factory and real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contractApprovals,
  contracts,
  contractStatuses,
  contractTasks,
  contractTeam,
  eq,
  matters,
  matterStatuses,
  matterTasks,
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

interface TaskSection {
  type: "tasks";
  total: number;
  rows: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    isOverdue: boolean;
    record: {
      kind: "contract" | "matter";
      id: string;
      number: number;
      title: string;
      isConfidential: boolean;
    };
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
  return response.json() as { sections: Array<ApprovalSection | TaskSection> };
}

function tasksIn(result: Awaited<ReturnType<typeof home>>): TaskSection | undefined {
  return result.sections.find((section): section is TaskSection => section.type === "tasks");
}

function approvalsIn(result: Awaited<ReturnType<typeof home>>): ApprovalSection | undefined {
  return result.sections.find(
    (section): section is ApprovalSection => section.type === "approvals",
  );
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
    const section = approvalsIn(result)!;
    expect(section).toMatchObject({ type: "approvals", total: 4 });
    expect(section.rows).toHaveLength(3);
    expect(section.rows.map((row) => row.contract.title)).toEqual([
      "Oldest ask",
      "Second ask",
      "Third ask",
    ]);
    expect(section.rows[0]).toMatchObject({
      requestedBy: { id: idOf(REQUESTER), displayName: REQUESTER.displayName },
      contract: { isConfidential: false },
    });
    expect(section.rows[0]!.requestedAt).toBe("2026-08-10T09:00:00.000Z");
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

    const section = approvalsIn(await home(APPROVER))!;
    expect(section.total).toBe(4);
    expect(section.rows).toHaveLength(3);
    expect(section.rows.some((row) => row.contract.id === contract.id)).toBe(false);
  });

  it("merges the viewer's open Contract and Matter Tasks before ordering, totals, and the cap", async () => {
    const [openMatterStatus] = await harness.db
      .select({ id: matterStatuses.id })
      .from(matterStatuses)
      .where(eq(matterStatuses.category, "open"))
      .limit(1);
    const [closedMatterStatus] = await harness.db
      .select({ id: matterStatuses.id })
      .from(matterStatuses)
      .where(eq(matterStatuses.category, "closed"))
      .limit(1);
    const [matterType] = await harness.db.select({ id: matterTypes.id }).from(matterTypes).limit(1);
    const [endedContractStatus] = await harness.db
      .select({ id: contractStatuses.id })
      .from(contractStatuses)
      .where(eq(contractStatuses.stage, "ended"))
      .limit(1);

    const createMatter = async (
      title: string,
      options: { closed?: boolean; archived?: boolean } = {},
    ) => {
      const [matter] = await harness.db
        .insert(matters)
        .values({
          title,
          matterTypeId: matterType!.id,
          statusId: options.closed ? closedMatterStatus!.id : openMatterStatus!.id,
          managerId: idOf(REQUESTER),
          createdBy: idOf(REQUESTER),
          closedAt: options.closed ? new Date("2026-08-01T09:00:00Z") : null,
          archivedAt: options.archived ? new Date("2026-08-01T09:00:00Z") : null,
        })
        .returning({ id: matters.id, number: matters.number });
      await harness.db
        .insert(matterTeam)
        .values({ matterId: matter!.id, userId: idOf(REQUESTER), role: "creator" });
      return matter!;
    };

    const confidential = await newContract("Confidential financing");
    await harness.db
      .insert(contractTeam)
      .values({ contractId: confidential.id, userId: idOf(APPROVER), role: "member" });
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, confidential.id));
    await harness.db.insert(contractTasks).values({
      contractId: confidential.id,
      title: "Prepare financing signature pages",
      assigneeId: idOf(APPROVER),
      dueDate: "2000-01-01",
      displayOrder: 0,
    });

    const overdueMatter = await createMatter("Employment investigation");
    await harness.db.insert(matterTasks).values({
      matterId: overdueMatter.id,
      title: "Draft witness outline",
      assigneeId: idOf(APPROVER),
      dueDate: "2000-01-02",
      displayOrder: 0,
    });

    const futureMatter = await createMatter("Regulatory response");
    await harness.db.insert(matterTasks).values({
      matterId: futureMatter.id,
      title: "Review response exhibits",
      assigneeId: idOf(APPROVER),
      dueDate: "2099-01-01",
      displayOrder: 0,
    });

    const undatedContract = await newContract("Supplier renewal");
    await harness.db.insert(contractTasks).values({
      contractId: undatedContract.id,
      title: "Confirm renewal owner",
      assigneeId: idOf(APPROVER),
      dueDate: null,
      displayOrder: 0,
    });

    const hidden = await newContract("Walled acquisition");
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, hidden.id));
    await harness.db.insert(contractTasks).values({
      contractId: hidden.id,
      title: "This must leave no gap",
      assigneeId: idOf(APPROVER),
      dueDate: "1990-01-01",
      displayOrder: 0,
    });

    const done = await newContract("Done task owner");
    await harness.db.insert(contractTasks).values({
      contractId: done.id,
      title: "Already complete",
      assigneeId: idOf(APPROVER),
      dueDate: "1991-01-01",
      displayOrder: 0,
      isDone: true,
    });

    const ended = await newContract("Ended task owner");
    await harness.db
      .update(contracts)
      .set({ statusId: endedContractStatus!.id, endedAt: new Date("2026-08-01T09:00:00Z") })
      .where(eq(contracts.id, ended.id));
    await harness.db.insert(contractTasks).values({
      contractId: ended.id,
      title: "Ended Contract task",
      assigneeId: idOf(APPROVER),
      dueDate: "1992-01-01",
      displayOrder: 0,
    });

    const archived = await newContract("Archived task owner");
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date("2026-08-01T09:00:00Z") })
      .where(eq(contracts.id, archived.id));
    await harness.db.insert(contractTasks).values({
      contractId: archived.id,
      title: "Archived Contract task",
      assigneeId: idOf(APPROVER),
      dueDate: "1993-01-01",
      displayOrder: 0,
    });

    const closed = await createMatter("Closed task owner", { closed: true });
    const archivedMatter = await createMatter("Archived Matter task owner", { archived: true });
    await harness.db.insert(matterTasks).values([
      {
        matterId: closed.id,
        title: "Closed Matter task",
        assigneeId: idOf(APPROVER),
        dueDate: "1994-01-01",
        displayOrder: 0,
      },
      {
        matterId: archivedMatter.id,
        title: "Archived Matter task",
        assigneeId: idOf(APPROVER),
        dueDate: "1995-01-01",
        displayOrder: 0,
      },
    ]);

    const result = await home(APPROVER);
    expect(result.sections.map((section) => section.type)).toEqual(["approvals", "tasks"]);
    const section = tasksIn(result);
    expect(section).toMatchObject({ type: "tasks", total: 4 });
    expect(section!.rows).toHaveLength(3);
    expect(section!.rows.map((row) => row.title)).toEqual([
      "Prepare financing signature pages",
      "Draft witness outline",
      "Review response exhibits",
    ]);
    expect(section!.rows.map((row) => row.record.kind)).toEqual(["contract", "matter", "matter"]);
    expect(section!.rows.map((row) => row.isOverdue)).toEqual([true, true, false]);
    expect(section!.rows[0]).toMatchObject({
      dueDate: "2000-01-01",
      record: {
        number: confidential.number,
        title: "Confidential financing",
        isConfidential: true,
      },
    });
    expect(section!.rows.some((row) => row.title === "This must leave no gap")).toBe(false);
    expect(tasksIn(await home(OTHER))).toBeUndefined();
  });
});
