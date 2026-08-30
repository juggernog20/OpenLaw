// SPDX-License-Identifier: AGPL-3.0-only

/** M27/6's Entity obligations and unified compliance calendar at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, entityObligations, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "obligations-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const COLLEAGUE = {
  email: "obligations-colleague@example.com",
  displayName: "Yusuf Haddad",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let adminCookies: Record<string, string>;
let memberId: string;
let corporationId: string;
let colleagueId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  for (const fixture of [MEMBER, COLLEAGUE]) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({ role: "legal_team_member", timezone: fixture === MEMBER ? "Asia/Dubai" : null })
      .where(eq(users.id, person.id));
    if (fixture === COLLEAGUE) colleagueId = person.id;
    if (fixture === MEMBER) memberId = person.id;
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  corporationId = types
    .json()
    .entityTypes.find((row: { slug: string }) => row.slug === "corporation").id;
});

afterAll(async () => harness.stop());

async function newEntity(legalName: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: { legalName, entityTypeId: corporationId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().entity as { id: string; legalName: string };
}

async function newRegistration(entityId: string, jurisdiction: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${entityId}/registrations`,
    cookies: memberCookies,
    payload: { jurisdiction, registrationNumber: "CH-77821" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().registration as { id: string };
}

async function newMatter(title: string) {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: memberCookies,
  });
  const matterTypeId = options.json().matterTypes[0].id as string;
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: memberCookies,
    payload: { title, matterTypeId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matter as { id: string; number: number; title: string };
}

async function createObligation(entityId: string, body: Record<string, unknown>) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/entities/${entityId}/obligations`,
    cookies: memberCookies,
    payload: body,
  });
}

describe("Entity obligation CRUD", () => {
  it("creates, lists, updates, and deletes a blank-start obligation with every optional link", async () => {
    const entity = await newEntity("Obligation CRUD UK Ltd");
    const registration = await newRegistration(entity.id, "England & Wales");
    const matter = await newMatter("Annual return preparation");

    const initially = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${entity.id}/obligations`,
      cookies: memberCookies,
    });
    expect(initially.statusCode, initially.body).toBe(200);
    expect(initially.json().obligations).toEqual([]);

    const created = await createObligation(entity.id, {
      label: "Annual return",
      registrationId: registration.id,
      recurrenceMonths: 12,
      nextDueOn: "2026-09-30",
      assigneeId: colleagueId,
      note: "File online",
      matterId: matter.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().obligation).toMatchObject({
      entityId: entity.id,
      label: "Annual return",
      recurrenceMonths: 12,
      nextDueOn: "2026-09-30",
      registration: { id: registration.id, jurisdiction: "England & Wales" },
      assignee: { id: colleagueId, displayName: COLLEAGUE.displayName },
      note: "File online",
      matter: { id: matter.id, number: matter.number, title: matter.title },
      completedOn: null,
    });
    const obligationId = created.json().obligation.id as string;

    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entity.id}/obligations/${obligationId}`,
      cookies: memberCookies,
      payload: {
        label: "Confirmation statement",
        registrationId: null,
        recurrenceMonths: 6,
        assigneeId: null,
        note: null,
        matterId: null,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().obligation).toMatchObject({
      label: "Confirmation statement",
      registration: null,
      recurrenceMonths: 6,
      assignee: null,
      note: null,
      matter: null,
    });

    const listed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${entity.id}/obligations`,
      cookies: memberCookies,
    });
    expect(listed.json().obligations.map((row: { id: string }) => row.id)).toContain(obligationId);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${entity.id}/obligations/${obligationId}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    const rows = await harness.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.entityId, entity.id));
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "entity_obligation.created",
        "entity_obligation.updated",
        "entity_obligation.deleted",
      ]),
    );
  });

  it("unlinks an obligation when its registration is deleted", async () => {
    const entity = await newEntity("Registration Unlink Ltd");
    const registration = await newRegistration(entity.id, "Scotland");
    const created = await createObligation(entity.id, {
      label: "Scottish registration renewal",
      registrationId: registration.id,
      nextDueOn: "2026-10-10",
    });
    const obligationId = created.json().obligation.id as string;

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entities/${entity.id}/registrations/${registration.id}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    const [row] = await harness.db
      .select({ registrationId: entityObligations.registrationId })
      .from(entityObligations)
      .where(eq(entityObligations.id, obligationId));
    expect(row?.registrationId).toBeNull();
  });
});

describe("Mark filed", () => {
  it("rolls a recurring obligation once and records the previous cycle", async () => {
    const entity = await newEntity("Recurring Filing Ltd");
    const created = await createObligation(entity.id, {
      label: "Annual return",
      recurrenceMonths: 12,
      nextDueOn: "2026-09-30",
    });
    const obligationId = created.json().obligation.id as string;
    const filed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/obligations/${obligationId}/file`,
      cookies: memberCookies,
      payload: { filedOn: "2026-09-20" },
    });
    expect(filed.statusCode, filed.body).toBe(200);
    expect(filed.json().obligation).toMatchObject({
      nextDueOn: "2027-09-30",
      completedOn: null,
    });
    const [activity] = await harness.db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(
        and(eq(activityLog.entityId, entity.id), eq(activityLog.action, "entity_obligation.filed")),
      );
    expect(activity?.payload).toMatchObject({
      obligationId,
      cycleDate: "2026-09-20",
      previousDueOn: "2026-09-30",
      nextDueOn: "2027-09-30",
    });
  });

  it("completes a one-off and defaults filedOn to the caller's local day", async () => {
    const entity = await newEntity("One-off Filing Ltd");
    const created = await createObligation(entity.id, {
      label: "Licence application",
      recurrenceMonths: null,
      nextDueOn: "2026-08-30",
    });
    const expectedLocalDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dubai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const filed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/obligations/${created.json().obligation.id}/file`,
      cookies: memberCookies,
      payload: {},
    });
    expect(filed.statusCode, filed.body).toBe(200);
    expect(filed.json().obligation.completedOn).toBe(expectedLocalDay);
    expect(filed.json().obligation.nextDueOn).toBe("2026-08-30");
    const [activity] = await harness.db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(
        and(eq(activityLog.entityId, entity.id), eq(activityLog.action, "entity_obligation.filed")),
      );
    expect(activity?.payload).toMatchObject({
      previousDueOn: "2026-08-30",
      cycleDate: filed.json().obligation.completedOn,
      completedOn: filed.json().obligation.completedOn,
      nextDueOn: null,
    });
  });

  it("catches up across two missed recurrence cycles and stops after filedOn", async () => {
    const entity = await newEntity("Missed Cycles Ltd");
    const created = await createObligation(entity.id, {
      label: "Biennial register",
      recurrenceMonths: 6,
      nextDueOn: "2025-01-31",
    });
    const filed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entity.id}/obligations/${created.json().obligation.id}/file`,
      cookies: memberCookies,
      payload: { filedOn: "2026-02-01" },
    });
    expect(filed.statusCode, filed.body).toBe(200);
    expect(filed.json().obligation.nextDueOn).toBe("2026-07-31");
  });
});

describe("the unified compliance calendar", () => {
  it("omits a Confidential Entity until the viewer has an Entity grant", async () => {
    const entity = await newEntity("Hidden Calendar Vehicle");
    expect(
      (
        await createObligation(entity.id, {
          label: "Hidden annual filing",
          nextDueOn: "2026-10-30",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await harness.app.inject({
          method: "PATCH",
          url: `/api/v1/entities/${entity.id}`,
          cookies: adminCookies,
          payload: { isConfidential: true },
        })
      ).statusCode,
    ).toBe(200);
    const walled = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/calendar",
      cookies: memberCookies,
    });
    expect(walled.body).not.toContain("Hidden Calendar Vehicle");
    expect(walled.body).not.toContain("Hidden annual filing");

    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/entities/${entity.id}/grants`,
          cookies: adminCookies,
          payload: { userId: memberId },
        })
      ).statusCode,
    ).toBe(201);
    const reached = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/calendar",
      cookies: memberCookies,
    });
    expect(reached.body).toContain("Hidden Calendar Vehicle");
    expect(reached.body).toContain("Hidden annual filing");
  });

  it("puts overdue obligations first, then due-date order, and applies every filter", async () => {
    const firstEntity = await newEntity("Calendar Alpha Ltd");
    const secondEntity = await newEntity("Calendar Beta Ltd");
    const overdue = await createObligation(firstEntity.id, {
      label: "Overdue filing",
      nextDueOn: "2025-01-10",
      assigneeId: colleagueId,
    });
    await createObligation(secondEntity.id, {
      label: "Later filing",
      nextDueOn: "2027-03-20",
    });
    const completed = await createObligation(firstEntity.id, {
      label: "Completed filing",
      nextDueOn: "2026-05-01",
    });
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${firstEntity.id}/obligations/${completed.json().obligation.id}/file`,
      cookies: memberCookies,
      payload: { filedOn: "2026-05-01" },
    });

    const allOpen = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/calendar",
      cookies: memberCookies,
    });
    expect(allOpen.statusCode, allOpen.body).toBe(200);
    const calendarRows = allOpen.json().obligations as {
      label: string;
      overdue: boolean;
      nextDueOn: string;
    }[];
    expect(calendarRows.map((row) => row.label)).toEqual(
      expect.arrayContaining(["Overdue filing", "Later filing"]),
    );
    expect(calendarRows.map((row) => row.label)).not.toContain("Completed filing");
    const firstUpcoming = calendarRows.findIndex((row) => !row.overdue);
    expect(calendarRows.slice(0, firstUpcoming).every((row) => row.overdue)).toBe(true);
    expect(calendarRows.slice(firstUpcoming).every((row) => !row.overdue)).toBe(true);
    for (const partition of [
      calendarRows.slice(0, firstUpcoming),
      calendarRows.slice(firstUpcoming),
    ]) {
      expect(partition.map((row) => row.nextDueOn)).toEqual(
        [...partition.map((row) => row.nextDueOn)].sort(),
      );
    }

    const filtered = await harness.app.inject({
      method: "GET",
      url:
        `/api/v1/entities/calendar?entity=${firstEntity.id}&assignee=${colleagueId}` +
        "&from=2025-01-01&to=2025-12-31&includeCompleted=true",
      cookies: memberCookies,
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().obligations).toHaveLength(1);
    expect(filtered.json().obligations[0]).toMatchObject({
      id: overdue.json().obligation.id,
      entity: { id: firstEntity.id, legalName: firstEntity.legalName },
      assignee: { id: colleagueId },
    });
  });
});
