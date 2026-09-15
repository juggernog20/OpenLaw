// SPDX-License-Identifier: AGPL-3.0-only

import { requestDepartment } from "../../testing/request-department.js";

/** CTR-026 and NOT-009 at the settings, creation, and notification HTTP seams. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, and, asc, contracts, eq, notifications, users } from "@openlaw/db";
import { createContract } from "../contracts/create.js";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let staff: Record<string, string>;
let portal: Record<string, string>;
let staffId: string;
let portalId: string;
let adminId: string;
let retiredId: string;
let typeId: string;
const password = "correct-horse-battery";
beforeAll(async () => {
  h = await startHarness();
  expect(
    (await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  adminId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  for (const role of ["legal_team_member", "business_user"] as const) {
    const person = await provisionUser(h.app.auth, {
      email: `${role}@defaults.test`,
      displayName: role,
      password,
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    const cookies = await signInCookies(h.app, `${role}@defaults.test`, password);
    if (role === "legal_team_member") {
      staffId = person.id;
      staff = cookies;
    } else {
      portalId = person.id;
      portal = cookies;
    }
  }
  retiredId = (
    await provisionUser(h.app.auth, {
      email: "retired@defaults.test",
      displayName: "Retired",
      password,
    })
  ).id;
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: admin,
    payload: { displayName: "Default people" },
  });
  typeId = created.json().contractType.id;
});
afterAll(async () => {
  await h.stop();
});

const endpoint = () => `/api/v1/contract-types/${typeId}/people`;
async function add(userId: string) {
  const res = await h.app.inject({
    method: "POST",
    url: endpoint(),
    cookies: admin,
    payload: { userId },
  });
  expect(res.statusCode, res.body).toBe(201);
}
async function create(title: string, extra: Record<string, unknown> = {}) {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: admin,
    payload: { title, contractTypeId: typeId, ...extra },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as { id: string; number: number };
}

it("lets only Administrators manage an ordered, deduplicated list of live people", async () => {
  for (const cookies of [staff, portal]) {
    expect((await h.app.inject({ method: "GET", url: endpoint(), cookies })).statusCode).toBe(403);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: endpoint(),
          cookies,
          payload: { userId: staffId },
        })
      ).statusCode,
    ).toBe(403);
  }
  for (const id of [adminId, staffId, portalId, retiredId]) await add(id);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: endpoint(),
        cookies: admin,
        payload: { userId: staffId },
      })
    ).statusCode,
  ).toBe(409);
  const order = [portalId, staffId, retiredId, adminId];
  const res = await h.app.inject({
    method: "PUT",
    url: `${endpoint()}/order`,
    cookies: admin,
    payload: { userIds: order },
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().people.map((p: { id: string }) => p.id)).toEqual(order);
  expect(
    (
      await h.app.inject({
        method: "PUT",
        url: `${endpoint()}/order`,
        cookies: admin,
        payload: { userIds: [staffId, staffId] },
      })
    ).statusCode,
  ).toBe(400);
  // The audit entry names the people: the log has no picker to read an
  // id back from (CTR-026).
  const entries = await h.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "contract_type.updated"))
    .orderBy(asc(activityLog.createdAt));
  const reorder = entries.at(-1)!.payload as {
    changed: { defaultPeople: { from: string[]; to: string[] } };
  };
  expect(reorder.changed.defaultPeople.to).toEqual([
    "business_user",
    "legal_team_member",
    "Retired",
    TEST_ADMIN.displayName,
  ]);
  await h.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, retiredId));
});

it("copies defaults once, skips archived people, grants Confidential reach, and delivers both bells", async () => {
  const born = await create("People at birth", { isConfidential: true });
  const team = await h.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${born.number}`,
    cookies: admin,
  });
  expect(team.statusCode, team.body).toBe(200);
  expect(
    team
      .json()
      .team.map((p: { id: string }) => p.id)
      .sort(),
  ).toEqual([adminId, staffId, portalId].sort());
  expect(
    (await h.app.inject({ method: "GET", url: `/api/v1/contracts/${born.number}`, cookies: staff }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await h.app.inject({
        method: "GET",
        url: `/api/v1/portal/contracts/${born.number}`,
        cookies: portal,
      })
    ).statusCode,
  ).toBe(200);
  for (const [cookies, path] of [
    [staff, "/api/v1/notifications"],
    [portal, "/api/v1/portal/notifications"],
  ] as const) {
    const bell = await h.app.inject({ method: "GET", url: path, cookies });
    expect(bell.statusCode, bell.body).toBe(200);
    expect(bell.body).toContain("contract.team_added");
    expect(bell.body).toContain(born.id);
  }
  const events = await h.db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.entityId, born.id), eq(notifications.eventType, "contract.team_added")),
    );
  expect(events.map((e) => e.userId).sort()).toEqual([staffId, portalId].sort());
  expect(events.every((e) => e.emailOwed)).toBe(true);
  const activity = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, born.id), eq(activityLog.action, "contract.team_added")));
  expect(activity).toHaveLength(2);
  expect(
    (await h.app.inject({ method: "DELETE", url: `${endpoint()}/${staffId}`, cookies: admin }))
      .statusCode,
  ).toBe(200);
  const unchanged = await h.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${born.number}`,
    cookies: admin,
  });
  expect(unchanged.body).toContain(staffId);
  const next = await create("Later defaults");
  const nextTeam = await h.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${next.number}`,
    cookies: admin,
  });
  expect(nextTeam.body).not.toContain(staffId);
  const manual = await h.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${next.number}/team`,
    cookies: admin,
    payload: { userId: staffId },
  });
  expect(manual.statusCode, manual.body).toBe(201);
  const manualEvents = await h.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.entityId, next.id),
        eq(notifications.eventType, "contract.team_added"),
        eq(notifications.userId, staffId),
      ),
    );
  expect(manualEvents).toHaveLength(1);
});

it("copies the current list on Request conversion and both renewal vehicles", async () => {
  await add(staffId);
  const requestType = await h.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies: admin,
    payload: { displayName: "Defaults request" },
  });
  const requestTypeId = requestType.json().requestType.id;
  const targeted = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${requestTypeId}`,
    cookies: admin,
    payload: { targetModule: "contract", targetTypeId: typeId },
  });
  expect(targeted.statusCode, targeted.body).toBe(200);
  const submitted = await h.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: portal,
    payload: {
      requestTypeId,
      departmentId: await requestDepartment(h.db),
      title: "Defaults conversion",
      description: "An NDA",
      urgency: "medium",
    },
  });
  expect(submitted.statusCode, submitted.body).toBe(201);
  const converted = await h.app.inject({
    method: "POST",
    url: `/api/v1/requests/${submitted.json().request.number}/convert`,
    cookies: admin,
    payload: { title: "Converted default people" },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const record = await h.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${converted.json().request.convertedContract.number}`,
    cookies: admin,
  });
  expect(
    record
      .json()
      .team.map((p: { id: string }) => p.id)
      .sort(),
  ).toEqual([adminId, portalId, staffId].sort());
  const events = await h.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.entityId, record.json().contract.id),
        eq(notifications.eventType, "contract.team_added"),
      ),
    );
  // The Requester already has their Business Owner membership before defaults are applied.
  expect(events.map((e) => e.userId)).toEqual([staffId]);
  const predecessor = await create("Renewal predecessor");
  for (const vehicle of ["child", "successor"]) {
    const born = await create(`Default ${vehicle}`, {
      renewalOf: { number: predecessor.number, vehicle },
    });
    const team = await h.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${born.number}`,
      cookies: admin,
    });
    expect(
      team
        .json()
        .team.map((p: { id: string }) => p.id)
        .sort(),
    ).toEqual([adminId, portalId, staffId].sort());
  }
});

it("rolls default memberships, activity, and notification rows back with a failed creation", async () => {
  let contractId = "";
  await expect(
    h.app.notifier.notifying(async (tx) => {
      const born = await createContract(tx, h.app.notifier, {
        actorId: adminId,
        title: "Rolled back defaults",
        contractTypeId: typeId,
      });
      contractId = born.row.id;
      throw new Error("later conversion step failed");
    }),
  ).rejects.toThrow("later conversion step failed");
  expect(await h.db.select().from(contracts).where(eq(contracts.id, contractId))).toHaveLength(0);
  expect(
    await h.db.select().from(notifications).where(eq(notifications.entityId, contractId)),
  ).toHaveLength(0);
  expect(
    await h.db.select().from(activityLog).where(eq(activityLog.entityId, contractId)),
  ).toHaveLength(0);
});

it("delivers team addition email to the Portal and app record links", async () => {
  const born = await create("Team addition email");
  for (const role of ["business_user", "legal_team_member"] as const) {
    const email = `${role}@defaults.test`;
    await expect
      .poll(() => h.mailer.messagesTo(email).find((m) => m.text.includes("Team addition email")), {
        timeout: 20000,
      })
      .toBeDefined();
    const mail = h.mailer.messagesTo(email).find((m) => m.text.includes("Team addition email"))!;
    expect(mail.subject).toContain("You were added");
    expect(mail.text).toContain(
      `${role === "business_user" ? "/portal" : ""}/contracts/${born.number}`,
    );
  }
});

it("notifies a person added through the Portal and honors their group preference", async () => {
  expect(
    (await h.app.inject({ method: "DELETE", url: `${endpoint()}/${staffId}`, cookies: admin }))
      .statusCode,
  ).toBe(200);
  const born = await create("Portal added teammate");
  const added = await h.app.inject({
    method: "POST",
    url: `/api/v1/portal/contracts/${born.number}/team`,
    cookies: portal,
    payload: { userId: staffId },
  });
  expect(added.statusCode, added.body).toBe(201);
  const events = await h.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.entityId, born.id),
        eq(notifications.userId, staffId),
        eq(notifications.eventType, "contract.team_added"),
      ),
    );
  expect(events).toHaveLength(1);
  const preference = await h.app.inject({
    method: "PATCH",
    url: "/api/v1/me/notification-preferences",
    cookies: staff,
    payload: { eventGroup: "assigned_to_you", channel: "in_app", enabled: false },
  });
  expect(preference.statusCode, preference.body).toBe(200);
  const quiet = await create("Muted team additions");
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/contracts/${quiet.number}/team`,
        cookies: admin,
        payload: { userId: staffId },
      })
    ).statusCode,
  ).toBe(201);
  expect(
    await h.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.entityId, quiet.id), eq(notifications.userId, staffId))),
  ).toHaveLength(0);
});

it("refuses archived people and archived Type edits without changing the list", async () => {
  const retiredAdd = await h.app.inject({
    method: "POST",
    url: endpoint(),
    cookies: admin,
    payload: { userId: retiredId },
  });
  expect(retiredAdd.statusCode, retiredAdd.body).toBe(400);
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: admin,
    payload: { displayName: "Retired defaults" },
  });
  const id = made.json().contractType.id;
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/contract-types/${id}/people`,
        cookies: admin,
        payload: { userId: portalId },
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/contract-types/${id}/archive`,
        cookies: admin,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  for (const [method, suffix, payload] of [
    ["POST", "", { userId: staffId }],
    ["PUT", "/order", { userIds: [portalId] }],
    ["DELETE", `/${portalId}`, undefined],
  ] as const) {
    const res = await h.app.inject({
      method,
      url: `/api/v1/contract-types/${id}/people${suffix}`,
      cookies: admin,
      ...(payload ? { payload } : {}),
    });
    expect(res.statusCode, res.body).toBe(409);
  }
  const list = await h.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${id}/people`,
    cookies: admin,
  });
  expect(list.json().people.map((p: { id: string }) => p.id)).toEqual([portalId]);
});

it("revokes a pending invite even when it is a Contract Type default person", async () => {
  const invited = await h.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: admin,
    payload: {
      email: "pending-default@example.com",
      displayName: "Pending default",
      role: "legal_team_member",
    },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const userId = invited.json().user.id;
  await add(userId);
  const revoked = await h.app.inject({
    method: "DELETE",
    url: `/api/v1/auth/invites/${userId}`,
    cookies: admin,
  });
  expect(revoked.statusCode, revoked.body).toBe(204);
  const current = await h.app.inject({ url: endpoint(), cookies: admin });
  expect(current.statusCode).toBe(200);
  expect(current.json().people).not.toContainEqual(expect.objectContaining({ id: userId }));
});
