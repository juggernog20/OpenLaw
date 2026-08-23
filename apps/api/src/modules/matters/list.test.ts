// SPDX-License-Identifier: AGPL-3.0-only

/** The Matters list contract at the HTTP seam, against real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, matters, matterStatuses, matterTeam, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "matter-list-member@example.com",
  displayName: "Mina Matter",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-list-outsider@example.com",
  displayName: "Owen Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-list-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "matter-list-business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;

interface MatterListAnswer {
  matters: {
    id: string;
    number: number;
    title: string;
    statusName: string;
    manager: { id: string } | null;
  }[];
  nextCursor: string | null;
  counts: { open: number; onHold: number };
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let businessCookies: Record<string, string>;
let memberId = "";
let outsiderId = "";
let contributorId = "";
let plainTypeId = "";
let requiredTypeId = "";
let requiredSlug = "";
let openStatusId = "";
let onHoldStatusId = "";
let closedStatusId = "";
let incompleteId = "";
let completeRequiredId = "";
let archivedId = "";
const visibleIds: string[] = [];

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture.email === MEMBER.email) memberId = person.id;
    if (fixture.email === OUTSIDER.email) outsiderId = person.id;
    if (fixture.email === CONTRIBUTOR.email) contributorId = person.id;
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);

  plainTypeId = await createType("Matter list plain");
  requiredTypeId = await createType("Matter list required");
  requiredSlug = await attachRequiredField(requiredTypeId);
  const statuses = await harness.db.select().from(matterStatuses);
  openStatusId = statuses.find((row) => row.slug === "open")!.id;
  onHoldStatusId = statuses.find((row) => row.slug === "on_hold")!.id;
  closedStatusId = statuses.find((row) => row.slug === "closed")!.id;

  for (let index = 0; index < 52; index += 1) {
    const id = await insertMatter({
      title: `Reachable ${String(index).padStart(2, "0")}`,
      matterTypeId: plainTypeId,
      statusId: index === 0 ? onHoldStatusId : openStatusId,
      managerId: index === 1 ? memberId : null,
      priority: index === 2 ? "critical" : "medium",
    });
    visibleIds.push(id);
  }
  incompleteId = await insertMatter({
    title: "Required value missing",
    matterTypeId: requiredTypeId,
    statusId: openStatusId,
    customFields: {},
  });
  completeRequiredId = await insertMatter({
    title: "Required value present",
    matterTypeId: requiredTypeId,
    statusId: openStatusId,
    customFields: { [requiredSlug]: "Finance" },
  });
  await insertMatter({
    title: "Closed matter",
    matterTypeId: plainTypeId,
    statusId: closedStatusId,
    closedAt: new Date(),
  });
  archivedId = await insertMatter({
    title: "Archived matter",
    matterTypeId: plainTypeId,
    statusId: openStatusId,
    archivedAt: new Date(),
  });
  await insertMatter({
    title: "Confidential outsider matter",
    matterTypeId: plainTypeId,
    statusId: openStatusId,
    isConfidential: true,
    createdBy: outsiderId,
  });

  await harness.db.insert(matterTeam).values({
    matterId: visibleIds[0]!,
    userId: contributorId,
    role: "contributor",
  });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function createType(displayName: string): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterType.id as string;
}

async function attachRequiredField(typeId: string): Promise<string> {
  const defined = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: {
      moduleScope: "matter",
      fieldTag: "legal",
      displayName: "Required list value",
      fieldType: "text",
    },
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

async function insertMatter(input: {
  title: string;
  matterTypeId: string;
  statusId: string;
  managerId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  customFields?: Record<string, string>;
  closedAt?: Date;
  archivedAt?: Date;
  isConfidential?: boolean;
  createdBy?: string;
}): Promise<string> {
  const [row] = await harness.db
    .insert(matters)
    .values({
      title: input.title,
      matterTypeId: input.matterTypeId,
      statusId: input.statusId,
      managerId: input.managerId ?? null,
      priority: input.priority ?? "medium",
      customFields: input.customFields ?? {},
      closedAt: input.closedAt,
      archivedAt: input.archivedAt,
      isConfidential: input.isConfidential ?? false,
      createdBy: input.createdBy ?? memberId,
    })
    .returning({ id: matters.id });
  return row!.id;
}

async function list(
  cookies: Record<string, string>,
  query: Record<string, string> = {},
): Promise<MatterListAnswer> {
  const search = new URLSearchParams(query);
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matters${search.size ? `?${search.toString()}` : ""}`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as MatterListAnswer;
}

describe("the Matters list", () => {
  it("defaults to active, unarchived matters and fills a page after applying reach", async () => {
    const answer = await list(memberCookies);
    expect(answer.matters).toHaveLength(50);
    expect(answer.nextCursor).not.toBeNull();
    expect(answer.matters.some((row) => row.title === "Closed matter")).toBe(false);
    expect(answer.matters.some((row) => row.id === archivedId)).toBe(false);
    expect(answer.matters.some((row) => row.title === "Confidential outsider matter")).toBe(false);
    expect(answer.counts).toEqual({ open: 53, onHold: 1 });
  });

  it("widens only for the closed and archived toggles", async () => {
    const closed = await list(memberCookies, { includeClosed: "true" });
    expect(closed.matters.some((row) => row.title === "Closed matter")).toBe(true);
    expect(closed.matters.some((row) => row.id === archivedId)).toBe(false);
    const archived = await list(memberCookies, { includeArchived: "true" });
    expect(archived.matters.some((row) => row.id === archivedId)).toBe(true);
    expect(archived.matters.some((row) => row.title === "Closed matter")).toBe(false);
  });

  it("lists exactly current-type records missing a required value", async () => {
    const answer = await list(memberCookies, { incomplete: "true" });
    expect(answer.matters.map((row) => row.id)).toEqual([incompleteId]);
    expect(answer.matters.some((row) => row.id === completeRequiredId)).toBe(false);
  });

  it("keeps a Contributor to their matter_team rows", async () => {
    const answer = await list(contributorCookies);
    expect(answer.matters.map((row) => row.id)).toEqual([visibleIds[0]]);
    expect(answer.counts).toEqual({ open: 0, onHold: 1 });
  });

  it("refuses a Business User the Matters collection", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters",
      cookies: businessCookies,
    });
    expect(response.statusCode).toBe(403);
  });

  it("filters on every field and pins every sort key at the HTTP boundary", async () => {
    for (const query of [{ status: openStatusId }, { type: plainTypeId }] as Record<
      string,
      string
    >[]) {
      expect((await list(memberCookies, query)).matters.length).toBeGreaterThan(0);
    }
    expect(
      (await list(memberCookies, { priority: "critical" })).matters.map((row) => row.id),
    ).toEqual([visibleIds[2]]);
    for (const manager of ["me", memberId]) {
      expect((await list(memberCookies, { manager })).matters.map((row) => row.id)).toEqual([
        visibleIds[1],
      ]);
    }
    for (const sort of [
      "number",
      "title",
      "type",
      "status",
      "priority",
      "risk",
      "manager",
      "openedAt",
    ]) {
      expect((await list(memberCookies, { sort, dir: "asc" })).matters).toHaveLength(50);
    }
    const invalid = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters?sort=createdAt",
      cookies: memberCookies,
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("continues every keyset ordering through unique, tied, joined, and null values", async () => {
    for (const sort of [
      "number",
      "title",
      "type",
      "status",
      "priority",
      "risk",
      "manager",
      "openedAt",
    ]) {
      const first = await list(memberCookies, { sort, dir: "asc" });
      const second = await list(memberCookies, {
        sort,
        dir: "asc",
        cursor: first.nextCursor!,
      });
      const ids = [...first.matters, ...second.matters].map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(54);
    }
  });
});
