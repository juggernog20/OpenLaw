// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { contractTasks, eq, matterTasks, orgSettings, requests, requestTypes } from "@openlaw/db";
import {
  dispositionScaffold,
  MEMBER,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";
import { StaffRequestSchema } from "./projection.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let typeId: string;
beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cast = await dispositionScaffold(harness);
  const [type] = await harness.db
    .select()
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"));
  typeId = type!.id;
});
afterAll(async () => {
  await harness.stop();
});
async function submit() {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: cast.requesterCookies,
    payload: {
      requestTypeId: typeId,
      summary: "Estimate this review",
      description: "Review the proposed NDA.",
      urgency: "medium",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const request = StaffRequestSchema.pick({
    id: true,
    number: true,
    status: true,
    summary: true,
  }).parse(res.json().request);
  expect(request.id).not.toBe("");
  expect(request.number).toBeGreaterThan(0);
  expect(request).toMatchObject({ status: "new", summary: "Estimate this review" });
  return request;
}
function estimate(number: number, expectedBy: unknown, cookies = cast.memberCookies) {
  return harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${number}/expected-by`,
    cookies,
    payload: { expectedBy },
  });
}
async function detail(number: number, portal = false) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/${portal ? "portal/" : ""}requests/${number}`,
    cookies: portal ? cast.requesterCookies : cast.memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().request;
}
it("offers an org-timezone calendar-day suggestion without writing or clamping the estimate", async () => {
  const request = await submit();
  await harness.db.update(orgSettings).set({ defaultTimezone: "America/Los_Angeles" });
  await harness.db
    .update(requestTypes)
    .set({ turnaroundDays: 2 })
    .where(eq(requestTypes.id, typeId));
  await harness.db
    .update(requests)
    .set({ createdAt: new Date("2026-03-08T07:30:00Z"), customFields: { needed_by: "2026-03-08" } })
    .where(eq(requests.id, request.id));
  expect(await detail(request.number)).toMatchObject({
    expectedBy: null,
    suggestedExpectedBy: "2026-03-09",
    customFields: { needed_by: "2026-03-08" },
  });
  expect((await estimate(request.number, "2026-03-09")).statusCode).toBe(200);
  await harness.db
    .update(requestTypes)
    .set({ turnaroundDays: 5 })
    .where(eq(requestTypes.id, typeId));
  expect(await detail(request.number)).toMatchObject({
    expectedBy: "2026-03-09",
    suggestedExpectedBy: "2026-03-12",
  });
  expect((await estimate(request.number, null)).statusCode).toBe(200);
  expect((await detail(request.number)).expectedBy).toBeNull();
});
it("projects the triage owner but ignores legacy estimates on both requester reads", async () => {
  const request = await submit();
  expect(await detail(request.number, true)).toMatchObject({
    owner: null,
    nextDeadline: null,
    deadlinePassed: false,
  });
  await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${request.number}/assignee`,
    cookies: cast.memberCookies,
    payload: { assigneeId: cast.memberId },
  });
  await estimate(request.number, "2000-01-01");
  expect(await detail(request.number, true)).toMatchObject({
    owner: { displayName: MEMBER.displayName },
    nextDeadline: null,
    deadlinePassed: false,
  });
  const list = await harness.app.inject({
    method: "GET",
    url: "/api/v1/portal/requests",
    cookies: cast.requesterCookies,
  });
  const row = list.json().requests.find((row: { id: string }) => row.id === request.id);
  expect(row.owner).toEqual({ displayName: MEMBER.displayName });
  expect(row).toMatchObject({ nextDeadline: null, deadlinePassed: false });
  await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${request.number}/assignee`,
    cookies: cast.memberCookies,
    payload: { assigneeId: null },
  });
  expect((await detail(request.number, true)).owner).toBeNull();
  for (const status of ["resolved", "declined"] as const) {
    await harness.db.update(requests).set({ status }).where(eq(requests.id, request.id));
    expect(await detail(request.number, true)).toMatchObject({
      nextDeadline: null,
      deadlinePassed: false,
    });
  }
});
it("restricts writes to Member+, validates real dates and preserves the requester's read boundary", async () => {
  const request = await submit();
  for (const cookies of [cast.requesterCookies, cast.contributorCookies, {}]) {
    expect((await estimate(request.number, "2026-10-01", cookies)).statusCode).toBe(
      Object.keys(cookies).length ? 403 : 401,
    );
  }
  for (const value of ["2026-02-30", "tomorrow", "2026-01-01T00:00:00Z", 3])
    expect((await estimate(request.number, value)).statusCode).toBe(400);
  expect((await estimate(request.number, "2026-10-01", cast.adminCookies)).statusCode).toBe(200);
  const hidden = await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/requests/${request.number}`,
    cookies: cast.contributorCookies,
  });
  expect(hidden.statusCode).toBe(404);
  await harness.db
    .update(requests)
    .set({ archivedAt: new Date() })
    .where(eq(requests.id, request.id));
  expect((await estimate(request.number, null)).statusCode).toBe(404);
  expect((await estimate(999999, null)).statusCode).toBe(404);
});
it("accepts nullable whole-day turnaround settings and refuses invalid values", async () => {
  for (const turnaroundDays of [0, 3, 36_500, null]) {
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${typeId}`,
      cookies: cast.adminCookies,
      payload: { turnaroundDays },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType.turnaroundDays).toBe(turnaroundDays);
    const published = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/request-types",
      cookies: cast.requesterCookies,
    });
    expect(
      published.json().requestTypes.find((row: { id: string }) => row.id === typeId).turnaroundDays,
    ).toBe(turnaroundDays);
  }
  for (const turnaroundDays of [-1, 1.5, "3", 36_501])
    expect(
      (
        await harness.app.inject({
          method: "PATCH",
          url: `/api/v1/request-types/${typeId}`,
          cookies: cast.adminCookies,
          payload: { turnaroundDays },
        })
      ).statusCode,
    ).toBe(400);
});

it("audits a changed estimate once, preserves it through conversion, and refuses closed edits", async () => {
  const request = await submit();
  for (let i = 0; i < 2; i++)
    expect((await estimate(request.number, "2026-10-15")).statusCode).toBe(200);
  const feed = await harness.app.inject({
    method: "GET",
    url: "/api/v1/audit-log",
    cookies: cast.adminCookies,
    query: { entityType: "request", action: "request.expected_by_changed" },
  });
  expect(feed.statusCode, feed.body).toBe(200);
  expect(feed.headers["content-type"]).toContain("application/json");
  const estimates = feed
    .json()
    .entries.filter((row: { entityId: string }) => row.entityId === request.id);
  expect(estimates).toHaveLength(1);
  expect(estimates[0]).toMatchObject({
    action: "request.expected_by_changed",
    visibility: "working_team",
    payload: { number: request.number, from: null, to: "2026-10-15" },
  });
  const converted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${request.number}/convert`,
    cookies: cast.memberCookies,
    payload: { title: "Estimated NDA review" },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const convertedRequest = StaffRequestSchema.parse(converted.json().request);
  expect(convertedRequest).toMatchObject({
    id: request.id,
    number: request.number,
    status: "converted",
    expectedBy: "2026-10-15",
  });
  expect(convertedRequest.convertedContract?.number).toBeGreaterThan(0);
  expect(await detail(request.number, true)).toMatchObject({
    status: "converted",
    nextDeadline: null,
  });
  expect((await estimate(request.number, "2026-10-16")).statusCode).toBe(200);
  for (const status of ["resolved", "declined"] as const) {
    await harness.db.update(requests).set({ status }).where(eq(requests.id, request.id));
    expect((await estimate(request.number, null)).statusCode).toBe(409);
    expect((await detail(request.number)).expectedBy).toBe("2026-10-16");
  }
});

it.each(["contract", "matter"] as const)(
  "moves a converted %s out of Your Requests without exposing Task deadlines",
  async (module) => {
    const request = await submit();
    let matterTypeId: string | undefined;
    if (module === "matter") {
      const type = await harness.app.inject({
        method: "POST",
        url: "/api/v1/matter-types",
        cookies: cast.adminCookies,
        payload: { displayName: "Portal matter" },
      });
      expect(type.statusCode, type.body).toBe(201);
      matterTypeId = type.json().matterType.id;
    }
    const converted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/convert`,
      cookies: cast.memberCookies,
      payload: { title: "Plan the work", ...(matterTypeId ? { matterTypeId } : {}) },
    });
    expect(converted.statusCode, converted.body).toBe(200);
    const stored = await cast.stored(request.id);
    const recordId = (
      module === "contract" ? stored.convertedContractId : stored.convertedMatterId
    )!;
    if (module === "contract")
      await harness.db.insert(contractTasks).values({
        contractId: recordId,
        title: "Private deadline",
        dueDate: "2000-01-02",
        displayOrder: 0,
      });
    else
      await harness.db.insert(matterTasks).values({
        matterId: recordId,
        title: "Private deadline",
        dueDate: "2000-01-02",
        displayOrder: 0,
      });
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: cast.requesterCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().redirectTo.module).toBe(module);
    expect(response.json().request.nextDeadline).toBeNull();
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/requests",
      cookies: cast.requesterCookies,
    });
    expect(list.json().requests.some((row: { id: string }) => row.id === request.id)).toBe(false);
  },
);
