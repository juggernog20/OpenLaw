// SPDX-License-Identifier: AGPL-3.0-only
import { submitRequestFixture } from "../../testing/request-form.js";

import { requestDepartment } from "../../testing/request-department.js";

import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, requestTypes } from "@openlaw/db";
import {
  dispositionScaffold,
  MEMBER,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";
import { StaffRequestSchema } from "./projection.js";

let harness: TestHarness;
let requestDepartmentId: string;
let cast: DispositionScaffold;
let typeId: string;
beforeAll(async () => {
  harness = await startHarness();
  requestDepartmentId = await requestDepartment(harness.db);
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
  const res = await submitRequestFixture(harness, {
    method: "POST",
    url: "/api/v1/requests",
    cookies: cast.requesterCookies,
    payload: {
      departmentId: requestDepartmentId,
      requestTypeId: typeId,
      title: "Review this NDA",
      description: "Review the proposed NDA.",
      urgency: "medium",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const request = StaffRequestSchema.pick({
    id: true,
    number: true,
    status: true,
    title: true,
  }).parse(res.json().request);
  expect(request.id).not.toBe("");
  expect(request.number).toBeGreaterThan(0);
  expect(request).toMatchObject({ status: "new", title: "Review this NDA" });
  return request;
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
it("projects the triage owner's name on both requester reads and clears it with assignment", async () => {
  const request = await submit();
  expect((await detail(request.number, true)).owner).toBeNull();
  const assigned = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${request.number}/assignee`,
    cookies: cast.memberCookies,
    payload: { assigneeId: cast.memberId },
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect((await detail(request.number, true)).owner).toEqual({ displayName: MEMBER.displayName });
  const list = await harness.app.inject({
    method: "GET",
    url: "/api/v1/portal/requests",
    cookies: cast.requesterCookies,
  });
  expect(list.statusCode, list.body).toBe(200);
  const row = list.json().requests.find((row: { id: string }) => row.id === request.id);
  expect(row.owner).toEqual({ displayName: MEMBER.displayName });
  for (const response of [row, await detail(request.number), await detail(request.number, true)]) {
    expect(response).not.toHaveProperty("expectedBy");
    expect(response).not.toHaveProperty("suggestedExpectedBy");
    expect(response).not.toHaveProperty("estimatePassed");
  }
  const cleared = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${request.number}/assignee`,
    cookies: cast.memberCookies,
    payload: { assigneeId: null },
  });
  expect(cleared.statusCode, cleared.body).toBe(200);
  expect((await detail(request.number, true)).owner).toBeNull();
  const hidden = await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/requests/${request.number}`,
    cookies: cast.contributorCookies,
  });
  expect(hidden.statusCode).toBe(404);
  const retired = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${request.number}/expected-by`,
    cookies: cast.memberCookies,
    payload: { expectedBy: "2026-10-01" },
  });
  expect(retired.statusCode).toBe(404);
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

it.each(["contract", "matter"] as const)(
  "moves a converted %s out of Your Requests and redirects its address",
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
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: cast.requesterCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().redirectTo.module).toBe(module);
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/requests",
      cookies: cast.requesterCookies,
    });
    expect(list.json().requests.some((row: { id: string }) => row.id === request.id)).toBe(false);
  },
);
