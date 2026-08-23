// SPDX-License-Identifier: AGPL-3.0-only

/** M23/7: deliberate Matter Closing over the ordinary Status transition. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  eq,
  matterKeyDates,
  matters,
  matterTeam,
  notifications,
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
  email: "matter-closing-member@example.com",
  displayName: "Morgan Closing",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-closing-contributor@example.com",
  displayName: "Casey Closing",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let memberId = "";
let contributorId = "";
let matterTypeId = "";
let closedStatusId = "";
let reopenedStatusId = "";

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
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture === MEMBER) memberId = person.id;
    if (fixture === CONTRIBUTOR) contributorId = person.id;
  }
  [adminCookies, memberCookies, contributorCookies] = await Promise.all([
    signInCookies(harness.app, ADMIN.email, ADMIN.password),
    signInCookies(harness.app, MEMBER.email, MEMBER.password),
    signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password),
  ]);
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: memberCookies,
  });
  matterTypeId = options.json().matterTypes[0].id;
  closedStatusId = await createStatus("Concluded", "closed");
  reopenedStatusId = await createStatus("Follow-up", "open");
});

afterAll(async () => harness.stop());

async function createStatus(displayName: string, category: "open" | "closed") {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-statuses",
    cookies: adminCookies,
    payload: { displayName, category },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matterStatus.id as string;
}

async function createMatter(title: string, extra: Record<string, unknown> = {}) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: memberCookies,
    payload: { title, matterTypeId, managerId: memberId, ...extra },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().matter as {
    id: string;
    number: number;
    openedAt: string;
    closedAt: string | null;
  };
}

const patch = (number: number, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/matters/${number}`,
    cookies: memberCookies,
    payload,
  });

describe("Matter Closing", () => {
  it("offers the opposite live Category and advises on reachable and Restricted open children", async () => {
    const parent = await createMatter("Umbrella investigation");
    const reachable = await createMatter("Local proceeding", {
      parentMatterNumber: parent.number,
    });
    const closedChild = await createMatter("Finished workstream", {
      parentMatterNumber: parent.number,
    });
    expect((await patch(closedChild.number, { statusId: closedStatusId })).statusCode).toBe(200);

    const restrictedResponse = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matters",
      cookies: adminCookies,
      payload: {
        title: "Executive workstream",
        matterTypeId,
        isConfidential: true,
        parentMatterNumber: parent.number,
      },
    });
    expect(restrictedResponse.statusCode, restrictedResponse.body).toBe(201);

    const advisory = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${parent.number}/lifecycle`,
      cookies: memberCookies,
    });
    expect(advisory.statusCode, advisory.body).toBe(200);
    expect(advisory.json()).toMatchObject({
      action: "close",
      targetCategory: "closed",
      statuses: expect.arrayContaining([
        expect.objectContaining({ id: closedStatusId, displayName: "Concluded" }),
      ]),
      openChildren: [
        { restricted: false, number: reachable.number, title: "Local proceeding" },
        { restricted: true },
      ],
    });
    expect(JSON.stringify(advisory.json())).not.toContain("Executive workstream");
    expect(
      advisory
        .json()
        .openChildren.filter((child: { restricted: boolean }) => child.restricted)
        .every((child: object) => Object.keys(child).join(",") === "restricted"),
    ).toBe(true);

    await harness.db
      .insert(matterTeam)
      .values({ matterId: parent.id, userId: contributorId, role: "contributor" });
    const refused = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${parent.number}/lifecycle`,
      cookies: contributorCookies,
    });
    expect(refused.statusCode).toBe(403);
  });

  it("closes and reopens through ordinary Status transitions without cascading", async () => {
    const parent = await createMatter("Signal parent");
    const child = await createMatter("Independent child", {
      parentMatterNumber: parent.number,
      priority: "critical",
      isConfidential: true,
    });
    const beforeChild = await harness.db.query.matters.findFirst({
      where: eq(matters.id, child.id),
    });
    const beforeNotifications = await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, parent.id));

    const close = await patch(parent.number, { statusId: closedStatusId });
    expect(close.statusCode, close.body).toBe(200);
    expect(close.json().matter).toMatchObject({
      openedAt: parent.openedAt,
      statusCategory: "closed",
    });
    expect(close.json().matter.closedAt).toEqual(expect.any(String));
    expect(await harness.db.query.matters.findFirst({ where: eq(matters.id, child.id) })).toEqual(
      beforeChild,
    );
    expect(
      await harness.db.select().from(notifications).where(eq(notifications.entityId, parent.id)),
    ).toEqual(beforeNotifications);

    const defaultList = await harness.app.inject({
      method: "GET",
      url: "/api/v1/matters",
      cookies: memberCookies,
    });
    expect(defaultList.json().matters.some((row: { id: string }) => row.id === parent.id)).toBe(
      false,
    );
    const closedList = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters?includeClosed=true&status=${closedStatusId}`,
      cookies: memberCookies,
    });
    expect(closedList.json().matters.some((row: { id: string }) => row.id === parent.id)).toBe(
      true,
    );

    const lifecycle = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${parent.number}/lifecycle`,
      cookies: memberCookies,
    });
    expect(lifecycle.json()).toMatchObject({
      action: "reopen",
      targetCategory: "open",
      openChildren: [],
      statuses: expect.arrayContaining([expect.objectContaining({ id: reopenedStatusId })]),
    });
    const reopen = await patch(parent.number, { statusId: reopenedStatusId });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(reopen.json().matter).toMatchObject({
      openedAt: parent.openedAt,
      closedAt: null,
      statusCategory: "open",
    });

    const transitions = await harness.db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.entityId, parent.id));
    expect(
      transitions.filter((row) => "fromCategory" in row.payload).map((row) => row.payload),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "Open",
          to: "Concluded",
          fromCategory: "open",
          toCategory: "closed",
        }),
        expect.objectContaining({
          from: "Concluded",
          to: "Follow-up",
          fromCategory: "closed",
          toCategory: "open",
        }),
      ]),
    );
  });

  it("keeps late Matter work writable while suppressing its active deadline", async () => {
    const matter = await createMatter("Late work");
    const future = "2099-09-20";
    const keyDate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/key-dates`,
      cookies: memberCookies,
      payload: { date: future, label: "Response due" },
    });
    expect(keyDate.statusCode, keyDate.body).toBe(201);
    expect((await patch(matter.number, { statusId: closedStatusId })).statusCode).toBe(200);

    const fieldWrite = await patch(matter.number, { description: "Closing papers arrived." });
    const commentWrite = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: memberCookies,
      payload: {
        entityType: "matter",
        entityId: matter.id,
        body: "Filed after Closing.",
        visibility: "working_team",
      },
    });
    const lateDate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/key-dates`,
      cookies: memberCookies,
      payload: { date: "2099-09-21", label: "Late follow-up" },
    });
    const related = await createMatter("Late related Matter");
    const relationWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/relations`,
      cookies: memberCookies,
      payload: { relatedMatterNumber: related.number },
    });
    const BOUNDARY = "openlaw-closing-paper";
    const documentWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/documents`,
      cookies: memberCookies,
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      payload: Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n` +
          `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="closing.pdf"\r\ncontent-type: application/pdf\r\n\r\n%PDF-1.7 late\r\n` +
          `--${BOUNDARY}--\r\n`,
      ),
    });
    for (const response of [fieldWrite, commentWrite, lateDate, relationWrite, documentWrite]) {
      expect(response.statusCode, response.body).toBeLessThan(300);
    }

    const record = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}`,
      cookies: memberCookies,
    });
    expect(record.json().matter.nextDeadline).toBeNull();
    const retained = await harness.db
      .select()
      .from(matterKeyDates)
      .where(eq(matterKeyDates.matterId, matter.id));
    expect(retained).toHaveLength(2);

    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matters/${matter.number}/archive`,
      cookies: memberCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);
    const frozen = await patch(matter.number, { description: "Must not land" });
    expect(frozen.statusCode).toBe(409);
  });
});
