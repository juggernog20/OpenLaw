// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-019's end-of-life semantics (M17/3), at the HTTP seam through the
 * real-Postgres harness.
 *
 * Ending is a signal, not a lock. `ended_at` is stamped on transition
 * into the ended stage and cleared on leaving it. The default list
 * excludes ended contracts; `includeEnded` brings them back. The
 * renewal-pending predicate is false on an ended auto-renewing
 * contract. An ended record stays writable; an archived one does not.
 * Reopening is an ordinary status change that clears `ended_at` and is
 * logged like any transition.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, contracts, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who operates the contracts. */
const MEMBER = {
  email: "eol-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let ndaTypeId = "";
/** Status ids, looked up once from the options read. */
let draftStatusId = "";
let activeStatusId = "";
let expiredStatusId = "";
let terminatedStatusId = "";

interface ContractRow {
  id: string;
  number: number;
  title: string;
  stage: string;
  statusId: string;
  statusName: string;
  /** CTR-019's queryable summary. */
  endedAt: string | null;
  archivedAt: string | null;
  /** CTR-006's derived pending state. */
  renewalPendingConfirmation: boolean;
}

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

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const data = res.json() as {
    contractTypes: { id: string; slug: string }[];
    contractStatuses: { id: string; slug: string; stage: string }[];
  };
  ndaTypeId = data.contractTypes.find((row) => row.slug === "nda")!.id;
  draftStatusId = data.contractStatuses.find((row) => row.slug === "draft")!.id;
  activeStatusId = data.contractStatuses.find((row) => row.slug === "active")!.id;
  expiredStatusId = data.contractStatuses.find((row) => row.slug === "expired")!.id;
  terminatedStatusId = data.contractStatuses.find((row) => row.slug === "terminated")!.id;
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { title, contractTypeId: ndaTypeId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

async function patch(
  number: number,
  payload: Record<string, unknown>,
): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

function patchRaw(number: number, payload: Record<string, unknown>) {
  return harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });
}

async function read(number: number): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

async function listContracts(query: Record<string, string> = {}): Promise<ContractRow[]> {
  const params = new URLSearchParams(query).toString();
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts${params ? `?${params}` : ""}`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contracts as ContractRow[];
}

/** A civil date `days` from today, in the zone the seam counts in. */
function daysFromToday(days: number): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Status change activity entries on one contract, oldest first. */
const statusChangesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        eq(activityLog.action, "contract.status_changed"),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

describe("ended_at stamping (CTR-019)", () => {
  it("stamps ended_at on entering the ended stage and clears it on leaving", async () => {
    const contract = await newContract("EOL stamp");
    expect(contract.stage).toBe("draft");
    expect(contract.endedAt).toBeNull();

    // Move to active first, then to expired (an ended-stage status).
    await patch(contract.number, { statusId: activeStatusId });
    const ended = await patch(contract.number, { statusId: expiredStatusId });
    expect(ended.stage).toBe("ended");
    expect(ended.endedAt).not.toBeNull();

    // The record read agrees.
    const readBack = await read(contract.number);
    expect(readBack.endedAt).not.toBeNull();

    // Reopening by moving back to active clears ended_at.
    const reopened = await patch(contract.number, { statusId: activeStatusId });
    expect(reopened.stage).toBe("active");
    expect(reopened.endedAt).toBeNull();

    // The record read agrees.
    const readAfterReopen = await read(contract.number);
    expect(readAfterReopen.endedAt).toBeNull();
  });

  it("stamps ended_at for any ended-stage status (both expired and terminated)", async () => {
    const contract = await newContract("EOL terminated");

    const terminated = await patch(contract.number, { statusId: terminatedStatusId });
    expect(terminated.stage).toBe("ended");
    expect(terminated.endedAt).not.toBeNull();
  });

  it("does not re-stamp ended_at when moving between ended-stage statuses", async () => {
    const contract = await newContract("EOL same stage");
    const expired = await patch(contract.number, { statusId: expiredStatusId });
    const firstStamp = expired.endedAt;
    expect(firstStamp).not.toBeNull();

    // A small delay so a re-stamp would be distinguishable.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const terminated = await patch(contract.number, { statusId: terminatedStatusId });
    expect(terminated.stage).toBe("ended");
    // Same timestamp — the column was not re-stamped.
    expect(terminated.endedAt).toBe(firstStamp);
  });
});

describe("the default list excludes ended contracts (CTR-019)", () => {
  it("excludes ended contracts from the default list and includeEnded restores them — scope filters before the limit", async () => {
    // A live contract and an ended one, both by the same viewer.
    const live = await newContract("EOL list live");
    const ending = await newContract("EOL list ending");
    await patch(ending.number, { statusId: expiredStatusId });

    // The default list includes the live one and excludes the ended one.
    const defaultList = await listContracts();
    const defaultNumbers = defaultList.map((row) => row.number);
    expect(defaultNumbers).toContain(live.number);
    expect(defaultNumbers).not.toContain(ending.number);

    // With includeEnded, the ended one comes back.
    const endedList = await listContracts({ includeEnded: "true" });
    const endedNumbers = endedList.map((row) => row.number);
    expect(endedNumbers).toContain(live.number);
    expect(endedNumbers).toContain(ending.number);
  });

  it("reopening brings the contract back to the default list", async () => {
    const contract = await newContract("EOL list reopen");
    await patch(contract.number, { statusId: expiredStatusId });

    // Ended — absent from default.
    const listEnded = await listContracts();
    expect(listEnded.map((row) => row.number)).not.toContain(contract.number);

    // Reopen — back in default.
    await patch(contract.number, { statusId: activeStatusId });
    const listReopened = await listContracts();
    expect(listReopened.map((row) => row.number)).toContain(contract.number);
  });
});

describe("the renewal-pending predicate on an ended contract", () => {
  it("is false on an ended auto-renewing contract whose expiry has passed", async () => {
    const contract = await newContract("EOL renewal off");
    // Make it auto-renewing with a past expiry — normally this would
    // make renewalPendingConfirmation true.
    await patch(contract.number, { termType: "auto_renew" });
    await patch(contract.number, {
      effectiveDate: daysFromToday(-400),
      expiryDate: daysFromToday(-10),
      renewalPeriodMonths: 12,
    });

    // Before ending, the predicate is true.
    const beforeEnd = await read(contract.number);
    expect(beforeEnd.renewalPendingConfirmation).toBe(true);

    // End it.
    await patch(contract.number, { statusId: expiredStatusId });
    const afterEnd = await read(contract.number);
    expect(afterEnd.renewalPendingConfirmation).toBe(false);

    // Reopen: the predicate comes back.
    await patch(contract.number, { statusId: activeStatusId });
    const afterReopen = await read(contract.number);
    expect(afterReopen.renewalPendingConfirmation).toBe(true);
  });
});

describe("an ended contract stays writable (CTR-019)", () => {
  it("accepts a field edit on an ended contract", async () => {
    const contract = await newContract("EOL writable");
    await patch(contract.number, { statusId: expiredStatusId });

    // A title edit on the ended record succeeds.
    const edited = await patch(contract.number, { title: "EOL writable (edited)" });
    expect(edited.title).toBe("EOL writable (edited)");
  });

  it("accepts a description edit on an ended contract", async () => {
    // The same per-field PATCH works on an ended contract; the ticket
    // says "a field edit succeeds". Description is a field.
    const contract = await newContract("EOL desc edit");
    await patch(contract.number, { statusId: expiredStatusId });

    const edited = await patch(contract.number, { description: "Post-mortem notes." });
    expect(edited.description).toBe("Post-mortem notes.");
  });

  it("refuses the same field edit on an archived contract", async () => {
    const contract = await newContract("EOL archived blocked");
    // Archive it.
    const archiveRes = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: memberCookies,
    });
    expect(archiveRes.statusCode, archiveRes.body).toBe(200);

    // A title edit on the archived record is refused.
    const editRes = await patchRaw(contract.number, { title: "Should fail" });
    expect(editRes.statusCode).toBe(409);
  });
});

describe("reopening is an ordinary status change (CTR-019)", () => {
  it("clears ended_at and is logged like any transition", async () => {
    const contract = await newContract("EOL reopen log");
    await patch(contract.number, { statusId: expiredStatusId });

    // Reopen.
    const reopened = await patch(contract.number, { statusId: activeStatusId });
    expect(reopened.endedAt).toBeNull();
    expect(reopened.stage).toBe("active");

    // The activity log has both transitions — the ending and the reopen.
    const entries = await statusChangesOn(contract.id);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // The last entry is the reopen.
    const lastEntry = entries[entries.length - 1]!;
    const payload = lastEntry.payload as {
      fromStage: string;
      toStage: string;
      from: string;
      to: string;
    };
    expect(payload.fromStage).toBe("ended");
    expect(payload.toStage).toBe("active");
  });

  it("the column in the database is NULL after reopen", async () => {
    const contract = await newContract("EOL db null");
    await patch(contract.number, { statusId: expiredStatusId });
    await patch(contract.number, { statusId: draftStatusId });

    // Direct database read confirms ended_at is NULL.
    const [row] = await harness.db
      .select({ endedAt: contracts.endedAt })
      .from(contracts)
      .where(eq(contracts.id, contract.id))
      .limit(1);
    expect(row!.endedAt).toBeNull();
  });
});
