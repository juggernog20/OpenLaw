// SPDX-License-Identifier: AGPL-3.0-only

/** Matter birth at both seams: HTTP and a caller-owned transaction. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, matters, matterTeam, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { HttpError, type Problem } from "../../lib/problem.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { createMatter, type CreateMatterInput } from "./create.js";

const MEMBER = {
  email: "matter-member@example.com",
  displayName: "Mina Member",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-outsider@example.com",
  displayName: "Owen Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "matter-business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let memberId: string;
let contributorId: string;
let plainTypeId: string;
let archivedTypeId: string;
let demandingTypeId: string;
let requiredSlug: string;

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
    [BUSINESS, "business_user"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture.email === MEMBER.email) memberId = person.id;
    if (fixture.email === CONTRIBUTOR.email) contributorId = person.id;
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  plainTypeId = await newType("Matter plain");
  archivedTypeId = await newType("Matter retired");
  const archive = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matter-types/${archivedTypeId}/archive`,
    cookies: adminCookies,
    payload: {},
  });
  expect(archive.statusCode, archive.body).toBe(200);
  demandingTypeId = await newType("Matter demanding");
  requiredSlug = await attachRequiredField(demandingTypeId, "Business unit");
});

afterAll(async () => {
  await harness.stop();
});

async function newType(displayName: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterType.id as string;
}

async function attachRequiredField(typeId: string, displayName: string) {
  const defined = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { moduleScope: "matter", fieldTag: "legal", displayName, fieldType: "text" },
  });
  expect(defined.statusCode, defined.body).toBe(201);
  const field = defined.json().field as { id: string; slug: string };
  const attached = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matter-types/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId: field.id, isRequired: true },
  });
  expect(attached.statusCode, attached.body).toBe(201);
  return field.slug;
}

const createOverHttp = (payload: Record<string, unknown>) =>
  harness.app.inject({ method: "POST", url: "/api/v1/matters", cookies: memberCookies, payload });
const createInCallerTransaction = (input: Omit<CreateMatterInput, "actorId">) =>
  harness.db.transaction((tx) => createMatter(tx, { actorId: memberId, ...input }));

async function refusalOf(call: Promise<unknown>) {
  const outcome = await call.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(HttpError);
  return outcome as HttpError;
}

async function expectMatchingRefusal(payload: {
  title: string;
  matterTypeId: string;
  customFields?: Record<string, string>;
}) {
  const overHttp = await createOverHttp(payload);
  expect(overHttp.statusCode, overHttp.body).toBeGreaterThanOrEqual(400);
  const problem = overHttp.json() as Problem;
  const thrown = await refusalOf(createInCallerTransaction(payload));
  expect(overHttp.statusCode).toBe(thrown.statusCode);
  expect(problem.detail).toBe(thrown.message);
  expect(problem.type).toBe(thrown.type);
  return problem;
}

describe("matter creation", () => {
  it("uses its own sequence, defaults, creator team row, and birth narration", async () => {
    const first = await createOverHttp({ title: "Advice one", matterTypeId: plainTypeId });
    const second = await createOverHttp({
      title: "Advice two",
      matterTypeId: plainTypeId,
      isConfidential: true,
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    const one = first.json().matter;
    const two = second.json().matter;
    expect(two.number).toBe(one.number + 1);
    expect(one).toMatchObject({
      statusName: "Open",
      statusCategory: "open",
      manager: null,
      priority: "medium",
      risk: null,
      closedAt: null,
      isConfidential: false,
    });
    expect(one.openedAt).toEqual(expect.any(String));
    const [stored] = await harness.db.select().from(matters).where(eq(matters.id, one.id));
    expect(stored!.createdBy).toBe(memberId);
    expect(
      await harness.db
        .select()
        .from(matterTeam)
        .where(and(eq(matterTeam.matterId, one.id), eq(matterTeam.userId, memberId))),
    ).toHaveLength(1);
    expect(
      await harness.db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityId, one.id), eq(activityLog.action, "matter.created"))),
    ).toHaveLength(1);
    expect(
      await harness.db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, one.id),
            eq(activityLog.action, "matter.confidentiality_set"),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, two.id),
            eq(activityLog.action, "matter.confidentiality_set"),
          ),
        ),
    ).toHaveLength(1);
  });

  it("refuses a body-supplied number", async () => {
    const response = await createOverHttp({
      number: 999,
      title: "No number",
      matterTypeId: plainTypeId,
    });
    expect(response.statusCode, response.body).toBe(400);
  });

  it("commits and rolls back with the transaction that called it", async () => {
    const committed = await createInCallerTransaction({
      title: "Caller commit",
      matterTypeId: plainTypeId,
    });
    expect(
      await harness.db.select().from(matters).where(eq(matters.id, committed.row.id)),
    ).toHaveLength(1);
    await expect(
      harness.db.transaction(async (tx) => {
        await createMatter(tx, {
          actorId: memberId,
          title: "Caller rollback",
          matterTypeId: plainTypeId,
        });
        throw new Error("after create");
      }),
    ).rejects.toThrow("after create");
    expect(
      await harness.db.select().from(matters).where(eq(matters.title, "Caller rollback")),
    ).toHaveLength(0);
  });
});

describe("callable refusal parity", () => {
  it("matches for archived types, required gaps, and unattached slugs", async () => {
    expect(
      (await expectMatchingRefusal({ title: "Archived", matterTypeId: archivedTypeId })).status,
    ).toBe(400);
    expect(
      (await expectMatchingRefusal({ title: "Gap", matterTypeId: demandingTypeId })).detail,
    ).toContain("Business unit");
    expect(
      (
        await expectMatchingRefusal({
          title: "Stray",
          matterTypeId: plainTypeId,
          customFields: { [requiredSlug]: "Legal" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("matter reach", () => {
  it("404s a confidential matter outside its team and admits its team, manager, and Administrator", async () => {
    const created = await createOverHttp({
      title: "Private advice",
      matterTypeId: plainTypeId,
      managerId: memberId,
      isConfidential: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const matter = created.json().matter;
    const outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
    const contributorCookies = await signInCookies(
      harness.app,
      CONTRIBUTOR.email,
      CONTRIBUTOR.password,
    );
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: outsiderCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: contributorCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: memberCookies,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: adminCookies,
        })
      ).statusCode,
    ).toBe(200);
    await harness.db
      .insert(matterTeam)
      .values({ matterId: matter.id, userId: contributorId, role: "contributor" });
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/matters/${matter.number}`,
          cookies: contributorCookies,
        })
      ).statusCode,
    ).toBe(200);
    const businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/matters",
          cookies: businessCookies,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("admits a Manager who is not on the team, and names the people its fields hold", async () => {
    const sponsorTypeId = await newType("Matter sponsored");
    const defined = await harness.app.inject({
      method: "POST",
      url: "/api/v1/fields",
      cookies: adminCookies,
      payload: {
        moduleScope: "matter",
        fieldTag: "legal",
        displayName: "Sponsor",
        fieldType: "user",
      },
    });
    expect(defined.statusCode, defined.body).toBe(201);
    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${sponsorTypeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId: defined.json().field.id },
    });
    expect(attached.statusCode, attached.body).toBe(201);
    const [outsider] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, OUTSIDER.email));
    // The Administrator creates it, so the Manager holds no team row:
    // the manager column alone must carry the reach (DD-014).
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matters",
      cookies: adminCookies,
      payload: {
        title: "Managed privately",
        matterTypeId: sponsorTypeId,
        managerId: outsider!.id,
        isConfidential: true,
        customFields: { [defined.json().field.slug]: memberId },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${created.json().matter.number}`,
      cookies: outsiderCookies,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().customFieldRefs.users).toEqual([
      { id: memberId, displayName: MEMBER.displayName, archived: false },
    ]);
    const unreached = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${created.json().matter.number}`,
      cookies: memberCookies,
    });
    expect(unreached.statusCode, unreached.body).toBe(404);
  });

  it("refuses creation to a Contributor and a Business User", async () => {
    for (const fixture of [CONTRIBUTOR, BUSINESS]) {
      const cookies = await signInCookies(harness.app, fixture.email, fixture.password);
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/matters",
        cookies,
        payload: { title: "Not permitted", matterTypeId: plainTypeId },
      });
      expect(response.statusCode, response.body).toBe(403);
    }
  });
});
