// SPDX-License-Identifier: AGPL-3.0-only

/** The M29 Home read, through the real app factory and real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  contractApprovals,
  contractKeyDates,
  contracts,
  contractStatuses,
  contractTasks,
  contractTeam,
  entities,
  entityObligations,
  entityTypes,
  eq,
  matters,
  matterKeyDates,
  matterStatuses,
  matterTasks,
  matterTeam,
  matterTypes,
  requests,
  requestTypes,
  sql,
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

interface DatesSection {
  type: "dates";
  total: number;
  rows: Array<{
    source: "key_date" | "expiry" | "notice_deadline";
    keyDateId: string | null;
    date: string;
    label: string | null;
    noticePeriodDays: number | null;
    record: {
      kind: "contract" | "matter";
      id: string;
      number: number;
      title: string;
      isConfidential: boolean;
    };
  }>;
}

interface ObligationsSection {
  type: "obligations";
  total: number;
  rows: Array<{
    id: string;
    label: string;
    dueDate: string;
    isOverdue: boolean;
    isUnassigned: boolean;
    entity: { id: string; legalName: string };
  }>;
}

interface InboxSection {
  type: "inbox";
  total: number;
  rows: Array<{
    id: string;
    number: number;
    summary: string;
    urgency: "low" | "medium" | "high" | "critical";
    requester: { id: string; displayName: string };
    createdAt: string;
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
  return response.json() as {
    sections: Array<
      ApprovalSection | TaskSection | DatesSection | ObligationsSection | InboxSection
    >;
  };
}

function tasksIn(result: Awaited<ReturnType<typeof home>>): TaskSection | undefined {
  return result.sections.find((section): section is TaskSection => section.type === "tasks");
}

function approvalsIn(result: Awaited<ReturnType<typeof home>>): ApprovalSection | undefined {
  return result.sections.find(
    (section): section is ApprovalSection => section.type === "approvals",
  );
}

function datesIn(result: Awaited<ReturnType<typeof home>>): DatesSection | undefined {
  return result.sections.find((section): section is DatesSection => section.type === "dates");
}

function obligationsIn(result: Awaited<ReturnType<typeof home>>): ObligationsSection | undefined {
  return result.sections.find(
    (section): section is ObligationsSection => section.type === "obligations",
  );
}

function inboxIn(result: Awaited<ReturnType<typeof home>>): InboxSection | undefined {
  return result.sections.find((section): section is InboxSection => section.type === "inbox");
}

function plusDays(civilDate: string, days: number): string {
  const date = new Date(`${civilDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

  it("unions the four approaching date kinds for the Manager and team, before its total and cap", async () => {
    const todayResult = await harness.db.execute<{ today: string }>(
      sql`select current_date::text as today`,
    );
    const today = todayResult.rows[0]!.today;
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

    const createMatter = async (
      title: string,
      options: { closed?: boolean; archived?: boolean; onTeam?: boolean } = {},
    ) => {
      const [matter] = await harness.db
        .insert(matters)
        .values({
          title,
          matterTypeId: matterType!.id,
          statusId: options.closed ? closedMatterStatus!.id : openMatterStatus!.id,
          managerId: idOf(REQUESTER),
          createdBy: idOf(REQUESTER),
          closedAt: options.closed ? new Date() : null,
          archivedAt: options.archived ? new Date() : null,
        })
        .returning({ id: matters.id, number: matters.number });
      await harness.db
        .insert(matterTeam)
        .values([
          { matterId: matter!.id, userId: idOf(REQUESTER), role: "creator" },
          ...(options.onTeam
            ? [{ matterId: matter!.id, userId: idOf(APPROVER), role: "member" as const }]
            : []),
        ]);
      return matter!;
    };

    const contract = await newContract("Approaching renewal");
    await harness.db
      .insert(contractTeam)
      .values({ contractId: contract.id, userId: idOf(APPROVER), role: "member" });
    await harness.db
      .update(contracts)
      .set({
        expiryDate: plusDays(today, 3),
        noticePeriodDays: 2,
        isConfidential: true,
      })
      .where(eq(contracts.id, contract.id));
    const [contractKeyDate] = await harness.db
      .insert(contractKeyDates)
      .values({
        contractId: contract.id,
        date: plusDays(today, 2),
        label: "Price review window opens",
      })
      .returning({ id: contractKeyDates.id });

    const matter = await createMatter("Regulatory response", { onTeam: true });
    await harness.db.insert(matterKeyDates).values({
      matterId: matter.id,
      date: plusDays(today, 4),
      label: "Response filing deadline",
    });

    const [managerOnlyMatter] = await harness.db
      .insert(matters)
      .values({
        title: "Manager-only calendar",
        matterTypeId: matterType!.id,
        statusId: openMatterStatus!.id,
        managerId: idOf(OTHER),
        createdBy: idOf(REQUESTER),
      })
      .returning({ id: matters.id, number: matters.number });
    await harness.db
      .insert(matterTeam)
      .values({ matterId: managerOnlyMatter!.id, userId: idOf(REQUESTER), role: "creator" });
    await harness.db.insert(matterKeyDates).values({
      matterId: managerOnlyMatter!.id,
      date: plusDays(today, 5),
      label: "Manager date without a team row",
    });

    const outsideWindow = await newContract("Later Contract date");
    await harness.db
      .insert(contractTeam)
      .values({ contractId: outsideWindow.id, userId: idOf(APPROVER), role: "member" });
    await harness.db.insert(contractKeyDates).values({
      contractId: outsideWindow.id,
      date: plusDays(today, 31),
      label: "Beyond Home's window",
    });

    const ended = await newContract("Ended Contract date");
    await harness.db
      .insert(contractTeam)
      .values({ contractId: ended.id, userId: idOf(APPROVER), role: "member" });
    await harness.db
      .update(contracts)
      .set({ expiryDate: plusDays(today, 1), endedAt: new Date() })
      .where(eq(contracts.id, ended.id));

    const archived = await newContract("Archived Contract date");
    await harness.db
      .insert(contractTeam)
      .values({ contractId: archived.id, userId: idOf(APPROVER), role: "member" });
    await harness.db
      .update(contracts)
      .set({ expiryDate: plusDays(today, 1), archivedAt: new Date() })
      .where(eq(contracts.id, archived.id));

    for (const [title, options] of [
      ["Closed Matter date", { closed: true, onTeam: true }],
      ["Archived Matter date", { archived: true, onTeam: true }],
    ] as const) {
      const excluded = await createMatter(title, options);
      await harness.db.insert(matterKeyDates).values({
        matterId: excluded.id,
        date: plusDays(today, 1),
        label: title,
      });
    }

    const walled = await newContract("Walled Contract date");
    await harness.db
      .insert(contractTeam)
      .values({ contractId: walled.id, userId: idOf(APPROVER), role: "member" });
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, walled.id));
    await harness.db.insert(contractKeyDates).values({
      contractId: walled.id,
      date: today,
      label: "This must leave no row, count, or gap",
    });
    await harness.db
      .delete(contractTeam)
      .where(and(eq(contractTeam.contractId, walled.id), eq(contractTeam.userId, idOf(APPROVER))));

    const result = await home(APPROVER);
    expect(result.sections.map((homeSection) => homeSection.type)).toEqual([
      "approvals",
      "tasks",
      "dates",
    ]);
    const section = datesIn(result);
    expect(section).toMatchObject({ type: "dates", total: 4 });
    expect(section!.rows).toHaveLength(3);
    expect(section!.rows.map((row) => row.source)).toEqual([
      "notice_deadline",
      "key_date",
      "expiry",
    ]);
    expect(section!.rows[0]).toMatchObject({
      keyDateId: null,
      date: plusDays(today, 1),
      label: null,
      noticePeriodDays: 2,
      record: {
        kind: "contract",
        number: contract.number,
        title: "Approaching renewal",
        isConfidential: true,
      },
    });
    expect(section!.rows[1]).toMatchObject({
      keyDateId: contractKeyDate!.id,
      label: "Price review window opens",
      noticePeriodDays: null,
    });
    expect(section!.rows.every((row) => !row.record.title.includes("Walled"))).toBe(true);

    await harness.db
      .update(contractKeyDates)
      .set({ date: plusDays(today, 31) })
      .where(eq(contractKeyDates.id, contractKeyDate!.id));
    const shifted = datesIn(await home(APPROVER));
    expect(shifted).toMatchObject({ type: "dates", total: 3 });
    expect(shifted!.rows.map((row) => [row.record.kind, row.source])).toEqual([
      ["contract", "notice_deadline"],
      ["contract", "expiry"],
      ["matter", "key_date"],
    ]);
    expect(shifted!.rows[2]).toMatchObject({
      label: "Response filing deadline",
      record: { number: matter.number, title: "Regulatory response" },
    });

    expect(datesIn(await home(OTHER))).toMatchObject({
      type: "dates",
      total: 1,
      rows: [
        {
          label: "Manager date without a team row",
          record: { number: managerOnlyMatter!.number, title: "Manager-only calendar" },
        },
      ],
    });
    expect(datesIn(await home(CONTRIBUTOR))).toBeUndefined();
  });

  it("shows reachable open obligations assigned to the viewer and the Administrator fallback", async () => {
    const entityType = await harness.db.select({ id: entityTypes.id }).from(entityTypes).limit(1);
    const entityTypeId = entityType[0]!.id;
    const today = new Date().toISOString().slice(0, 10);
    await harness.db.insert(entities).values([
      {
        id: "home-obligations-reachable",
        legalName: "Alderidge Holdings Ltd",
        entityTypeId,
      },
      {
        id: "home-obligations-walled",
        legalName: "Confidential Acquisition Vehicle",
        entityTypeId,
        isConfidential: true,
      },
    ]);
    await harness.db.insert(entityObligations).values([
      {
        id: "home-obligation-overdue",
        entityId: "home-obligations-reachable",
        label: "Annual return",
        nextDueOn: plusDays(today, -3),
        assigneeId: idOf(APPROVER),
      },
      {
        id: "home-obligation-due-today",
        entityId: "home-obligations-reachable",
        label: "Licence renewal",
        nextDueOn: today,
        assigneeId: idOf(APPROVER),
      },
      {
        id: "home-obligation-next",
        entityId: "home-obligations-reachable",
        label: "Registered agent renewal",
        nextDueOn: plusDays(today, 4),
        assigneeId: idOf(APPROVER),
      },
      {
        id: "home-obligation-capped",
        entityId: "home-obligations-reachable",
        label: "Further filing",
        nextDueOn: plusDays(today, 8),
        assigneeId: idOf(APPROVER),
      },
      {
        id: "home-obligation-completed",
        entityId: "home-obligations-reachable",
        label: "Already filed",
        nextDueOn: plusDays(today, -10),
        assigneeId: idOf(APPROVER),
        completedOn: plusDays(today, -9),
      },
      {
        id: "home-obligation-unassigned",
        entityId: "home-obligations-reachable",
        label: "Unowned filing",
        nextDueOn: plusDays(today, 1),
      },
      {
        id: "home-obligation-walled-row",
        entityId: "home-obligations-walled",
        label: "Secret filing",
        nextDueOn: plusDays(today, -20),
        assigneeId: idOf(APPROVER),
      },
    ]);

    const memberSection = obligationsIn(await home(APPROVER));
    expect(memberSection).toMatchObject({ type: "obligations", total: 4 });
    expect(memberSection!.rows.map((row) => row.label)).toEqual([
      "Annual return",
      "Licence renewal",
      "Registered agent renewal",
    ]);
    expect(memberSection!.rows[0]).toMatchObject({ isOverdue: true, isUnassigned: false });
    expect(memberSection!.rows.slice(1).every((row) => !row.isOverdue)).toBe(true);
    expect(
      memberSection!.rows.every(
        (row) => row.entity.legalName !== "Confidential Acquisition Vehicle",
      ),
    ).toBe(true);

    expect(obligationsIn(await home(OTHER))).toBeUndefined();
    expect(obligationsIn(await home(CONTRIBUTOR))).toBeUndefined();
    expect(obligationsIn(await home(ADMIN))).toMatchObject({
      type: "obligations",
      total: 1,
      rows: [{ label: "Unowned filing", isUnassigned: true }],
    });
  });

  it("reports the Member+ Inbox in its urgency-then-age order and omits it elsewhere", async () => {
    const requestType = await harness.db
      .select({ id: requestTypes.id })
      .from(requestTypes)
      .limit(1);
    const requestTypeId = requestType[0]!.id;
    const requesterId = idOf(REQUESTER);
    await harness.db.insert(requests).values([
      {
        requestTypeId,
        requesterId,
        summary: "Critical oldest",
        urgency: "critical",
        createdAt: new Date("2026-08-01T09:00:00Z"),
      },
      {
        requestTypeId,
        requesterId,
        summary: "Critical newer",
        urgency: "critical",
        createdAt: new Date("2026-08-02T09:00:00Z"),
      },
      {
        requestTypeId,
        requesterId,
        summary: "High oldest",
        urgency: "high",
        createdAt: new Date("2026-07-01T09:00:00Z"),
      },
      {
        requestTypeId,
        requesterId,
        summary: "Medium request",
        urgency: "medium",
        createdAt: new Date("2026-06-01T09:00:00Z"),
      },
      {
        requestTypeId,
        requesterId,
        summary: "Low request",
        urgency: "low",
        createdAt: new Date("2026-05-01T09:00:00Z"),
      },
      {
        requestTypeId,
        requesterId,
        summary: "Already resolved",
        urgency: "critical",
        status: "resolved",
        createdAt: new Date("2026-01-01T09:00:00Z"),
      },
    ]);

    for (const viewer of [ADMIN, APPROVER]) {
      const section = inboxIn(await home(viewer));
      expect(section).toMatchObject({ type: "inbox", total: 5 });
      expect(section!.rows.map((row) => row.summary)).toEqual([
        "Critical oldest",
        "Critical newer",
        "High oldest",
      ]);
      expect(section!.rows[0]).toMatchObject({
        urgency: "critical",
        requester: { id: requesterId, displayName: REQUESTER.displayName },
      });
    }
    expect(inboxIn(await home(CONTRIBUTOR))).toBeUndefined();
  });
});
