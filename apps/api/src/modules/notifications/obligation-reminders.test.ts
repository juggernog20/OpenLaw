// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-006's fourth morning-round source: assignee reminders and Administrator fallback. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entityObligations, eq, notifications, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import type { PipelineLogger } from "../../pipeline/logger.js";
import { runMorningRound } from "../../pipeline/morning-round.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const ASSIGNEE = {
  email: "obligation-reminder-assignee@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const OTHER_MEMBER = {
  email: "obligation-reminder-other@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery",
} as const;
const DAYS = [
  { today: "2027-02-04", offset: 7 },
  { today: "2027-02-10", offset: 1 },
  { today: "2027-02-11", offset: 0 },
] as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let assigneeCookies: Record<string, string>;
let otherCookies: Record<string, string>;
let assigneeId: string;
let entityId: string;
let corporationId: string;

const quietLog: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  for (const fixture of [ASSIGNEE, OTHER_MEMBER]) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({ role: "legal_team_member" })
      .where(eq(users.id, person.id));
    if (fixture === ASSIGNEE) assigneeId = person.id;
  }
  assigneeCookies = await signInCookies(harness.app, ASSIGNEE.email, ASSIGNEE.password);
  otherCookies = await signInCookies(harness.app, OTHER_MEMBER.email, OTHER_MEMBER.password);

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: adminCookies,
  });
  corporationId = types.json().entityTypes[0].id as string;
  const entity = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: adminCookies,
    payload: { legalName: "Reminder Entity Ltd", entityTypeId: corporationId },
  });
  entityId = entity.json().entity.id as string;
  for (const [label, assignee] of [
    ["Assigned annual return", assigneeId],
    ["Unassigned licence renewal", null],
  ] as const) {
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entityId}/obligations`,
      cookies: adminCookies,
      payload: { label, nextDueOn: "2027-02-11", assigneeId: assignee },
    });
    expect(created.statusCode, created.body).toBe(201);
  }

  for (const { today } of DAYS) {
    await runMorningRound(
      {
        db: harness.db,
        log: quietLog,
        notifier: harness.notifier,
        resolveMailer: harness.resolveMailer,
        baseUrl: "http://localhost",
      },
      harness.pipeline,
      { now: new Date(`${today}T08:00:00Z`) },
    );
  }
});

afterAll(async () => harness.stop());

async function bell(cookies: Record<string, string>) {
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/notifications",
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().notifications as {
    eventType: string;
    entityId: string;
    payload: object;
  }[];
}

describe("Entity obligation reminders", () => {
  it("falls back to Administrators instead of naming a walled Entity to its assignee", async () => {
    const entity = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entities",
      cookies: adminCookies,
      payload: {
        legalName: "Walled Reminder Vehicle",
        entityTypeId: corporationId,
      },
    });
    expect(entity.statusCode, entity.body).toBe(201);
    const walledId = entity.json().entity.id as string;
    expect(
      (
        await harness.app.inject({
          method: "PATCH",
          url: `/api/v1/entities/${walledId}`,
          cookies: adminCookies,
          payload: { isConfidential: true },
        })
      ).statusCode,
    ).toBe(200);
    const obligation = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${walledId}/obligations`,
      cookies: adminCookies,
      payload: {
        label: "Walled filing",
        nextDueOn: "2027-03-08",
        assigneeId,
      },
    });
    expect(obligation.statusCode, obligation.body).toBe(201);
    await runMorningRound(
      {
        db: harness.db,
        log: quietLog,
        notifier: harness.notifier,
        resolveMailer: harness.resolveMailer,
        baseUrl: "http://localhost",
      },
      harness.pipeline,
      { now: new Date("2027-03-01T08:00:00Z") },
    );
    expect((await bell(assigneeCookies)).filter((row) => row.entityId === walledId)).toEqual([]);
    const fallback = (await bell(adminCookies)).filter((row) => row.entityId === walledId);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.payload).toMatchObject({
      entityLegalName: "Walled Reminder Vehicle",
      label: "Walled filing",
    });
  });

  it("writes one notification per offset to the assignee and every Administrator fallback", async () => {
    const assigned = (await bell(assigneeCookies)).filter((row) => row.entityId === entityId);
    expect(assigned).toHaveLength(3);
    expect(
      assigned
        .map((row) => {
          const payload = row.payload as {
            label: string;
            reminderDate: string;
            offsetDays: number;
          };
          return {
            label: payload.label,
            reminderDate: payload.reminderDate,
            offsetDays: payload.offsetDays,
          };
        })
        .sort((left, right) => right.offsetDays - left.offsetDays),
    ).toEqual(
      DAYS.map(({ offset }) => ({
        label: "Assigned annual return",
        reminderDate: "2027-02-11",
        offsetDays: offset,
      })),
    );
    expect(assigned.every((row) => row.eventType === "date.obligation_approaching")).toBe(true);
    const admin = (await bell(adminCookies)).filter((row) => row.entityId === entityId);
    expect(admin).toHaveLength(3);
    expect(admin.every((row) => row.eventType === "date.obligation_approaching")).toBe(true);
    expect(admin.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Unassigned licence renewal", offsetDays: 7 }),
        expect.objectContaining({ label: "Unassigned licence renewal", offsetDays: 1 }),
        expect.objectContaining({ label: "Unassigned licence renewal", offsetDays: 0 }),
      ]),
    );
    expect((await bell(otherCookies)).filter((row) => row.entityId === entityId)).toEqual([]);
    const held = await harness.db
      .select({ nextDueOn: entityObligations.nextDueOn })
      .from(entityObligations)
      .where(eq(entityObligations.entityId, entityId));
    expect(held.map((row) => row.nextDueOn)).toEqual(["2027-02-11", "2027-02-11"]);
  });

  it("deduplicates a re-run at the same offset", async () => {
    const before = await harness.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.entityId, entityId));
    const rerun = await runMorningRound(
      {
        db: harness.db,
        log: quietLog,
        notifier: harness.notifier,
        resolveMailer: harness.resolveMailer,
        baseUrl: "http://localhost",
      },
      harness.pipeline,
      { now: new Date(`${DAYS.at(-1)!.today}T09:00:00Z`) },
    );
    expect(rerun.reminders).toBe(0);
    const after = await harness.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.entityId, entityId));
    expect(after).toHaveLength(before.length);
  });

  it("adds an Obligations section to each addressed person's morning briefing", () => {
    const assigneeMail = harness.mailer.messagesTo(ASSIGNEE.email).at(-1)!;
    expect(assigneeMail.text).toContain("Obligations");
    expect(assigneeMail.text).toContain("Assigned annual return");
    expect(assigneeMail.text).toContain(`http://localhost/entities/${entityId}/obligations`);
    expect(
      harness.mailer
        .messagesTo(ADMIN.email)
        .some((message) => message.text.includes("Unassigned licence renewal")),
    ).toBe(true);
  });
});
