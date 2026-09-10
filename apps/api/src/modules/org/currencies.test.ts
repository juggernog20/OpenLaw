// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { coerceCustomFieldValue, type AttachedCustomField } from "../../lib/custom-fields.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const details = {
    email: "currency-member@example.com",
    displayName: "Member",
    password: "correct-horse-battery",
  };
  const user = await provisionUser(harness.app.auth, details);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
  member = await signInCookies(harness.app, details.email, details.password);
});
afterAll(async () => {
  await harness.stop();
});
const add = (code: string, cookies = admin) =>
  harness.app.inject({ method: "POST", url: "/api/v1/org/currencies", cookies, payload: { code } });

describe("currencies in use", () => {
  it("allows authenticated readers but restricts changes to administrators", async () => {
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/org/currencies" })).statusCode,
    ).toBe(401);
    const read = await harness.app.inject({
      method: "GET",
      url: "/api/v1/org/currencies",
      cookies: member,
    });
    expect(read.json()).toEqual({ currencies: [], canManage: false });
    expect((await add("USD", member)).statusCode).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: "DELETE",
          url: "/api/v1/org/currencies/USD",
          cookies: member,
        })
      ).statusCode,
    ).toBe(403);
  });
  it("normalizes codes, refuses invalid codes, and preserves concurrent additions without duplicate audit events", async () => {
    expect((await add("ZZZ")).statusCode).toBe(400);
    await Promise.all([add("usd"), add("EUR"), add("USD")]);
    const read = await harness.app.inject({
      method: "GET",
      url: "/api/v1/org/currencies",
      cookies: admin,
    });
    expect(read.json()).toEqual({ currencies: ["EUR", "USD"], canManage: true });
    const events = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "org_settings.updated"));
    const currencyEvents = events.filter(
      (row) => (row.payload as { field?: string }).field === "currenciesInUse",
    );
    expect(currencyEvents).toHaveLength(2);
    expect(currencyEvents.every((row) => row.visibility === "admin_only")).toBe(true);
  });
  it("removes a currency from choices without changing saved amounts or codes", async () => {
    const types = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/types",
      cookies: admin,
    });
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entities",
      cookies: admin,
      payload: { legalName: "Currency Test Ltd", entityTypeId: types.json().entityTypes[0].id },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().entity.id;
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${id}`,
      cookies: admin,
      payload: { parValue: 123, parValueCurrency: "USD" },
    });
    const removed = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/org/currencies/USD",
      cookies: admin,
    });
    expect(removed.json().currencies).toEqual(["EUR"]);
    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${id}`,
      cookies: admin,
    });
    expect(read.json().entity).toMatchObject({ parValue: 123, parValueCurrency: "USD" });
  });
  it("validates dedicated currency custom fields independently of their former option lists", () => {
    const field: AttachedCustomField = {
      fieldId: "budget",
      slug: "budget_currency",
      displayName: "Budget currency",
      description: null,
      fieldType: "currency",
      fieldTag: "business",
      options: null,
      displayOrder: 1,
      isRequired: false,
    };
    expect(coerceCustomFieldValue(field, " aed ")).toBe("AED");
    expect(coerceCustomFieldValue(field, "")).toBeNull();
    expect(() => coerceCustomFieldValue(field, "ZZZ")).toThrow("choose a valid currency");
  });
});
