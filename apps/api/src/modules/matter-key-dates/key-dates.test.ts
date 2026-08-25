// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Key dates at the real-Postgres HTTP seam (MTR-004, #491). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  eq,
  matterKeyDates,
  matters,
  matterStatuses,
  matterTeam,
  matterTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "matter-dates-member@example.com",
  displayName: "Morgan Member",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-dates-outsider@example.com",
  displayName: "Olivia Outsider",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-dates-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

interface Deadline {
  keyDateId: string;
  date: string;
  label: string;
  note: string | null;
  daysAway: number;
  overdue: boolean;
  isNext: boolean;
}

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let memberId = "";
let contributorId = "";
let typeId = "";
let openStatusId = "";
let closedStatusId = "";

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
    if (fixture.email === MEMBER.email) memberId = person.id;
    if (fixture.email === CONTRIBUTOR.email) contributorId = person.id;
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  typeId = (await harness.db.select({ id: matterTypes.id }).from(matterTypes).limit(1))[0]!.id;
  const statuses = await harness.db.select().from(matterStatuses);
  openStatusId = statuses.find((row) => row.category === "open")!.id;
  closedStatusId = statuses.find((row) => row.category === "closed")!.id;
}, 180_000);

afterAll(async () => harness.stop());

async function newMatter(
  title: string,
  options: {
    closed?: boolean;
    archived?: boolean;
    contributor?: boolean;
    confidential?: boolean;
  } = {},
) {
  const [matter] = await harness.db
    .insert(matters)
    .values({
      title,
      matterTypeId: typeId,
      statusId: options.closed ? closedStatusId : openStatusId,
      closedAt: options.closed ? new Date() : null,
      archivedAt: options.archived ? new Date() : null,
      isConfidential: options.confidential ?? false,
      createdBy: memberId,
    })
    .returning({ id: matters.id, number: matters.number });
  if (options.contributor) {
    await harness.db.insert(matterTeam).values({
      matterId: matter!.id,
      userId: contributorId,
      role: "contributor",
    });
  }
  if (options.confidential) {
    await harness.db.insert(matterTeam).values({
      matterId: matter!.id,
      userId: memberId,
      role: "creator",
    });
  }
  return matter!;
}

async function list(number: number, cookies = memberCookies): Promise<Deadline[]> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matters/${number}/key-dates`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().deadlines as Deadline[];
}

async function add(number: number, date: string, label: string, note?: string | null) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matters/${number}/key-dates`,
    cookies: memberCookies,
    payload: { date, label, ...(note === undefined ? {} : { note }) },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json().deadlines as Deadline[]).find((row) => row.label === label)!;
}

describe("Matter Key dates", () => {
  it("starts empty, keeps civil dates fixed, orders chronologically, and narrates the actor", async () => {
    const matter = await newMatter("Civil dates and Activity");
    expect(await list(matter.number)).toEqual([]);

    const today = new Date().toISOString().slice(0, 10);
    await add(matter.number, "2099-05-01", "Later", "  Bring the filing receipt.  ");
    await add(matter.number, "2020-01-02", "Past");
    const current = await add(matter.number, today, "Today", "   ");

    const rows = await list(matter.number);
    expect(rows.map((row) => row.label)).toEqual(["Past", "Today", "Later"]);
    expect(rows.find((row) => row.label === "Later")!.note).toBe("Bring the filing receipt.");
    expect(rows.map((row) => row.date)).toEqual(["2020-01-02", today, "2099-05-01"]);
    expect(rows.map((row) => row.overdue)).toEqual([true, false, false]);
    expect(rows.filter((row) => row.isNext).map((row) => row.label)).toEqual(["Today"]);
    expect(current.note).toBeNull();

    const entries = await harness.db
      .select({ actorId: activityLog.actorId, action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "matter"), eq(activityLog.entityId, matter.id)))
      .orderBy(asc(activityLog.createdAt));
    expect(entries.map((entry) => entry.action)).toEqual([
      "key_date.added",
      "key_date.added",
      "key_date.added",
    ]);
    expect(entries.every((entry) => entry.actorId === memberId)).toBe(true);
  });

  it("edits and removes a Key date, narrating both mutations", async () => {
    const matter = await newMatter("Edit and remove");
    const created = await add(matter.number, "2099-06-01", "First label", "First note");

    const edited = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-key-dates/${created.keyDateId}`,
      cookies: memberCookies,
      payload: { date: "2099-06-02", label: "Second label", note: null },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().deadlines[0]).toMatchObject({
      date: "2099-06-02",
      label: "Second label",
      note: null,
    });

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matter-key-dates/${created.keyDateId}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().deadlines).toEqual([]);
    expect(
      await harness.db
        .select()
        .from(matterKeyDates)
        .where(eq(matterKeyDates.id, created.keyDateId)),
    ).toEqual([]);

    const entries = await harness.db
      .select({ action: activityLog.action, payload: activityLog.payload })
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "matter"), eq(activityLog.entityId, matter.id)))
      .orderBy(asc(activityLog.createdAt));
    expect(entries.map((entry) => entry.action)).toEqual([
      "key_date.added",
      "key_date.edited",
      "key_date.removed",
    ]);
    expect(entries[2]!.payload).toMatchObject({ label: "Second label", date: "2099-06-02" });
  });

  it("lets a reached Contributor read but refuses every mutation without revealing other Matters", async () => {
    const reached = await newMatter("Reached by Contributor", { contributor: true });
    const hidden = await newMatter("Hidden from Contributor", { confidential: true });
    const reachedDate = await add(reached.number, "2099-07-01", "Visible date");
    const hiddenDate = await add(hidden.number, "2099-07-02", "Hidden date");

    expect((await list(reached.number, contributorCookies))[0]!.label).toBe("Visible date");
    for (const request of [
      {
        method: "POST" as const,
        url: `/api/v1/matters/${reached.number}/key-dates`,
        payload: { date: "2099-08-01", label: "No" },
      },
      {
        method: "PATCH" as const,
        url: `/api/v1/matter-key-dates/${reachedDate.keyDateId}`,
        payload: { label: "No" },
      },
      { method: "DELETE" as const, url: `/api/v1/matter-key-dates/${reachedDate.keyDateId}` },
    ]) {
      const response = await harness.app.inject({ ...request, cookies: contributorCookies });
      expect(response.statusCode, response.body).toBe(403);
    }

    const unknown = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters/999999/key-dates",
      cookies: contributorCookies,
    });
    const unreachable = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${hidden.number}/key-dates`,
      cookies: contributorCookies,
    });
    expect(unknown.statusCode).toBe(unreachable.statusCode);
    expect(unknown.json().detail).toBe(unreachable.json().detail);

    for (const keyDateId of [hiddenDate.keyDateId, "00000000-0000-0000-0000-000000000000"]) {
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/matter-key-dates/${keyDateId}`,
        cookies: outsiderCookies,
        payload: { label: "No" },
      });
      expect(response.statusCode, response.body).toBe(404);
    }
  });

  it("keeps closed Matters writable but inactive, restores the future on reopen, and freezes only archive", async () => {
    const matter = await newMatter("Lifecycle dates", { closed: true });
    const created = await add(matter.number, "2099-09-01", "Still retained");
    expect((await list(matter.number))[0]).toMatchObject({
      label: "Still retained",
      isNext: false,
    });

    const reopen = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matters/${matter.number}`,
      cookies: memberCookies,
      payload: { statusId: openStatusId },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(reopen.json().matter.nextDeadline).toEqual({
      date: "2099-09-01",
      label: "Still retained",
    });
    expect((await list(matter.number))[0]).toMatchObject({ label: "Still retained", isNext: true });

    const close = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matters/${matter.number}`,
      cookies: memberCookies,
      payload: { statusId: closedStatusId },
    });
    expect(close.statusCode, close.body).toBe(200);
    expect(close.json().matter.nextDeadline).toBeNull();

    const reopenAgain = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matters/${matter.number}`,
      cookies: memberCookies,
      payload: { statusId: openStatusId },
    });
    expect(reopenAgain.statusCode, reopenAgain.body).toBe(200);
    expect(reopenAgain.json().matter.nextDeadline).toEqual({
      date: "2099-09-01",
      label: "Still retained",
    });

    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/archive`,
      cookies: memberCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);
    expect(archive.json().matter.nextDeadline).toBeNull();
    expect((await list(matter.number))[0]).toMatchObject({
      label: "Still retained",
      isNext: false,
    });

    const restore = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/restore`,
      cookies: memberCookies,
    });
    expect(restore.statusCode, restore.body).toBe(200);
    expect(restore.json().matter.nextDeadline).toEqual({
      date: "2099-09-01",
      label: "Still retained",
    });

    const archiveAgain = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/archive`,
      cookies: memberCookies,
    });
    expect(archiveAgain.statusCode, archiveAgain.body).toBe(200);
    for (const request of [
      {
        method: "POST" as const,
        url: `/api/v1/matters/${matter.number}/key-dates`,
        payload: { date: "2099-10-01", label: "No" },
      },
      {
        method: "PATCH" as const,
        url: `/api/v1/matter-key-dates/${created.keyDateId}`,
        payload: { label: "No" },
      },
      { method: "DELETE" as const, url: `/api/v1/matter-key-dates/${created.keyDateId}` },
    ]) {
      const response = await harness.app.inject({ ...request, cookies: memberCookies });
      expect(response.statusCode, response.body).toBe(409);
    }
  });
});
