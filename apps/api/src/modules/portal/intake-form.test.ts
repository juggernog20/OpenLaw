// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  fields,
  contractTypes,
  eq,
  counterparties,
  contracts,
  contractCounterparties,
  users,
} from "@openlaw/db";
import { FORM_BUILTINS, pinnedFormRows, type FormNode } from "@openlaw/shared";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { requestDepartment } from "../../testing/request-department.js";
let h: TestHarness;
let cookies: Record<string, string>;
let departmentId: string;
let requesterCookies: Record<string, string>;
import { provisionUser } from "../../auth/instance.js";
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  departmentId = await requestDepartment(h.db);
  const requester = {
    email: "intake@example.com",
    password: "correct-horse-battery",
    displayName: "Requester",
  };
  const user = await provisionUser(h.app.auth, requester);
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, user.id));
  requesterCookies = await signInCookies(h.app, requester.email, requester.password);
});
afterAll(async () => {
  await h?.stop();
});

it("reads the destination Intake tree, evaluates Required, and labels built-in answers", async () => {
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies,
    payload: { displayName: "Intake NDA" },
  });
  const typeId = made.json().contractType.id;
  const definitions = await h.db
    .insert(fields)
    .values(
      ["Choice", "Conditional answer", "Creation only", "Record only"].map((displayName, i) => ({
        moduleScope: "contract" as const,
        slug: `portal_branch_${i}`,
        displayName,
        fieldType: "text" as const,
        fieldTag: "business" as const,
      })),
    )
    .returning();
  const rows = definitions.map((f, i) => ({
    kind: "row" as const,
    id: f.id,
    rowRef: f.slug,
    fieldType: f.fieldType,
    isRequired: i === 1 || i === 2,
    onIntakeForm: i < 2,
    visibleOnPortal: true,
  }));
  const builtin = Object.entries(FORM_BUILTINS.contract).map(([rowRef, fieldType]) => ({
    kind: "row" as const,
    id: rowRef,
    rowRef,
    fieldType,
    isRequired: false,
    onIntakeForm: rowRef === "effective_date",
    visibleOnPortal: true,
  }));
  const form: FormNode[] = [
    ...pinnedFormRows("contract"),
    rows[0]!,
    {
      kind: "branch",
      id: "conditional",
      match: "all",
      conditions: [{ rowRef: rows[0]!.rowRef, operator: "equals", value: "Yes" }],
      children: [rows[1]!],
    },
    rows[2]!,
    rows[3]!,
    ...builtin,
  ];
  const written = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${typeId}/form`,
    cookies,
    payload: { form },
  });
  expect(written.statusCode, written.body).toBe(200);
  const madeRequest = await h.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies,
    payload: { displayName: "NDA request" },
  });
  const rt = madeRequest.json().requestType;
  const patched = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${rt.id}`,
    cookies,
    payload: { targetModule: "contract", targetTypeId: typeId },
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/portal/request-types/${rt.slug}`,
    cookies: requesterCookies,
  });
  expect(read.statusCode, read.body).toBe(200);
  expect(read.json().form).toEqual([
    rows[0],
    form[3],
    builtin.find((r) => r.rowRef === "effective_date"),
  ]);
  expect(read.json().fields.map((f: { slug: string }) => f.slug)).toEqual([
    rows[0]!.rowRef,
    rows[1]!.rowRef,
    "effective_date",
  ]);
  const submit = (customFields: Record<string, string>) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/requests",
      cookies: requesterCookies,
      payload: {
        requestTypeId: rt.id,
        departmentId,
        title: "NDA",
        urgency: "medium",
        customFields,
      },
    });
  const hidden = await submit({ [rows[0]!.rowRef]: "No", effective_date: "2026-09-21" });
  expect(hidden.statusCode, hidden.body).toBe(201);
  expect(hidden.json().request.customFields.effective_date).toBe("2026-09-21");
  const detail = await h.app.inject({
    method: "GET",
    url: `/api/v1/requests/${hidden.json().request.number}`,
    cookies,
  });
  expect(
    detail.json().fields.find((f: { slug: string }) => f.slug === "effective_date").displayName,
  ).toBe("Effective date");
  const missing = await submit({ [rows[0]!.rowRef]: "Yes" });
  expect(missing.statusCode).toBe(400);
  expect(missing.json().detail).toContain("Conditional answer");
  const outside = await submit({ [rows[2]!.rowRef]: "No" });
  expect(outside.statusCode).toBe(400);
  expect(outside.json().detail).toContain("form");
  const stale = await submit({ [rows[0]!.rowRef]: "No", [rows[1]!.rowRef]: "Stale" });
  expect(stale.statusCode).toBe(400);
  const answered = await submit({ [rows[0]!.rowRef]: "Yes", [rows[1]!.rowRef]: "Answer" });
  expect(answered.statusCode, answered.body).toBe(201);
  const detached = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${typeId}/form`,
    cookies,
    payload: { form: form.filter((node) => node.id !== "conditional") },
  });
  expect(detached.statusCode, detached.body).toBe(200);
  const retained = await h.app.inject({
    method: "GET",
    url: `/api/v1/requests/${answered.json().request.number}`,
    cookies,
  });
  expect(retained.json().request.customFields[rows[1]!.rowRef]).toBe("Answer");
  expect(retained.json().fields.map((f: { slug: string }) => f.slug)).not.toContain(
    rows[1]!.rowRef,
  );
  const noModule = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${rt.id}`,
    cookies,
    payload: { targetModule: null },
  });
  expect(noModule.statusCode).toBe(400);
  expect(noModule.json().detail).toContain("destination module");
});

it("uses only the Contract Default Form for a module-only destination", async () => {
  const [type] = await h.db.select().from(contractTypes).where(eq(contractTypes.isDefault, true));
  const rt = (
    await h.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies,
      payload: { displayName: "Default intake" },
    })
  ).json().requestType;
  await h.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${rt.id}`,
    cookies,
    payload: { targetModule: "contract" },
  });
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/portal/request-types/${rt.slug}`,
    cookies: requesterCookies,
  });
  const destination = await h.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${type!.id}/form`,
    cookies,
  });
  expect(read.json().form).toEqual(
    destination.json().form.filter((r: { onIntakeForm?: boolean }) => r.onIntakeForm),
  );
});

it("stores native Row keys, validates Value and registry picks, and converts without shadow Fields", async () => {
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies,
    payload: { displayName: "Native intake" },
  });
  const typeId = made.json().contractType.id;
  const form: FormNode[] = [
    ...pinnedFormRows("contract"),
    ...Object.entries(FORM_BUILTINS.contract).map(([rowRef, fieldType]) => ({
      kind: "row" as const,
      id: rowRef,
      rowRef,
      fieldType,
      isRequired: rowRef === "counterparties",
      onIntakeForm: ["effective_date", "value", "counterparties"].includes(rowRef),
      visibleOnPortal: true,
    })),
  ];
  expect(
    (
      await h.app.inject({
        method: "PUT",
        url: `/api/v1/contract-types/${typeId}/form`,
        cookies,
        payload: { form },
      })
    ).statusCode,
  ).toBe(200);
  const rt = (
    await h.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies,
      payload: { displayName: "Native request" },
    })
  ).json().requestType;
  await h.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${rt.id}`,
    cookies,
    payload: { targetModule: "contract", targetTypeId: typeId },
  });
  const [party] = await h.db
    .insert(counterparties)
    .values({ name: "Registry selection", jurisdiction: "Delaware" })
    .returning();
  const lookup = await h.app.inject({
    method: "GET",
    url: `/api/v1/portal/request-types/${rt.id}/counterparties`,
    cookies: requesterCookies,
  });
  expect(lookup.statusCode, lookup.body).toBe(200);
  expect(lookup.json().counterparties).toContainEqual({
    id: party!.id,
    name: party!.name,
    jurisdiction: "Delaware",
  });
  const submit = (customFields: Record<string, unknown>, picks?: unknown[]) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/requests",
      cookies: requesterCookies,
      payload: {
        requestTypeId: rt.id,
        departmentId,
        title: "Native NDA",
        urgency: "medium",
        customFields,
        ...(picks ? { counterparties: picks } : {}),
      },
    });
  const partial = await submit({ value_amount: 100 });
  expect(partial.statusCode).toBe(400);
  expect(partial.json().detail).toContain("Value");
  const date = await submit({ effective_date: "2026-02-30" });
  expect(date.statusCode).toBe(400);
  const invalid = await submit({ counterparties: ["missing"] });
  expect(invalid.statusCode).toBe(400);
  const tooMany = await submit({ counterparties: Array.from({ length: 51 }, () => party!.id) });
  expect(tooMany.statusCode).toBe(400);
  const required = await submit({});
  expect(required.statusCode).toBe(400);
  expect(required.json().detail).toContain("Counterparties");
  const created = await submit(
    {
      effective_date: "2026-09-21",
      value_amount: 12345,
      value_currency: "USD",
      value_cadence: "monthly",
    },
    [{ counterpartyId: party!.id }, { name: "Proposed supplier" }],
  );
  expect(created.statusCode, created.body).toBe(201);
  expect(created.json().request.customFields).toEqual({
    effective_date: "2026-09-21",
    value_amount: 12345,
    value_currency: "USD",
    value_cadence: "monthly",
    counterparties: [party!.id, "Proposed supplier"],
  });
  const converted = await h.app.inject({
    method: "POST",
    url: `/api/v1/requests/${created.json().request.number}/convert`,
    cookies,
    payload: { title: "Native NDA" },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const [contract] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.number, converted.json().request.convertedContract.number));
  expect(contract).toMatchObject({
    effectiveDate: "2026-09-21",
    valueAmount: 12345,
    valueCurrency: "USD",
    valueCadence: "monthly",
    customFields: {},
  });
  const linked = await h.db
    .select()
    .from(contractCounterparties)
    .where(eq(contractCounterparties.contractId, contract!.id));
  expect(linked.map((p) => p.counterpartyId)).toContain(party!.id);
  expect(linked).toHaveLength(2);
});
