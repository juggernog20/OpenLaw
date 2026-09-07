// SPDX-License-Identifier: AGPL-3.0-only

/** The Matters list contract at the HTTP seam, against real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, matterKeyDates, matters, matterStatuses, matterTeam, users } from "@openlaw/db";
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
  total: number;
  matters: {
    id: string;
    number: number;
    title: string;
    statusName: string;
    manager: { id: string } | null;
    nextDeadline: { date: string; label: string } | null;
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

  it("combines multi-value filters before paging and counts only the matching reachable records", async () => {
    const query = {
      manager: "me,unassigned",
      priority: "critical,medium",
      type: plainTypeId,
      risk: "unassigned",
    };
    const first = await list(memberCookies, query);
    expect(first.total).toBe(52);
    expect(first.matters).toHaveLength(50);
    const second = await list(memberCookies, { ...query, cursor: first.nextCursor! });
    expect(second.total).toBe(52);
    expect(second.matters).toHaveLength(2);
    expect(new Set([...first.matters, ...second.matters].map((row) => row.id))).toEqual(
      new Set(visibleIds),
    );
    expect((await list(memberCookies, { manager: "me", priority: "critical" })).total).toBe(0);
    expect((await list(contributorCookies, query)).total).toBe(1);
    expect(
      (await list(memberCookies, { openedFrom: "2000-01-01", openedTo: "2000-01-01" })).total,
    ).toBe(0);
    for (const suffix of [
      "openedFrom=2026-12-02&openedTo=2026-12-01",
      "priority=critical,invalid",
      "deadlineFrom=2026-02-30",
      `manager=${Array(51).fill("me").join(",")}`,
    ]) {
      const invalid = await harness.app.inject({
        method: "GET",
        url: `/api/v1/matters?${suffix}`,
        cookies: memberCookies,
      });
      expect(invalid.statusCode, suffix).toBe(400);
    }
  });

  it("filters Opened dates in the reader's timezone, including daylight-saving boundaries", async () => {
    const id = visibleIds[1]!;
    const [original] = await harness.db
      .select({ openedAt: matters.openedAt })
      .from(matters)
      .where(eq(matters.id, id));
    try {
      for (const [instant, timeZone, date] of [
        ["2026-08-31T21:30:00Z", "Asia/Dubai", "2026-09-01"],
        ["2026-03-29T22:30:00Z", "Europe/Berlin", "2026-03-30"],
      ]) {
        await harness.db
          .update(matters)
          .set({ openedAt: new Date(instant!) })
          .where(eq(matters.id, id));
        const query = { manager: "me", openedFrom: date!, openedTo: date! };
        expect(
          (await list(memberCookies, { ...query, timeZone: timeZone! })).matters.map(
            (row) => row.id,
          ),
        ).toEqual([id]);
        expect((await list(memberCookies, { ...query, timeZone: "UTC" })).total).toBe(0);
      }
    } finally {
      await harness.db
        .update(matters)
        .set({ openedAt: original!.openedAt })
        .where(eq(matters.id, id));
    }
  });

  it("offers filter labels only from records the reader can reach", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters/filter-options",
      cookies: contributorCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      types: [{ id: plainTypeId, displayName: "Matter list plain" }],
      statuses: [{ id: onHoldStatusId, displayName: "On hold" }],
      people: [],
    });
    const refused = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters/filter-options",
      cookies: businessCookies,
    });
    expect(refused.statusCode).toBe(403);
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

  it("returns the earliest today-or-future Key date only for an active Matter", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await harness.db.insert(matterKeyDates).values([
      { matterId: visibleIds[0]!, date: "2020-01-01", label: "Already passed" },
      { matterId: visibleIds[0]!, date: "2099-01-01", label: "Later deadline" },
      { matterId: visibleIds[0]!, date: today, label: "Today deadline" },
      { matterId: visibleIds[1]!, date: "2020-01-02", label: "Past only" },
    ]);
    const deadlineOf = (answer: MatterListAnswer, id: string) =>
      answer.matters.find((row) => row.id === id)!.nextDeadline;

    const active = await list(contributorCookies);
    expect(deadlineOf(active, visibleIds[0]!)).toEqual({
      date: today,
      label: "Today deadline",
    });
    const bounded = await list(contributorCookies, { deadlineFrom: today, deadlineTo: today });
    expect(bounded.matters.map((row) => row.id)).toEqual([visibleIds[0]]);
    expect(bounded.total).toBe(1);
    expect((await list(contributorCookies, { deadlineFrom: "2099-01-01" })).total).toBe(0);
    const pastOnly = await list(memberCookies, { manager: memberId });
    expect(deadlineOf(pastOnly, visibleIds[1]!)).toBeNull();

    await harness.db
      .update(matters)
      .set({ statusId: closedStatusId, closedAt: new Date() })
      .where(eq(matters.id, visibleIds[0]!));
    const closed = await list(contributorCookies, { includeClosed: "true" });
    expect(deadlineOf(closed, visibleIds[0]!)).toBeNull();

    await harness.db
      .update(matters)
      .set({ statusId: openStatusId, closedAt: null })
      .where(eq(matters.id, visibleIds[0]!));
    expect(deadlineOf(await list(contributorCookies), visibleIds[0]!)).toEqual({
      date: today,
      label: "Today deadline",
    });
  });
});
