// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-012's soft gate on stage advancement (#235), at the HTTP seam
 * through the real-Postgres harness.
 *
 * The gate is the first server-side branch on **stage** (CTR-001), and
 * the two-step shape is what these tests pin. The same PATCH is sent
 * twice: once bare, which is refused 409 with the unresolved approvals
 * named, and once with the override flag, which commits and writes the
 * override entry. Both asks go through `PATCH /contracts/:number`,
 * because that is where the gate lives — no client can route around it.
 *
 * What must **not** trip it matters as much as what must. A move that
 * stays behind the line, a regression back over it, and a record whose
 * every ask is approved all commit in one press with no override entry
 * anywhere. CTR-001 leaves transitions unrestricted; the gate warns
 * about sign-off, and warning on the way back would be a warning about
 * nothing.
 *
 * A **rejected** ask is unresolved (CTR-012 says "pending/rejected"),
 * so a rejection nobody re-requested trips the gate exactly as a
 * pending ask does. That case has its own test because it is the one a
 * reading of "pending approvals" alone would get wrong.
 *
 * Activity is read straight from the table, as the approvals and
 * contract-statuses suites already do.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who owns the record, asks for sign-off, and moves it. */
const MEMBER = {
  email: "gate-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** The first approver. */
const FIRST = {
  email: "gate-first@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery",
} as const;
/** The second, so a refusal has more than one name to carry. */
const SECOND = {
  email: "gate-second@example.com",
  displayName: "Marcus Webb",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};
const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface ContractRow {
  id: string;
  number: number;
  title: string;
  statusId: string;
  stage: string;
}

interface StatusOption {
  id: string;
  slug: string;
  displayName: string;
  stage: string;
}

/** Every live status, by the stage it maps to (CTR-001). */
let statusesByStage = new Map<string, StatusOption>();
let ndaTypeId = "";

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

  for (const fixture of [MEMBER, FIRST, SECOND] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(ADMIN),
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as {
    contractTypes: { id: string; slug: string }[];
    contractStatuses: StatusOption[];
  };
  ndaTypeId = body.contractTypes.find((row) => row.slug === "nda")!.id;
  // One status per stage is all the gate needs, and the seeds give at
  // least one for every stage (CTR-001).
  statusesByStage = new Map(body.contractStatuses.map((row) => [row.stage, row]));
  for (const stage of ["draft", "review", "approval", "signature", "active", "ended"]) {
    expect(statusesByStage.get(stage), `a seeded ${stage} status`).toBeDefined();
  }
});

afterAll(async () => {
  await harness.stop();
});

/** The seeded status that maps to one stage. */
const statusAt = (stage: string): StatusOption => statusesByStage.get(stage)!;

/** A contract the Member made, so they hold its `creator` row. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(MEMBER),
    payload: { title, contractTypeId: ndaTypeId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

/** One status commit, bare or with CTR-012's override flag. */
const moveTo = (number: number, stage: string, override?: boolean) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: as(MEMBER),
    payload:
      override === undefined
        ? { statusId: statusAt(stage).id }
        : { statusId: statusAt(stage).id, overrideSoftGate: override },
  });

/** A status commit that must land, answering the row. */
async function move(number: number, stage: string, override?: boolean): Promise<ContractRow> {
  const res = await moveTo(number, stage, override);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

/** Asks the named people for sign-off, answering the roster. */
async function ask(
  number: number,
  approverIds: string[],
): Promise<{ id: string; approver: { id: string } }[]> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/approvals`,
    cookies: as(MEMBER),
    payload: { approverIds },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approvals as { id: string; approver: { id: string } }[];
}

/** One approver's answer, which must land. */
async function decide(
  fixture: { email: string },
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/approvals/${approvalId}/decision`,
    cookies: as(fixture),
    payload: { decision },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** The override entries on one contract, oldest first. */
const overridesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        eq(activityLog.action, "contract.stage_gate_overridden"),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** Every entry a status commit can write, so a test can assert that a
 * clean move wrote the status verb and nothing else. */
const statusEntriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        inArray(activityLog.action, ["contract.status_changed", "contract.stage_gate_overridden"]),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** A contract sitting at the approval stage with two pending asks. */
async function contractAwaitingSignOff(title: string) {
  const contract = await newContract(title);
  await move(contract.number, "review");
  await move(contract.number, "approval");
  const roster = await ask(contract.number, [idOf(FIRST), idOf(SECOND)]);
  return { contract, roster };
}

describe("the soft gate refuses", () => {
  it("refuses a move past approval while asks are pending, and names them", async () => {
    const { contract } = await contractAwaitingSignOff("Pending sign-off");

    const res = await moveTo(contract.number, "signature");
    expect(res.statusCode, res.body).toBe(409);
    const problem = res.json();
    expect(problem.type).toBe("urn:openlaw:problem:approval-soft-gate");
    expect(problem.detail).toContain(FIRST.displayName);
    expect(problem.detail).toContain(SECOND.displayName);
    expect(problem.detail).toContain("pending");

    // Refused means nothing moved.
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(MEMBER),
    });
    expect(read.json().contract.stage).toBe("approval");
    expect(await overridesOn(contract.id)).toHaveLength(0);
  });

  it("refuses when the only unresolved ask is a rejection nobody re-requested", async () => {
    const { contract, roster } = await contractAwaitingSignOff("Rejected and left");
    const first = roster.find((row) => row.approver.id === idOf(FIRST))!;
    const second = roster.find((row) => row.approver.id === idOf(SECOND))!;
    await decide(FIRST, first.id, "rejected");
    await decide(SECOND, second.id, "approved");

    const res = await moveTo(contract.number, "signature");
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain(FIRST.displayName);
    expect(res.json().detail).toContain("rejected");
    // The approved ask is resolved, so it is not named.
    expect(res.json().detail).not.toContain(SECOND.displayName);
  });

  it("refuses a jump from before approval straight past it", async () => {
    const contract = await newContract("Draft to active");
    await move(contract.number, "review");
    await move(contract.number, "approval");
    await ask(contract.number, [idOf(FIRST)]);
    // Back behind the line, then over it in one press — the gate reads
    // the stage being left, and `review` is at-or-before `approval`.
    await move(contract.number, "review");

    const res = await moveTo(contract.number, "active");
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain(FIRST.displayName);
  });

  it("refuses when the flag is sent as false, which is the bare ask", async () => {
    const { contract } = await contractAwaitingSignOff("Flag off");
    const res = await moveTo(contract.number, "signature", false);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().type).toBe("urn:openlaw:problem:approval-soft-gate");
  });
});

describe("the soft gate is overridden", () => {
  it("commits the same move with the flag, and logs the override with the names", async () => {
    const { contract } = await contractAwaitingSignOff("Pushed past");
    expect((await moveTo(contract.number, "signature")).statusCode).toBe(409);

    const row = await move(contract.number, "signature", true);
    expect(row.stage).toBe("signature");
    expect(row.statusId).toBe(statusAt("signature").id);

    const entries = await overridesOn(contract.id);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.actorId).toBe(idOf(MEMBER));
    expect(entry.visibility).toBe("working_team");
    const payload = entry.payload as {
      number: number;
      fromStage: string;
      toStage: string;
      approvers: { approverName: string; status: string }[];
    };
    expect(payload.number).toBe(contract.number);
    expect(payload.fromStage).toBe("approval");
    expect(payload.toStage).toBe("signature");
    expect(payload.approvers.map((row) => row.approverName).sort()).toEqual(
      [FIRST.displayName, SECOND.displayName].sort(),
    );
    expect(payload.approvers.every((row) => row.status === "pending")).toBe(true);

    // The override rides beside the status change, not instead of it.
    const both = await statusEntriesOn(contract.id);
    expect(both.map((entry) => entry.action)).toEqual([
      "contract.status_changed",
      "contract.status_changed",
      "contract.status_changed",
      "contract.stage_gate_overridden",
    ]);
  });

  it("records the rejection's own state in the override entry", async () => {
    const { contract, roster } = await contractAwaitingSignOff("Pushed past a no");
    const first = roster.find((row) => row.approver.id === idOf(FIRST))!;
    await decide(FIRST, first.id, "rejected");

    await move(contract.number, "signature", true);
    const [entry] = await overridesOn(contract.id);
    const payload = entry!.payload as { approvers: { approverName: string; status: string }[] };
    expect(payload.approvers.find((row) => row.approverName === FIRST.displayName)?.status).toBe(
      "rejected",
    );
    expect(payload.approvers.find((row) => row.approverName === SECOND.displayName)?.status).toBe(
      "pending",
    );
  });
});

describe("the soft gate stays quiet", () => {
  it("lets a move that does not cross the line through, whatever is open", async () => {
    const contract = await newContract("Behind the line");
    await move(contract.number, "review");
    await move(contract.number, "approval");
    await ask(contract.number, [idOf(FIRST), idOf(SECOND)]);

    // approval → review → approval, both directions, both behind or at
    // the line.
    expect((await move(contract.number, "review")).stage).toBe("review");
    expect((await move(contract.number, "approval")).stage).toBe("approval");
    expect(await overridesOn(contract.id)).toHaveLength(0);
  });

  it("lets a regression back over the line through", async () => {
    const { contract } = await contractAwaitingSignOff("Back over the line");
    await move(contract.number, "signature", true);
    expect(await overridesOn(contract.id)).toHaveLength(1);

    // signature → review is a regression, which CTR-001 allows and the
    // gate has nothing to say about.
    expect((await move(contract.number, "review")).stage).toBe("review");
    expect((await move(contract.number, "draft")).stage).toBe("draft");
    expect(await overridesOn(contract.id)).toHaveLength(1);
  });

  it("lets the move through with every ask approved, and writes no override", async () => {
    const { contract, roster } = await contractAwaitingSignOff("All clear");
    for (const row of roster) {
      await decide(row.approver.id === idOf(FIRST) ? FIRST : SECOND, row.id, "approved");
    }

    expect((await move(contract.number, "signature")).stage).toBe("signature");
    expect(await overridesOn(contract.id)).toHaveLength(0);
  });

  it("lets the move through with no approvals at all", async () => {
    const contract = await newContract("Nobody was asked");
    await move(contract.number, "approval");
    expect((await move(contract.number, "active")).stage).toBe("active");
    expect(await overridesOn(contract.id)).toHaveLength(0);
  });

  it("writes no override entry when the flag rides a move that crosses nothing", async () => {
    const contract = await newContract("Flag with nothing to override");
    await ask(contract.number, [idOf(FIRST)]);
    const row = await move(contract.number, "review", true);
    expect(row.stage).toBe("review");
    expect(await overridesOn(contract.id)).toHaveLength(0);
  });

  it("writes no override entry when the flag rides an edit that is not a status change", async () => {
    const { contract } = await contractAwaitingSignOff("Flag on a title");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(MEMBER),
      payload: { title: "Flag on a title, renamed", overrideSoftGate: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await overridesOn(contract.id)).toHaveLength(0);
  });
});
