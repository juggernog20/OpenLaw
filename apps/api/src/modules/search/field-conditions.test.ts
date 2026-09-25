// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractTypes,
  contractStatuses,
  matters,
  matterTypes,
  matterStatuses,
  entities,
  entityTypes,
  fields,
  users,
  eq,
} from "@openlaw/db";
import { FIELD_OPERATORS, RELATIVE_DATE_OPERATORS, simpleSearchQuestion } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let adminCookies: Record<string, string>;
let viewer: string;
let entityId: string;
const ids: Record<string, string[]> = {};
const samples = {
  text: "Delaware 100%_literal",
  long_text: "This agreement is governed by Delaware law.",
  number: 42,
  currency: "USD",
  date: "2026-01-10",
  boolean: false,
  single_select: "A, B",
  multi_select: ["A, B", "C"],
  user: "",
  entity: "",
};
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  adminCookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const person = {
    email: "fields-reader@example.com",
    displayName: "Fields reader",
    password: "correct-horse-battery",
  };
  viewer = (await provisionUser(h.app.auth, person)).id;
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, viewer));
  cookies = await signInCookies(h.app, person.email, person.password);
  const entityType = (await h.db.select().from(entityTypes).limit(1))[0]!.id;
  entityId = (
    await h.db
      .insert(entities)
      .values({ legalName: "Reference Entity", entityTypeId: entityType })
      .returning()
  )[0]!.id;
  samples.user = viewer;
  samples.entity = entityId;
  for (const kind of ["contract", "matter", "entity"] as const) {
    for (const fieldType of Object.keys(samples) as (keyof typeof samples)[]) {
      await h.db.insert(fields).values({
        slug: `${kind}_${fieldType}`,
        displayName: fieldType === "text" ? "Governing law" : fieldType,
        moduleScope: kind,
        fieldType,
        options: fieldType.endsWith("select") ? ["A, B", "C", "D"] : null,
        aiAnswerStyle: kind === "contract" && fieldType === "long_text" ? "full_clause" : null,
      });
    }
    ids[kind] = [];
    for (const populated of [true, false]) {
      const customFields = populated
        ? Object.fromEntries(
            Object.entries(samples).map(([key, value]) => [`${kind}_${key}`, value]),
          )
        : {};
      const row =
        kind === "contract"
          ? await h.db
              .insert(contracts)
              .values({
                title: "Field Contract",
                contractTypeId: (await h.db.select().from(contractTypes).limit(1))[0]!.id,
                statusId: (await h.db.select().from(contractStatuses).limit(1))[0]!.id,
                customFields,
              })
              .returning()
          : kind === "matter"
            ? await h.db
                .insert(matters)
                .values({
                  title: "Field Matter",
                  matterTypeId: (await h.db.select().from(matterTypes).limit(1))[0]!.id,
                  statusId: (await h.db.select().from(matterStatuses).limit(1))[0]!.id,
                  createdBy: viewer,
                  customFields,
                })
                .returning()
            : await h.db
                .insert(entities)
                .values({ legalName: "Field Entity", entityTypeId: entityType, customFields })
                .returning();
      ids[kind]!.push(row[0]!.id);
    }
  }
});
afterAll(async () => h?.stop());
async function run(
  kind: "contract" | "matter" | "entity",
  type: string,
  operator: string,
  value?: unknown,
) {
  return h.app.inject({
    method: "POST",
    url: "/api/v1/search/query",
    cookies,
    payload: {
      ...simpleSearchQuestion("", [kind]),
      conditions: [{ kind, property: `field:${kind}_${type}`, operator, value }],
    },
  });
}
describe("Field conditions", () => {
  for (const kind of ["contract", "matter", "entity"] as const) {
    it(`${kind}: compiles every Field operator against stored values without type attachments`, async () => {
      const cases: [string, string, unknown, boolean][] = [
        ["text", "contains", "delaware", true],
        ["text", "contains", "%_", true],
        ["text", "does_not_contain", "Delaware", false],
        ["long_text", "contains", "governed by Delaware", true],
        ["long_text", "does_not_contain", "Delaware", false],
        ["currency", "is_any_of", ["USD"], true],
        ["currency", "is_none_of", ["USD"], false],
        ["number", "equals", 42, true],
        ["number", "greater_than", 41, true],
        ["number", "less_than", 43, true],
        ["number", "between", [42, 42], true],
        ["date", "on", "2026-01-10", true],
        ["date", "before", "2026-01-11", true],
        ["date", "after", "2026-01-09", true],
        ["date", "between", ["2026-01-10", "2026-01-10"], true],
        ["boolean", "is_no", undefined, true],
        ["boolean", "is_yes", undefined, false],
        ["single_select", "is_any_of", ["A, B"], true],
        ["single_select", "is_none_of", ["A, B"], false],
        ["multi_select", "includes_any", ["D", "C"], true],
        ["multi_select", "includes_all", ["A, B", "C"], true],
        ["multi_select", "includes_all", ["C", "D"], false],
        ["multi_select", "includes_none", ["C"], false],
        ["user", "is_any_of", ["me"], true],
        ["user", "is_none_of", ["me"], false],
        ["entity", "is_any_of", [entityId], true],
        ["entity", "is_none_of", [entityId], false],
      ];
      for (const [type, operator, value, matches] of cases) {
        const response = await run(kind, type, operator, value);
        expect(response.statusCode, response.body).toBe(200);
        const result = response.json().results.map((row: { id: string }) => row.id);
        expect(result.includes(ids[kind]![0]), `${type} ${operator}`).toBe(matches);
        const negative = ["does_not_contain", "is_none_of", "includes_none"].includes(operator);
        expect(result.includes(ids[kind]![1]), `${type} ${operator} absent`).toBe(negative);
      }
      for (const type of Object.keys(samples)) {
        const response = await run(kind, type, "is_empty");
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().results.map((row: { id: string }) => row.id)).toContain(
          ids[kind]![1],
        );
        expect(response.json().results.map((row: { id: string }) => row.id)).not.toContain(
          ids[kind]![0],
        );
        if (
          (FIELD_OPERATORS[type as keyof typeof FIELD_OPERATORS] as readonly string[]).includes(
            "is_not_empty",
          )
        ) {
          const present = await run(kind, type, "is_not_empty");
          expect(present.statusCode, present.body).toBe(200);
          expect(present.json().results.map((row: { id: string }) => row.id)).toEqual([
            ids[kind]![0],
          ]);
        }
      }
    });
  }
  it("uses relative calendar operators for date Fields", async () => {
    const original = (
      await h.db.select().from(contracts).where(eq(contracts.id, ids.contract![0]!))
    )[0]!.customFields;
    await h.db
      .update(contracts)
      .set({ customFields: { ...original, contract_date: new Date().toISOString().slice(0, 10) } })
      .where(eq(contracts.id, ids.contract![0]!));
    for (const operator of RELATIVE_DATE_OPERATORS) {
      const response = await run(
        "contract",
        "date",
        operator,
        operator.endsWith("days") ? 2 : undefined,
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().results.map((row: { id: string }) => row.id)).toEqual([
        ids.contract![0],
      ]);
    }
    await h.db
      .update(contracts)
      .set({ customFields: original })
      .where(eq(contracts.id, ids.contract![0]!));
  });
  it("treats only absent keys as empty, including retained blank, zero and empty-array answers", async () => {
    const original = (
      await h.db.select().from(contracts).where(eq(contracts.id, ids.contract![0]!))
    )[0]!.customFields;
    await h.db
      .update(contracts)
      .set({
        customFields: {
          ...original,
          contract_text: "",
          contract_number: 0,
          contract_multi_select: [],
        },
      })
      .where(eq(contracts.id, ids.contract![0]!));
    for (const type of ["text", "number", "boolean", "multi_select"]) {
      const response = await run("contract", type, "is_empty");
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().results.map((row: { id: string }) => row.id)).toEqual([
        ids.contract![1],
      ]);
    }
    await h.db
      .update(contracts)
      .set({ customFields: original })
      .where(eq(contracts.id, ids.contract![0]!));
  });
  it("refuses unknown, archived and wrong-module slugs and invalid operands with problem details", async () => {
    await h.db
      .update(fields)
      .set({ archivedAt: new Date() })
      .where(eq(fields.slug, "contract_long_text"));
    for (const [type, operator, value] of [
      ["missing", "contains", "x"],
      ["long_text", "contains", "x"],
      ["number", "contains", "42"],
      ["number", "between", [2, 1]],
      ["single_select", "is_any_of", ["unknown"]],
      ["date", "on", "2026-02-30"],
      ["boolean", "is_no", false],
    ] as const) {
      const response = await run("contract", type, operator, value);
      expect(response.statusCode, response.body).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
  });
  it("checks Field scope and staff permission without leaking hidden Entity choices or records", async () => {
    const question = {
      ...simpleSearchQuestion("", ["matter"]),
      conditions: [
        {
          kind: "matter",
          property: "field:contract_text",
          operator: "contains",
          value: "Delaware",
        },
      ],
    };
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/api/v1/search/query",
          cookies,
          payload: question,
        })
      ).statusCode,
    ).toBe(400);
    const hidden = (
      await h.db
        .insert(entities)
        .values({
          legalName: "Hidden Entity",
          entityTypeId: (await h.db.select().from(entityTypes).limit(1))[0]!.id,
          isConfidential: true,
        })
        .returning()
    )[0]!;
    const choices = await h.app.inject({ method: "GET", url: "/api/v1/search/fields", cookies });
    expect(choices.json().entities.map((row: { id: string }) => row.id)).toContain(entityId);
    expect(choices.json().entities.map((row: { id: string }) => row.id)).not.toContain(hidden.id);
    await h.db
      .update(contracts)
      .set({
        isConfidential: true,
        managerId: (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!
          .id,
      })
      .where(eq(contracts.id, ids.contract![0]!));
    expect((await run("contract", "text", "contains", "Delaware")).json().total).toBe(0);
    const admin = await h.app.inject({
      method: "POST",
      url: "/api/v1/search/query",
      cookies: adminCookies,
      payload: {
        ...simpleSearchQuestion("", ["contract"]),
        conditions: [
          {
            kind: "contract",
            property: "field:contract_text",
            operator: "contains",
            value: "Delaware",
          },
        ],
      },
    });
    expect(admin.statusCode, admin.body).toBe(200);
    expect(admin.json().total).toBe(1);
    await h.db
      .update(contracts)
      .set({ isConfidential: false, managerId: null })
      .where(eq(contracts.id, ids.contract![0]!));
    await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, viewer));
    expect((await run("contract", "text", "contains", "Delaware")).statusCode).toBe(403);
    expect(
      (await h.app.inject({ method: "GET", url: "/api/v1/search/fields", cookies })).statusCode,
    ).toBe(403);
    await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, viewer));
  });
  it("reads Fields created in Settings on the next request", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/api/v1/fields",
      cookies: adminCookies,
      payload: { moduleScope: "contract", fieldType: "text", displayName: "New search Field" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const catalog = await h.app.inject({ method: "GET", url: "/api/v1/search/fields", cookies });
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(catalog.json().fields).toContainEqual(
      expect.objectContaining({ slug: created.json().field.slug }),
    );
    const answer = await h.app.inject({
      method: "POST",
      url: "/api/v1/search/query",
      cookies,
      payload: {
        ...simpleSearchQuestion("", ["contract"]),
        conditions: [
          {
            kind: "contract",
            property: `field:${created.json().field.slug}`,
            operator: "is_empty",
          },
        ],
      },
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json().total).toBe(2);
  });
  it("exposes only live catalog entries to staff, including unattached Fields", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/v1/search/fields", cookies });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "contract_text", displayName: "Governing law" }),
      ]),
    );
    expect(
      response.json().fields.some((field: { slug: string }) => field.slug === "contract_long_text"),
    ).toBe(false);
  });
});
