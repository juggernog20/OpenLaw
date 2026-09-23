// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  contractStatuses,
  contractTypes,
  eq,
  matterStatuses,
  matterTypes,
  users,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";
import { provisionUser } from "../auth/instance.js";
import { NO_PERMISSION } from "../auth/guards.js";
import { signInCookies, startHarness, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import {
  getContract,
  listContracts,
  patchContract,
  setContractStatus,
  updateContract,
} from "./contracts/service.js";
import {
  getMatter,
  listMatters,
  patchMatter,
  setMatterStatus,
  updateMatter,
} from "./matters/service.js";
import { SOFT_GATE_PROBLEM_TYPE } from "@openlaw/shared";
import { ContractEnvelope } from "./contracts/record.js";
import { MatterEnvelope } from "./matters/record.js";

let harness: TestHarness;
let actor: AuthenticatedUser;
let outsider: AuthenticatedUser;
let cookies: Record<string, string>;
let contractTypeId: string;
let matterTypeId: string;
let activeId: string;
let closedId: string;
let openId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  actor = (await harness.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!;
  const person = await provisionUser(harness.app.auth, {
    email: "service-outsider@example.com",
    displayName: "Service outsider",
    password: "correct-horse-battery",
  });
  outsider = (
    await harness.db
      .update(users)
      .set({ role: "legal_team_member" })
      .where(eq(users.id, person.id))
      .returning()
  )[0]!;
  contractTypeId = (await harness.db.select().from(contractTypes).limit(1))[0]!.id;
  matterTypeId = (await harness.db.select().from(matterTypes).limit(1))[0]!.id;
  activeId = (
    await harness.db.select().from(contractStatuses).where(eq(contractStatuses.slug, "active"))
  )[0]!.id;
  closedId = (
    await harness.db.select().from(matterStatuses).where(eq(matterStatuses.slug, "closed"))
  )[0]!.id;
  openId = (
    await harness.db.select().from(matterStatuses).where(eq(matterStatuses.slug, "open"))
  )[0]!.id;
});

afterAll(async () => harness?.stop());

async function create(kind: "contract" | "matter", isConfidential = false) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${kind}s`,
    cookies,
    payload: {
      title: `Service ${kind}`,
      isConfidential,
      ...(kind === "contract" ? { contractTypeId } : { matterTypeId }),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const payload: unknown = response.json();
  return kind === "contract"
    ? ContractEnvelope.parse(payload).contract
    : MatterEnvelope.parse(payload).matter;
}

async function activity(id: string) {
  return harness.db.select().from(activityLog).where(eq(activityLog.entityId, id));
}

describe("record services without HTTP guards", () => {
  it("matches the Contract and Matter list and record responses", async () => {
    const contract = await create("contract");
    const matter = await create("matter");
    const reads = [
      [
        "/contracts?sort=title&dir=desc",
        () => listContracts(harness.db, actor, { sort: "title", dir: "desc" }),
      ],
      [
        "/matters?sort=title&dir=desc",
        () => listMatters(harness.db, actor, { sort: "title", dir: "desc" }),
      ],
      [
        `/contracts/${contract.number}`,
        () => getContract(harness.db, actor, contract.number, harness.resolveAiProvider),
      ],
      [`/matters/${matter.number}`, () => getMatter(harness.db, actor, matter.number)],
    ] as const;
    for (const [url, read] of reads) {
      const response = await harness.app.inject({ method: "GET", url: `/api/v1${url}`, cookies });
      expect(response.statusCode, response.body).toBe(200);
      expect(JSON.parse(JSON.stringify(await read()))).toEqual(response.json());
    }
  });

  it("keeps Confidential records out of direct reads, counts and writes", async () => {
    const contract = await create("contract", true);
    const matter = await create("matter", true);
    expect(
      (await listContracts(harness.db, outsider, {})).contracts.map((row) => row.id),
    ).not.toContain(contract.id);
    expect(
      (await listMatters(harness.db, outsider, {})).matters.map((row) => row.id),
    ).not.toContain(matter.id);
    for (const call of [
      () => getContract(harness.db, outsider, contract.number, harness.resolveAiProvider),
      () => getMatter(harness.db, outsider, matter.number),
      () =>
        updateContract(
          harness.db,
          outsider,
          contract.number,
          { title: "Hidden" },
          harness.notifier,
        ),
      () => updateMatter(harness.db, outsider, matter.number, { title: "Hidden" }),
      () =>
        setContractStatus(
          harness.db,
          outsider,
          contract.number,
          { statusId: activeId },
          harness.notifier,
        ),
      () =>
        setMatterStatus(harness.db, outsider, matter.number, {
          statusId: closedId,
          closingNote: "Done",
        }),
    ])
      await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses Business Users at every staff service", async () => {
    const business = { ...actor, role: "business_user" as const };
    const contract = await create("contract");
    const matter = await create("matter");
    for (const call of [
      () => listContracts(harness.db, business, {}),
      () => listMatters(harness.db, business, {}),
      () => getContract(harness.db, business, contract.number, harness.resolveAiProvider),
      () => getMatter(harness.db, business, matter.number),
      () => updateContract(harness.db, business, contract.number, {}, harness.notifier),
      () => updateMatter(harness.db, business, matter.number, {}),
      () =>
        setContractStatus(
          harness.db,
          business,
          contract.number,
          { statusId: activeId },
          harness.notifier,
        ),
      () =>
        setMatterStatus(harness.db, business, matter.number, {
          statusId: closedId,
          closingNote: "Done",
        }),
    ])
      await expect(call()).rejects.toMatchObject({ statusCode: 403, message: NO_PERMISSION });
  });

  it("separates Contract field writes and status moves, including activity and no-ops", async () => {
    const contract = await create("contract");
    const updated = await updateContract(
      harness.db,
      actor,
      contract.number,
      { title: "Renamed Contract" },
      harness.notifier,
    );
    expect(updated.contract).toMatchObject({
      title: "Renamed Contract",
      statusId: contract.statusId,
    });
    const moved = await setContractStatus(
      harness.db,
      actor,
      contract.number,
      { statusId: activeId },
      harness.notifier,
    );
    expect(moved.contract).toMatchObject({
      title: "Renamed Contract",
      statusId: activeId,
      stage: "active",
    });
    const before = await activity(contract.id);
    expect(before.filter((row) => row.action === "contract.updated")).toHaveLength(1);
    expect(before.filter((row) => row.action === "contract.status_changed")).toHaveLength(1);
    await setContractStatus(
      harness.db,
      actor,
      contract.number,
      { statusId: activeId },
      harness.notifier,
    );
    expect(await activity(contract.id)).toHaveLength(before.length);
    const mixed = { title: "Must not commit", statusId: contract.statusId };
    await expect(
      updateContract(harness.db, actor, contract.number, mixed, harness.notifier),
    ).rejects.toThrow();
    await expect(
      setContractStatus(harness.db, actor, contract.number, mixed, harness.notifier),
    ).rejects.toThrow();
    expect(
      (await getContract(harness.db, actor, contract.number, harness.resolveAiProvider)).contract
        .title,
    ).toBe("Renamed Contract");
  });

  it("keeps Matter closing notes and reopen confirmation in the status service", async () => {
    const matter = await create("matter");
    const updated = await updateMatter(harness.db, actor, matter.number, {
      title: "Renamed Matter",
    });
    expect(updated.matter).toMatchObject({ title: "Renamed Matter", statusId: matter.statusId });
    await expect(
      setMatterStatus(harness.db, actor, matter.number, { statusId: closedId }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const closed = await setMatterStatus(harness.db, actor, matter.number, {
      statusId: closedId,
      closingNote: "Finished work",
    });
    expect(closed.matter.closedAt).not.toBeNull();
    await expect(
      setMatterStatus(harness.db, actor, matter.number, { statusId: openId }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const reopened = await setMatterStatus(harness.db, actor, matter.number, {
      statusId: openId,
      confirmReopen: true,
    });
    expect(reopened.matter).toMatchObject({ closedAt: null, title: "Renamed Matter" });
    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.entityId, matter.id), eq(activityLog.action, "matter.status_changed")),
      );
    expect(entries).toHaveLength(2);
    expect(
      entries.some(
        (row) => (row.payload as { closingNote?: string }).closingNote === "Finished work",
      ),
    ).toBe(true);
    const mixed = { title: "Must not commit", statusId: closedId, closingNote: "Done" };
    await expect(updateMatter(harness.db, actor, matter.number, mixed)).rejects.toThrow();
    await expect(setMatterStatus(harness.db, actor, matter.number, mixed)).rejects.toThrow();
  });

  it("keeps the Contract soft gate and rolls back a mixed PATCH on refusal", async () => {
    const contract = await create("contract");
    const requested = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/approvals`,
      cookies,
      payload: { approverIds: [outsider.id] },
    });
    expect(requested.statusCode, requested.body).toBe(201);
    const before = await activity(contract.id);
    await expect(
      setContractStatus(
        harness.db,
        actor,
        contract.number,
        {
          statusId: activeId,
        },
        harness.notifier,
      ),
    ).rejects.toMatchObject({ statusCode: 409, type: SOFT_GATE_PROBLEM_TYPE });
    await expect(
      patchContract(
        harness.db,
        actor,
        contract.number,
        {
          title: "Must roll back",
          statusId: activeId,
          managerId: outsider.id,
        },
        harness.notifier,
      ),
    ).rejects.toMatchObject({ statusCode: 409, type: SOFT_GATE_PROBLEM_TYPE });
    expect(await activity(contract.id)).toHaveLength(before.length);
    const unchanged = await getContract(
      harness.db,
      actor,
      contract.number,
      harness.resolveAiProvider,
    );
    expect(unchanged.contract).toMatchObject({
      title: contract.title,
      statusId: contract.statusId,
      manager: null,
    });
    await setContractStatus(
      harness.db,
      actor,
      contract.number,
      {
        statusId: activeId,
        overrideSoftGate: true,
      },
      harness.notifier,
    );
    const after = await activity(contract.id);
    expect(after.filter((row) => row.action === "contract.status_changed")).toHaveLength(1);
    expect(after.filter((row) => row.action === "contract.stage_gate_overridden")).toHaveLength(1);
  });

  it("rolls back Matter field edits when the same PATCH cannot close it", async () => {
    const matter = await create("matter");
    const before = await activity(matter.id);
    await expect(
      patchMatter(harness.db, actor, matter.number, {
        title: "Must roll back",
        statusId: closedId,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await getMatter(harness.db, actor, matter.number)).matter).toMatchObject({
      title: matter.title,
      statusId: matter.statusId,
    });
    expect(await activity(matter.id)).toHaveLength(before.length);
  });

  it("keeps archived records readable and refuses field and status writes", async () => {
    const contract = await create("contract");
    const matter = await create("matter");
    for (const [kind, record] of [
      ["contract", contract],
      ["matter", matter],
    ] as const) {
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/${kind}s/${record.number}/archive`,
        cookies,
        payload: {},
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    expect(
      (await getContract(harness.db, actor, contract.number, harness.resolveAiProvider)).contract
        .archivedAt,
    ).not.toBeNull();
    expect((await getMatter(harness.db, actor, matter.number)).matter.archivedAt).not.toBeNull();
    for (const call of [
      () =>
        updateContract(harness.db, actor, contract.number, { title: "Archived" }, harness.notifier),
      () =>
        setContractStatus(
          harness.db,
          actor,
          contract.number,
          { statusId: activeId },
          harness.notifier,
        ),
      () => updateMatter(harness.db, actor, matter.number, { title: "Archived" }),
      () =>
        setMatterStatus(harness.db, actor, matter.number, {
          statusId: closedId,
          closingNote: "Done",
        }),
    ])
      await expect(call()).rejects.toMatchObject({ statusCode: 409 });
    expect((await listContracts(harness.db, actor)).contracts.map((row) => row.id)).not.toContain(
      contract.id,
    );
    expect(
      (await listContracts(harness.db, actor, { includeArchived: "true" })).contracts.map(
        (row) => row.id,
      ),
    ).toContain(contract.id);
    expect((await listMatters(harness.db, actor)).matters.map((row) => row.id)).not.toContain(
      matter.id,
    );
    expect(
      (await listMatters(harness.db, actor, { includeArchived: "true" })).matters.map(
        (row) => row.id,
      ),
    ).toContain(matter.id);
  });
});
