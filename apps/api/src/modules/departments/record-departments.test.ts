// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { departments, eq, requests } from "@openlaw/db";
import { dispositionScaffold, type DispositionScaffold } from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let finance: string;
let sales: string;
beforeAll(async () => {
  harness = await startHarness();
  expect(
    (await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  cast = await dispositionScaffold(harness);
  for (const name of ["Finance", "Sales"]) {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/departments",
      cookies: cast.adminCookies,
      payload: { displayName: name },
    });
    expect(response.statusCode, response.body).toBe(201);
    if (name === "Finance") finance = response.json().department.id;
    else sales = response.json().department.id;
  }
});
afterAll(async () => harness?.stop());

it.each(["matter", "contract"] as const)(
  "carries the Request Department into a %s and allows independent record changes",
  async (module) => {
    const typeResponse = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}-types`,
      cookies: cast.adminCookies,
      payload: { displayName: `Department ${module}` },
    });
    expect(typeResponse.statusCode, typeResponse.body).toBe(201);
    const typeId = typeResponse.json()[`${module}Type`].id;
    const form = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: cast.adminCookies,
      payload: { displayName: `Department intake ${module}` },
    });
    const formId = form.json().requestType.id;
    const submission = await harness.app.inject({
      method: "POST",
      url: "/api/v1/requests",
      cookies: cast.requesterCookies,
      payload: {
        requestTypeId: formId,
        title: "Department ownership",
        description: "Please review",
        urgency: "medium",
        departmentId: finance,
      },
    });
    expect(submission.statusCode, submission.body).toBe(201);
    const request = submission.json().request;
    expect(request).toMatchObject({ departmentId: finance, department: "Finance" });
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: cast.memberCookies,
    });
    expect(read.json().request).toMatchObject({ departmentId: finance, department: "Finance" });
    const portal = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: cast.requesterCookies,
    });
    expect(portal.json().request.department).toBe("Finance");
    const forbidden = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/requests/${request.number}/department`,
      cookies: cast.requesterCookies,
      payload: { departmentId: sales },
    });
    expect(forbidden.statusCode).toBe(403);
    const changed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/requests/${request.number}/department`,
      cookies: cast.memberCookies,
      payload: { departmentId: sales },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual({ departmentId: sales, department: "Sales" });
    const converted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/convert`,
      cookies: cast.memberCookies,
      payload: { title: "Department record", [`${module}TypeId`]: typeId },
    });
    expect(converted.statusCode, converted.body).toBe(200);
    const [stored] = await harness.db.select().from(requests).where(eq(requests.id, request.id));
    const reference = converted.json().request.convertedRecord;
    expect(reference).toBeTruthy();
    const url = `/api/v1/${module}s/${reference.number}`;
    const record = await harness.app.inject({ method: "GET", url, cookies: cast.memberCookies });
    const idKey = module === "matter" ? "departmentId" : "owningDepartmentId";
    const nameKey = module === "matter" ? "department" : "owningDepartment";
    expect(record.json()[module][idKey]).toBe(sales);
    const updated = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: cast.memberCookies,
      payload: { [idKey]: finance },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()[module][nameKey]).toBe("Finance");
    expect(stored!.departmentId).toBe(sales);
    const tooLate = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/requests/${request.number}/department`,
      cookies: cast.memberCookies,
      payload: { departmentId: null },
    });
    expect(tooLate.statusCode).toBe(409);
    const badId = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: cast.memberCookies,
      payload: { [idKey]: "missing-department" },
    });
    expect(badId.statusCode).toBe(400);
    const cleared = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: cast.memberCookies,
      payload: { [idKey]: null },
    });
    expect(cleared.json()[module][idKey]).toBeNull();
  },
);

it("retains an archived Department on Matters while excluding it from new selections", async () => {
  const type = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: cast.adminCookies,
    payload: { displayName: "Archived Department" },
  });
  const typeId = type.json().matterType.id;
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: cast.memberCookies,
    payload: { title: "Historical Department", matterTypeId: typeId, departmentId: finance },
  });
  expect(created.statusCode, created.body).toBe(201);
  await harness.db
    .update(departments)
    .set({ archivedAt: new Date() })
    .where(eq(departments.id, finance));
  const read = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matters/${created.json().matter.number}`,
    cookies: cast.memberCookies,
  });
  expect(read.json().matter).toMatchObject({ departmentId: finance, department: "Finance" });
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: cast.memberCookies,
  });
  expect(options.json().departments.map((row: { id: string }) => row.id)).not.toContain(finance);
  const refused = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: cast.memberCookies,
    payload: { title: "New assignment", matterTypeId: typeId, departmentId: finance },
  });
  expect(refused.statusCode).toBe(400);
});
