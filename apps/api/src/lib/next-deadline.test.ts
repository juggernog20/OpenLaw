// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  eq,
  contracts,
  matters,
  contractTasks,
  matterTasks,
  contractKeyDates,
  matterKeyDates,
} from "@openlaw/db";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { civilToday, shiftDays } from "./contract-term.js";

let harness: TestHarness;
let cookies: Record<string, string>;
beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => harness.stop());

describe.each(["matter", "contract"] as const)("%s Next deadline", (module) => {
  it("combines milestones and unfinished Tasks, advances on completion, and excludes archived records", async () => {
    const today = civilToday();
    const dates = {
      past: shiftDays(today, -2),
      soon: shiftDays(today, 2),
      later: shiftDays(today, 8),
    };
    const options = await harness.app.inject({
      method: "GET",
      url: `/api/v1/${module}s/options`,
      cookies,
    });
    const typeId = options.json()[`${module}Types`][0].id;
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s`,
      cookies,
      payload: { title: "Multiple deadlines", [`${module}TypeId`]: typeId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const record = created.json()[module];
    const read = async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/${module}s/${record.number}`,
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()[module]).not.toHaveProperty("dueDate");
      return response.json()[module].nextDeadline;
    };
    expect(await read()).toBeNull();
    const dateValues = [
      { date: dates.past, label: "Past milestone" },
      { date: dates.later, label: "Filing" },
    ];
    const taskValues = [
      { title: "Done", dueDate: shiftDays(today, -3), isDone: true, displayOrder: 0 },
      { title: "Draft response", dueDate: dates.past, isDone: false, displayOrder: 1 },
      { title: "Business review", dueDate: dates.soon, isDone: false, displayOrder: 2 },
      { title: "Undated", dueDate: null, isDone: false, displayOrder: 3 },
    ];
    if (module === "matter") {
      await harness.db
        .insert(matterKeyDates)
        .values(dateValues.map((value) => ({ ...value, matterId: record.id })));
      await harness.db
        .insert(matterTasks)
        .values(taskValues.map((value) => ({ ...value, matterId: record.id })));
    } else {
      await harness.db
        .insert(contractKeyDates)
        .values(dateValues.map((value) => ({ ...value, contractId: record.id })));
      await harness.db
        .insert(contractTasks)
        .values(taskValues.map((value) => ({ ...value, contractId: record.id })));
    }
    expect(await read()).toEqual({ date: dates.past, label: "Draft response", source: "task" });
    const tasks = module === "matter" ? matterTasks : contractTasks;
    await harness.db.update(tasks).set({ isDone: true }).where(eq(tasks.title, "Draft response"));
    expect(await read()).toEqual({ date: dates.soon, label: "Business review", source: "task" });
    await harness.db.update(tasks).set({ isDone: true }).where(eq(tasks.title, "Business review"));
    expect(await read()).toEqual({ date: dates.later, label: "Filing", source: "key_date" });
    if (module === "contract") {
      await harness.db
        .update(contracts)
        .set({ expiryDate: dates.soon })
        .where(eq(contracts.id, record.id));
      expect(await read()).toEqual({ date: dates.soon, label: "Expiry date", source: "key_date" });
      const marker = {
        evidence: "Extracted date",
        runId: "deadline-run",
        writtenAt: new Date().toISOString(),
      };
      await harness.db
        .update(contracts)
        .set({ aiUnverified: { expiry_date: marker } })
        .where(eq(contracts.id, record.id));
      expect(await read()).toMatchObject({ label: "Expiry date", unverified: true });
      await harness.db
        .update(contracts)
        .set({ aiUnverified: { notice_period_days: marker }, noticePeriodDays: 1 })
        .where(eq(contracts.id, record.id));
      expect(await read()).toMatchObject({ label: "Notice deadline", unverified: true });
      await harness.db
        .update(contracts)
        .set({ aiUnverified: null })
        .where(eq(contracts.id, record.id));
      expect(await read()).not.toHaveProperty("unverified");
      const edited = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/contracts/${record.number}`,
        cookies,
        payload: { expiryDate: dates.soon, noticePeriodDays: null },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json().contract.nextDeadline).toMatchObject({
        date: dates.soon,
        label: "Expiry date",
      });
      const archived = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contracts/${record.number}/archive`,
        cookies,
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json().contract.nextDeadline).toBeNull();
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contracts/${record.number}/restore`,
        cookies,
      });
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json().contract.nextDeadline).toMatchObject({
        date: dates.soon,
        label: "Expiry date",
      });
    } else {
      const filtered = await harness.app.inject({
        method: "GET",
        url: `/api/v1/matters?deadlineFrom=${dates.later}&deadlineTo=${dates.later}`,
        cookies,
      });
      expect(filtered.statusCode, filtered.body).toBe(200);
      expect(filtered.json().matters.map((row: { id: string }) => row.id)).toContain(record.id);
    }
    const table = module === "matter" ? matters : contracts;
    await harness.db.update(table).set({ archivedAt: new Date() }).where(eq(table.id, record.id));
    expect(await read()).toBeNull();
  });
});
