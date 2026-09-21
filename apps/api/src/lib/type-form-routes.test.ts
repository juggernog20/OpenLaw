// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, contractTypes, eq, fields, sql } from "@openlaw/db";
import type { FormNode, FormRow } from "@openlaw/shared";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => {
  await h?.stop();
});

async function createType(module = "contract") {
  const res = await h.app.inject({
    method: "POST",
    url: `/api/v1/${module}-types`,
    cookies,
    payload: { displayName: `Form ${crypto.randomUUID()}` },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json()[`${module}Type`].id as string;
}
async function read(id: string, module = "contract"): Promise<FormNode[]> {
  const res = await h.app.inject({
    method: "GET",
    url: `/api/v1/${module}-types/${id}/form`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().form;
}
function put(id: string, form: FormNode[], module = "contract") {
  return h.app.inject({
    method: "PUT",
    url: `/api/v1/${module}-types/${id}/form`,
    cookies,
    payload: { form },
  });
}
async function field(module = "contract", fieldType: "text" | "user" = "text"): Promise<FormRow> {
  const [f] = await h.db
    .insert(fields)
    .values({
      slug: `test_${crypto.randomUUID()}`,
      displayName: "Test Row",
      moduleScope: module as "contract",
      fieldType,
      fieldTag: "business",
    })
    .returning();
  return {
    kind: "row",
    id: f!.id,
    rowRef: f!.slug,
    fieldType,
    isRequired: false,
    visibleOnPortal: true,
    ...(module === "entity" ? {} : { onIntakeForm: false }),
  };
}

it("draws pinned Rows first and seeds built-ins on new types", async () => {
  const form = await read(await createType());
  expect(form.slice(0, 2).map((n) => n.kind === "row" && n.rowRef)).toEqual([
    "title",
    "contract_type",
  ]);
  expect(form.filter((n) => n.kind === "row" && n.rowRef === "value")).toHaveLength(1);
});

it("round-trips nested Branches and audits one whole replacement", async () => {
  const id = await createType();
  const first = await field();
  const second = await field();
  const form: FormNode[] = [
    ...(await read(id)).slice(0, 2),
    first,
    {
      kind: "branch",
      id: "terms",
      match: "all",
      conditions: [{ rowRef: first.rowRef, operator: "is_set", value: null }],
      children: [
        {
          kind: "branch",
          id: "details",
          match: "any",
          conditions: [{ rowRef: first.rowRef, operator: "equals", value: "yes" }],
          children: [second],
        },
      ],
    },
  ];
  const res = await put(id, form);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().form).toEqual(form);
  expect(await read(id)).toEqual(form);
  const [type] = await h.db.select().from(contractTypes).where(eq(contractTypes.id, id));
  const audit = await h.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "contract_type.updated"));
  const entries = audit.filter((a) => (a.payload as { slug: string }).slug === type!.slug);
  expect(entries).toHaveLength(1);
  expect(JSON.stringify(entries[0]!.payload)).toContain(first.rowRef);
});

it("names a Branch referencing its children and rolls back the replacement", async () => {
  const id = await createType();
  const before = await read(id);
  const child = await field();
  const res = await put(id, [
    ...before.slice(0, 2),
    {
      kind: "branch",
      id: "invalid-branch",
      match: "all",
      conditions: [{ rowRef: child.rowRef, operator: "is_set", value: null }],
      children: [child],
    },
  ]);
  expect(res.statusCode, res.body).toBe(400);
  expect(res.json().detail).toContain('Branch "invalid-branch"');
  expect(await read(id)).toEqual(before);
});

it("refuses invalid switches, duplicate Rows, foreign scopes, spoofed types and misplaced pins", async () => {
  const id = await createType();
  const pins = (await read(id)).slice(0, 2);
  const custom = await field();
  const person = await field("contract", "user");
  const foreign = await field("matter");
  for (const form of [
    [...pins, { ...custom, onIntakeForm: true, visibleOnPortal: false }],
    [...pins, { ...person, onIntakeForm: true, isRequired: true }],
    [...pins, custom, custom],
    [...pins, foreign],
    [...pins, { ...person, fieldType: "text" as const }],
    [pins[1]!, pins[0]!],
  ]) {
    const res = await put(id, form);
    expect(res.statusCode, res.body).toBe(400);
  }
  const entityId = await createType("entity");
  const entityForm = await read(entityId, "entity");
  const res = await put(
    entityId,
    [...entityForm, { ...(await field("entity")), onIntakeForm: true }],
    "entity",
  );
  expect(res.statusCode, res.body).toBe(400);
});

it("detaches absent Fields while preserving stored record values and legacy attachment reads", async () => {
  const id = await createType();
  const custom = await field();
  const attach = await h.app.inject({
    method: "POST",
    url: `/api/v1/contract-types/${id}/fields`,
    cookies,
    payload: { fieldId: custom.id },
  });
  expect(attach.statusCode, attach.body).toBe(201);
  expect(await read(id)).toContainEqual(custom);
  await h.db
    .execute(sql`insert into contracts (id, title, contract_type_id, status_id, custom_fields)
    select 'form-value-test', 'Keep answers', ${id}, id, ${JSON.stringify({ [custom.rowRef]: "kept" })}::jsonb from contract_statuses limit 1`);
  expect(
    (
      await put(
        id,
        (await read(id)).filter((n) => n.id !== custom.id),
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await h.db.execute(sql`select custom_fields from contracts where id = 'form-value-test'`))
      .rows[0],
  ).toEqual({ custom_fields: { [custom.rowRef]: "kept" } });
  const legacy = await h.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${id}/fields`,
    cookies,
  });
  expect(legacy.json().attachedFields).toEqual([]);
});

it("protects both Default types by identity after rename", async () => {
  for (const module of ["contract", "matter"]) {
    const res = await h.app.inject({ method: "GET", url: `/api/v1/${module}-types`, cookies });
    const type = res.json()[`${module}Types`].find((t: { slug: string }) => t.slug === "default");
    expect(type.isDefault).toBe(true);
    const renamed = await h.app.inject({
      method: "PATCH",
      url: `/api/v1/${module}-types/${type.id}`,
      cookies,
      payload: { displayName: "General work" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    for (const method of ["archive", "delete"]) {
      const refused = await h.app.inject({
        method: method === "archive" ? "POST" : "DELETE",
        url: `/api/v1/${module}-types/${type.id}${method === "archive" ? "/archive" : ""}`,
        cookies,
        ...(method === "archive" ? { payload: {} } : {}),
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().detail).toContain("General work");
      expect(refused.json().detail).toContain("Default");
    }
  }
});

it("legacy PATCH cannot make an Intake user Row required, and detach cannot break a Branch", async () => {
  const id = await createType();
  const person = { ...(await field("contract", "user")), onIntakeForm: true };
  const form: FormNode[] = [
    ...(await read(id)).slice(0, 2),
    person,
    {
      kind: "branch",
      id: "person-details",
      match: "all",
      conditions: [{ rowRef: person.rowRef, operator: "is_set", value: null }],
      children: [],
    },
  ];
  expect((await put(id, form)).statusCode).toBe(200);
  const patched = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/contract-types/${id}/fields/${person.id}`,
    cookies,
    payload: { isRequired: true },
  });
  expect(patched.statusCode, patched.body).toBe(400);
  const detached = await h.app.inject({
    method: "DELETE",
    url: `/api/v1/contract-types/${id}/fields/${person.id}`,
    cookies,
  });
  expect(detached.statusCode, detached.body).toBe(400);
  expect(detached.json().detail).toContain("person-details");
  expect(await read(id)).toEqual(form);
});

it("mounts the Form only for record types, and requires an Administrator", async () => {
  const id = await createType();
  for (const method of ["GET", "PUT"] as const) {
    const res = await h.app.inject({
      method,
      url: `/api/v1/contract-types/${id}/form`,
      ...(method === "PUT" ? { payload: { form: [] } } : {}),
    });
    expect(res.statusCode).toBe(401);
    const absent = await h.app.inject({
      method,
      url: `/api/v1/request-types/${id}/form`,
      cookies,
      ...(method === "PUT" ? { payload: { form: [] } } : {}),
    });
    expect(absent.statusCode).toBe(404);
  }
});

it.each(["matter", "entity"])(
  "round-trips the %s mount with the same tree machinery",
  async (module) => {
    const id = await createType(module);
    const first = await field(module);
    const second = await field(module);
    const form: FormNode[] = [
      ...(module === "matter" ? (await read(id, module)).slice(0, 2) : []),
      first,
      {
        kind: "branch",
        id: "details",
        match: "any",
        conditions: [{ rowRef: first.rowRef, operator: "is_set", value: null }],
        children: [second],
      },
    ];
    const res = await put(id, form, module);
    expect(res.statusCode, res.body).toBe(200);
    expect(await read(id, module)).toEqual(form);
  },
);

it("legacy ordering preserves Branch and built-in slots", async () => {
  const id = await createType();
  const original = await read(id);
  const first = await field();
  const second = await field();
  const value = original.find((n) => n.kind === "row" && n.rowRef === "value")!;
  const form: FormNode[] = [
    ...original.slice(0, 2),
    first,
    value,
    second,
    {
      kind: "branch",
      id: "after-fields",
      match: "all",
      conditions: [{ rowRef: first.rowRef, operator: "is_set", value: null }],
      children: [],
    },
  ];
  expect((await put(id, form)).statusCode).toBe(200);
  const reordered = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${id}/fields/order`,
    cookies,
    payload: { fieldIds: [second.id, first.id] },
  });
  expect(reordered.statusCode, reordered.body).toBe(200);
  expect(await read(id)).toEqual([...original.slice(0, 2), second, value, first, form.at(-1)!]);
});
