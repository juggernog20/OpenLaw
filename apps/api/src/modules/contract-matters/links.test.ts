// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-007 at the real-Postgres HTTP seam: one canonical Contract.matterId. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, contracts, eq, matters, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "contract-matter-member@example.com",
  displayName: "Mina Linker",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "contract-matter-outsider@example.com",
  displayName: "Owen Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "contract-matter-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let contributorId = "";
let contractTypeId = "";
let matterTypeId = "";

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture.email === CONTRIBUTOR.email) contributorId = person.id;
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  const contractOptions = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(contractOptions.statusCode, contractOptions.body).toBe(200);
  contractTypeId = contractOptions.json().contractTypes[0].id;
  const matterOptions = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: memberCookies,
  });
  expect(matterOptions.statusCode, matterOptions.body).toBe(200);
  matterTypeId = matterOptions.json().matterTypes[0].id;
}, 180_000);

afterAll(async () => harness?.stop());

async function createMatter(title: string, isConfidential = false, cookies = memberCookies) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies,
    payload: { title, matterTypeId, isConfidential },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matter as {
    id: string;
    number: number;
    title: string;
    isConfidential: boolean;
  };
}

async function createContract(
  title: string,
  extra: Record<string, unknown> = {},
  cookies = memberCookies,
) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies,
    payload: { title, contractTypeId, ...extra },
  });
  return response;
}

async function addToMatter(number: number) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matters/${number}/team`,
    cookies: memberCookies,
    payload: { userId: contributorId, role: "contributor" },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function addToContract(number: number) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: memberCookies,
    payload: { userId: contributorId, role: "contributor" },
  });
  expect(response.statusCode, response.body).toBe(201);
}

describe("optional Contract creation", () => {
  it("creates standalone by default and links only when a reachable Matter is named", async () => {
    const matter = await createMatter("Creation context");
    const standalone = await createContract("Ordinary standalone");
    const linked = await createContract("Born linked", { matterNumber: matter.number });
    expect(standalone.statusCode, standalone.body).toBe(201);
    expect(linked.statusCode, linked.body).toBe(201);
    const rows = await harness.db
      .select({ title: contracts.title, matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.title, "Ordinary standalone"));
    expect(rows).toEqual([{ title: "Ordinary standalone", matterId: null }]);
    const [linkedRow] = await harness.db
      .select({ matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.title, "Born linked"));
    expect(linkedRow?.matterId).toBe(matter.id);
  });

  it("refuses an optional Matter the creator cannot reach", async () => {
    const restricted = await createMatter("Restricted creation target", true);
    const response = await createContract(
      "Cannot be born there",
      { matterNumber: restricted.number },
      outsiderCookies,
    );
    expect(response.statusCode).toBe(404);
  });

  it("keeps renewal-created Contracts standalone unless that flow deliberately names a Matter", async () => {
    const matter = await createMatter("Deliberate renewal context");
    const predecessor = (await createContract("Renewal predecessor")).json().contract as {
      number: number;
    };
    const standalone = await createContract("Standalone renewal", {
      renewalOf: { number: predecessor.number, vehicle: "child" },
    });
    const linked = await createContract("Linked renewal", {
      renewalOf: { number: predecessor.number, vehicle: "successor" },
      matterNumber: matter.number,
    });
    expect(standalone.statusCode, standalone.body).toBe(201);
    expect(linked.statusCode, linked.body).toBe(201);
    const rows = await harness.db
      .select({ title: contracts.title, matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.title, "Standalone renewal"));
    expect(rows).toEqual([{ title: "Standalone renewal", matterId: null }]);
    const [linkedRow] = await harness.db
      .select({ matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.title, "Linked renewal"));
    expect(linkedRow?.matterId).toBe(matter.id);
  });
});

describe("eligible link candidates", () => {
  it("silently omits linked, archived, and independently unreachable records", async () => {
    const anchorContract = (await createContract("Matter picker anchor")).json().contract as {
      number: number;
    };
    const visibleMatter = await createMatter("Matter candidate visible");
    await createMatter("Matter candidate confidential", true);
    const archivedMatter = await createMatter("Matter candidate archived");
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/matters/${archivedMatter.number}/archive`,
          cookies: memberCookies,
        })
      ).statusCode,
    ).toBe(200);
    const matterCandidates = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${anchorContract.number}/matter-candidates?q=Matter%20candidate`,
      cookies: outsiderCookies,
    });
    expect(matterCandidates.statusCode, matterCandidates.body).toBe(200);
    expect(matterCandidates.json().candidates).toEqual([
      expect.objectContaining({ number: visibleMatter.number, title: visibleMatter.title }),
    ]);
    const creationCandidates = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/matter-candidates?q=Matter%20candidate",
      cookies: outsiderCookies,
    });
    expect(creationCandidates.statusCode, creationCandidates.body).toBe(200);
    expect(creationCandidates.json().candidates).toEqual([
      expect.objectContaining({ number: visibleMatter.number, title: visibleMatter.title }),
    ]);

    const anchorMatter = await createMatter("Contract picker anchor");
    const visibleContract = (await createContract("Contract candidate visible")).json()
      .contract as {
      number: number;
      title: string;
    };
    await createContract("Contract candidate confidential", { isConfidential: true });
    const archivedContract = (await createContract("Contract candidate archived")).json()
      .contract as {
      number: number;
    };
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/contracts/${archivedContract.number}/archive`,
          cookies: memberCookies,
        })
      ).statusCode,
    ).toBe(200);
    const linkedContract = (await createContract("Contract candidate linked")).json().contract as {
      number: number;
    };
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/contracts/${linkedContract.number}/matter`,
          cookies: memberCookies,
          payload: { matterNumber: visibleMatter.number },
        })
      ).statusCode,
    ).toBe(201);
    const contractCandidates = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${anchorMatter.number}/contract-candidates?q=Contract%20candidate`,
      cookies: outsiderCookies,
    });
    expect(contractCandidates.statusCode, contractCandidates.body).toBe(200);
    expect(contractCandidates.json().candidates).toEqual([
      expect.objectContaining({ number: visibleContract.number, title: visibleContract.title }),
    ]);
  });
});

describe("link cardinality, races, and narration", () => {
  it("links and unlinks from the one Contract datum and writes one Activity entry per act", async () => {
    const matter = await createMatter("Canonical Matter");
    const born = await createContract("Canonical Contract");
    const contract = born.json().contract as { id: string; number: number };
    const link = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/matter`,
      cookies: memberCookies,
      payload: { matterNumber: matter.number },
    });
    expect(link.statusCode, link.body).toBe(201);
    expect(link.json()).toMatchObject({
      matter: { restricted: false, number: matter.number },
      confidentialityMismatch: false,
    });
    const fromMatter = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/contracts`,
      cookies: memberCookies,
    });
    expect(fromMatter.json().contracts).toEqual([
      expect.objectContaining({ restricted: false, number: contract.number }),
    ]);

    const unlink = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${contract.number}/matter`,
      cookies: memberCookies,
    });
    expect(unlink.statusCode, unlink.body).toBe(200);
    expect(unlink.json()).toEqual({ matter: null });
    const entries = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, contract.id),
          eq(activityLog.action, "contract.matter_linked"),
        ),
      );
    expect(entries).toHaveLength(1);
    expect(
      await harness.db
        .select({ action: activityLog.action })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, contract.id),
            eq(activityLog.action, "contract.matter_unlinked"),
          ),
        ),
    ).toHaveLength(1);
  });

  it("refuses a direct move until unlink and lets one concurrent target win", async () => {
    const firstMatter = await createMatter("First target");
    const secondMatter = await createMatter("Second target");
    const direct = (await createContract("No direct move")).json().contract as {
      number: number;
    };
    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${direct.number}/matter`,
      cookies: memberCookies,
      payload: { matterNumber: firstMatter.number },
    });
    expect(first.statusCode).toBe(201);
    const move = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${direct.number}/matter`,
      cookies: memberCookies,
      payload: { matterNumber: secondMatter.number },
    });
    expect(move.statusCode).toBe(409);

    const racing = (await createContract("Racing Contract")).json().contract as {
      id: string;
      number: number;
    };
    const outcomes = await Promise.all(
      [firstMatter.number, secondMatter.number].map((matterNumber) =>
        harness.app.inject({
          method: "POST",
          url: `/api/v1/contracts/${racing.number}/matter`,
          cookies: memberCookies,
          payload: { matterNumber },
        }),
      ),
    );
    expect(outcomes.map((outcome) => outcome.statusCode).sort()).toEqual([201, 409]);
    const [stored] = await harness.db
      .select({ matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.id, racing.id));
    expect([firstMatter.id, secondMatter.id]).toContain(stored?.matterId);
  });

  it("can explicitly unlink from a Matter that was archived after linking", async () => {
    const matter = await createMatter("Archived after link");
    const contract = (
      await createContract("Escapes archived Matter", {
        matterNumber: matter.number,
      })
    ).json().contract as { id: string; number: number };
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/archive`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const unlinked = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${contract.number}/matter`,
      cookies: memberCookies,
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    const [stored] = await harness.db
      .select({ matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(stored?.matterId).toBeNull();
  });
});

describe("independent reach and Confidentiality", () => {
  it("returns title-free Restricted placeholders in both directions", async () => {
    const matter = await createMatter("Contributor sees Matter");
    const born = await createContract("Contributor cannot see Contract", {
      matterNumber: matter.number,
    });
    expect(born.statusCode, born.body).toBe(201);
    await addToMatter(matter.number);
    const contractsRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/contracts`,
      cookies: contributorCookies,
    });
    expect(contractsRead.json().contracts).toEqual([{ restricted: true }]);

    const otherMatter = await createMatter("Contributor cannot see Matter");
    const otherBorn = await createContract("Contributor sees Contract", {
      matterNumber: otherMatter.number,
    });
    const otherContract = otherBorn.json().contract as { id: string; number: number };
    await addToContract(otherContract.number);
    const matterRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${otherContract.number}/matter`,
      cookies: contributorCookies,
    });
    expect(matterRead.json()).toEqual({ matter: { restricted: true } });
    const activity = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=contract&entityId=${otherContract.id}`,
      cookies: contributorCookies,
    });
    expect(activity.statusCode, activity.body).toBe(200);
    const linkedEntry = activity
      .json()
      .entries.find((entry: { action: string }) => entry.action === "contract.matter_linked");
    expect(linkedEntry.payload).toEqual({
      number: otherContract.number,
      title: "Contributor sees Contract",
    });
  });

  it("reports a mismatch once while leaving both flags independent", async () => {
    const matter = await createMatter("Confidential Matter", true);
    const born = await createContract("Open Contract");
    const contract = born.json().contract as { id: string; number: number };
    const link = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/matter`,
      cookies: memberCookies,
      payload: { matterNumber: matter.number },
    });
    expect(link.statusCode, link.body).toBe(201);
    expect(link.json().confidentialityMismatch).toBe(true);
    const [stored] = await harness.db
      .select({ confidential: contracts.isConfidential, matterId: contracts.matterId })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(stored).toEqual({ confidential: false, matterId: matter.id });
    const [storedMatter] = await harness.db
      .select({ confidential: matters.isConfidential })
      .from(matters)
      .where(eq(matters.id, matter.id));
    expect(storedMatter).toEqual({ confidential: true });
  });

  it("keeps writes Member+ and requires reach to both records", async () => {
    const matter = await createMatter("Permission Matter");
    const born = await createContract("Permission Contract");
    const contract = born.json().contract as { number: number };
    await addToContract(contract.number);
    await addToMatter(matter.number);
    const contributor = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/matter`,
      cookies: contributorCookies,
      payload: { matterNumber: matter.number },
    });
    expect(contributor.statusCode).toBe(403);

    const walledMatter = await createMatter("Walled Matter", true);
    const outsider = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/matter`,
      cookies: outsiderCookies,
      payload: { matterNumber: walledMatter.number },
    });
    expect(outsider.statusCode).toBe(404);
  });
});
