// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, asc, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
let personId: string;
beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const credentials = {
    email: "departments@example.com",
    displayName: "Department Member",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(harness.app.auth, credentials);
  personId = person.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, personId));
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  member = await signInCookies(harness.app, credentials.email, credentials.password);
});
afterAll(async () => harness?.stop());

it("keeps Department management Administrator-only and offers live names to Members", async () => {
  for (const method of ["GET", "POST"] as const) {
    const result = await harness.app.inject({
      method,
      url: "/api/v1/departments",
      cookies: member,
      ...(method === "POST" ? { payload: { displayName: "Forbidden" } } : {}),
    });
    expect(result.statusCode, result.body).toBe(403);
  }
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/departments/options",
    cookies: member,
  });
  expect(options.statusCode, options.body).toBe(200);
  expect(options.json()).toEqual({ departments: [] });
});

it("renames and orders Departments, preserves archived references, and audits user assignment", async () => {
  async function create(displayName: string) {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/departments",
      cookies: admin,
      payload: { displayName },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().department as { id: string; slug: string };
  }
  const sales = await create("Sales");
  const legal = await create("Legal");
  const renamed = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/departments/${sales.id}`,
    cookies: admin,
    payload: { displayName: "Sales operations" },
  });
  expect(renamed.statusCode, renamed.body).toBe(200);
  expect(renamed.json().department.slug).toBe(sales.slug);
  const order = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/departments/order",
    cookies: admin,
    payload: { ids: [legal.id, sales.id] },
  });
  expect(order.statusCode, order.body).toBe(200);
  expect(order.json().departments.map((d: { id: string }) => d.id)).toEqual([legal.id, sales.id]);

  const assign = (departmentId: string | null, cookies = admin) =>
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${personId}/department`,
      cookies,
      payload: { departmentId },
    });
  expect((await assign(sales.id, member)).statusCode).toBe(403);
  const assigned = await assign(sales.id);
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.json().user.departmentId).toBe(sales.id);

  const choices = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: member,
  });
  expect(choices.statusCode, choices.body).toBe(200);
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: member,
    payload: {
      title: "Department Contract",
      contractTypeId: choices.json().contractTypes[0].id,
      owningDepartmentId: sales.id,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract;
  expect(contract).toMatchObject({
    owningDepartmentId: sales.id,
    owningDepartment: "Sales operations",
  });

  const archived = await harness.app.inject({
    method: "POST",
    url: `/api/v1/departments/${sales.id}/archive`,
    cookies: admin,
    payload: {},
  });
  expect(archived.statusCode, archived.body).toBe(200);
  expect(archived.json().department.inUseCount).toBe(2);
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/departments/options",
    cookies: member,
  });
  expect(options.json().departments.map((d: { id: string }) => d.id)).toEqual([legal.id]);
  // A Department keeps its references, so the reassignment target the rest
  // of the taxonomy asks for is refused rather than quietly ignored.
  const reassigned = await harness.app.inject({
    method: "POST",
    url: `/api/v1/departments/${legal.id}/archive`,
    cookies: admin,
    payload: { reassignToId: sales.id },
  });
  expect(reassigned.statusCode, reassigned.body).toBe(400);
  const read = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${contract.number}`,
    cookies: member,
  });
  expect(read.json().contract).toMatchObject({
    owningDepartmentId: sales.id,
    owningDepartment: "Sales operations",
  });
  const people = await harness.app.inject({ method: "GET", url: "/api/v1/users", cookies: admin });
  expect(people.json().users.find((u: { id: string }) => u.id === personId).departmentId).toBe(
    sales.id,
  );
  expect(
    (
      await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/departments/${sales.id}`,
        cookies: admin,
      })
    ).statusCode,
  ).toBe(409);

  const patch = (owningDepartmentId: string | null) =>
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: member,
      payload: { owningDepartmentId },
    });
  expect((await patch(legal.id)).statusCode).toBe(200);
  expect((await patch(sales.id)).statusCode).toBe(400);
  expect((await patch("missing")).statusCode).toBe(400);
  expect((await patch(null)).json().contract.owningDepartment).toBeNull();
  expect((await assign(legal.id)).statusCode).toBe(200);
  expect((await assign(sales.id)).statusCode).toBe(400);
  expect((await assign("missing")).statusCode).toBe(400);
  expect((await assign(null)).json().user.departmentId).toBeNull();
  const restored = await harness.app.inject({
    method: "POST",
    url: `/api/v1/departments/${sales.id}/restore`,
    cookies: admin,
  });
  expect(restored.statusCode, restored.body).toBe(200);
  expect((await assign(sales.id)).statusCode).toBe(200);

  const audit = await harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "user.department_set"))
    .orderBy(asc(activityLog.createdAt));
  expect(audit.map((row) => ({ visibility: row.visibility, payload: row.payload }))).toEqual([
    {
      visibility: "admin_only",
      payload: {
        email: "departments@example.com",
        from: null,
        to: "Sales operations",
        fromId: null,
        toId: sales.id,
      },
    },
    {
      visibility: "admin_only",
      payload: {
        email: "departments@example.com",
        from: "Sales operations",
        to: "Legal",
        fromId: sales.id,
        toId: legal.id,
      },
    },
    {
      visibility: "admin_only",
      payload: {
        email: "departments@example.com",
        from: "Legal",
        to: null,
        fromId: legal.id,
        toId: null,
      },
    },
    {
      visibility: "admin_only",
      payload: {
        email: "departments@example.com",
        from: null,
        to: "Sales operations",
        fromId: null,
        toId: sales.id,
      },
    },
  ]);
});
