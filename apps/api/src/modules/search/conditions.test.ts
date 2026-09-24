// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractTypes,
  contractStatuses,
  matters,
  matterTypes,
  matterStatuses,
  users,
  eq,
  matterTasks,
  contractCounterparties,
  counterparties,
  entities,
  entityTypes,
  fields,
  matterTypeFields,
} from "@openlaw/db";
import { simpleSearchQuestion, type SearchQuestion } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let viewer: string;
let partyId: string;
let otherPartyId: string;
let entityId: string;
const ids: Record<string, string[]> = {};
const types: Record<string, string> = {};
const statuses: Record<string, string> = {};
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  const person = {
    email: "condition@example.com",
    displayName: "Condition reader",
    password: "correct-horse-battery",
  };
  const user = await provisionUser(h.app.auth, person);
  viewer = user.id;
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, viewer));
  cookies = await signInCookies(h.app, person.email, person.password);
  types.contract = (await h.db.select().from(contractTypes).limit(1))[0]!.id;
  types.matter = (await h.db.select().from(matterTypes).limit(1))[0]!.id;
  statuses.contract = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "active")).limit(1)
  )[0]!.id;
  statuses.matter = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "open")).limit(1)
  )[0]!.id;
  for (const kind of ["contract", "matter"] as const) {
    ids[kind] = [];
    for (let i = 0; i < 5; i++) {
      const common = {
        title: i === 0 ? "Alpha 100%_literal" : "Beta",
        statusId: statuses[kind]!,
        managerId: i === 0 || i === 3 ? viewer : null,
        isConfidential: i === 2 || i === 3,
        archivedAt: i === 4 ? new Date() : null,
      };
      const row =
        kind === "contract"
          ? await h.db
              .insert(contracts)
              .values({
                ...common,
                contractTypeId: types.contract!,
                effectiveDate: "2026-01-10",
                expiryDate: "2026-02-10",
                noticePeriodDays: 10,
              })
              .returning()
          : await h.db
              .insert(matters)
              .values({
                ...common,
                matterTypeId: types.matter!,
                createdBy: viewer,
                businessOwnerId: i === 0 ? viewer : null,
                priority: i === 0 ? "high" : "low",
                risk: i === 0 ? "medium" : null,
                openedAt: new Date("2026-01-10T23:30:00Z"),
              })
              .returning();
      ids[kind]!.push(row[0]!.id);
    }
  }
  await h.db.insert(matterTasks).values({
    matterId: ids.matter![0]!,
    title: "Overdue",
    dueDate: "2026-01-10",
    displayOrder: 0,
  });
  const [party, otherParty] = await h.db
    .insert(counterparties)
    .values([{ name: "Orion" }, { name: "Acme" }])
    .returning();
  partyId = party!.id;
  otherPartyId = otherParty!.id;
  await h.db.insert(contractCounterparties).values([
    { contractId: ids.contract![0]!, counterpartyId: partyId, isPrimary: true },
    { contractId: ids.contract![0]!, counterpartyId: otherPartyId, isPrimary: false },
  ]);
  const entityType = (await h.db.select().from(entityTypes).limit(1))[0]!;
  const [entity] = await h.db
    .insert(entities)
    .values({ legalName: "Signing company", entityTypeId: entityType.id })
    .returning();
  entityId = entity!.id;
  await h.db.update(contracts).set({ entityId }).where(eq(contracts.id, ids.contract![0]!));
  const ended = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "ended")).limit(1)
  )[0]!;
  const closed = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "closed")).limit(1)
  )[0]!;
  await h.db
    .update(contracts)
    .set({ statusId: ended.id, endedAt: new Date() })
    .where(eq(contracts.id, ids.contract![1]!));
  await h.db
    .update(matters)
    .set({ statusId: closed.id, closedAt: new Date() })
    .where(eq(matters.id, ids.matter![1]!));
  const [field] = await h.db
    .insert(fields)
    .values({
      slug: "condition-required",
      displayName: "Required",
      moduleScope: "matter",
      fieldType: "text",
    })
    .returning();
  await h.db
    .insert(matterTypeFields)
    .values({ typeId: types.matter!, fieldId: field!.id, isRequired: true, displayOrder: 0 });
  await h.db
    .update(matters)
    .set({ customFields: { "condition-required": "present" } })
    .where(eq(matters.id, ids.matter![0]!));
});
afterAll(async () => {
  await h?.stop();
});

async function run(
  kind: "contract" | "matter",
  conditions: SearchQuestion["conditions"],
  match: "all" | "any" = "all",
  extra = {},
) {
  const response = await h.app.inject({
    method: "POST",
    url: "/api/v1/search/query",
    cookies,
    payload: { ...simpleSearchQuestion("", [kind]), conditions, match, ...extra },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ results: { id: string }[]; total: number; nextCursor: string | null }>();
}
const condition = (
  kind: "contract" | "matter",
  property: string,
  operator: string,
  value: SearchQuestion["conditions"][number]["value"],
) => ({ kind, property, operator, value });

describe("Contract and Matter conditions", () => {
  for (const kind of ["contract", "matter"] as const) {
    it(`${kind}: choices OR within a row under both match modes, with null-safe exclusion and Me`, async () => {
      const owner = kind === "contract" ? "owner" : "manager";
      for (const match of ["all", "any"] as const) {
        const answer = await run(
          kind,
          [condition(kind, owner, "is_any_of", ["me", "unassigned"])],
          match,
        );
        expect(answer.total).toBe(3);
        expect(answer.results.map((r) => r.id).sort()).toEqual(
          [ids[kind]![0], ids[kind]![1], ids[kind]![3]].sort(),
        );
      }
      const excluded = await run(kind, [condition(kind, owner, "is_none_of", ["me"])]);
      expect(excluded.results.map((r) => r.id)).toEqual([ids[kind]![1]]);
      expect((await run(kind, [condition(kind, owner, "is_none_of", ["unassigned"])])).total).toBe(
        2,
      );
      for (const property of ["type", "status"]) {
        const value = property === "type" ? types[kind]! : statuses[kind]!;
        expect((await run(kind, [condition(kind, property, "is_any_of", [value])])).total).toBe(
          property === "status" ? 2 : 3,
        );
        expect((await run(kind, [condition(kind, property, "is_none_of", [value])])).total).toBe(
          property === "status" ? 1 : 0,
        );
      }
    });
    it(`${kind}: text operators escape wildcards and ignore case`, async () => {
      expect(
        (await run(kind, [condition(kind, "title", "contains", "ALPHA")])).results.map((r) => r.id),
      ).toEqual([ids[kind]![0]]);
      expect((await run(kind, [condition(kind, "title", "contains", "%_")])).total).toBe(1);
      expect((await run(kind, [condition(kind, "title", "does_not_contain", "alpha")])).total).toBe(
        2,
      );
    });
    it(`${kind}: every absolute date operator, inclusive range, and missing dates`, async () => {
      const property = kind === "contract" ? "effective" : "opened";
      for (const [operator, value, total] of [
        ["before", "2026-01-11", 3],
        ["before", "2026-01-10", 0],
        ["after", "2026-01-09", 3],
        ["after", "2026-01-10", 0],
        ["on", "2026-01-10", 3],
        ["on", "2026-01-11", 0],
        ["between", ["2026-01-10", "2026-01-10"], 3],
      ] as const)
        expect(
          (
            await run(kind, [condition(kind, property, operator, value)], "all", {
              timeZone: "UTC",
            })
          ).total,
        ).toBe(total);
      const derived = kind === "contract" ? "noticeDeadline" : "deadline";
      expect(
        (
          await run(kind, [
            condition(kind, derived, "on", kind === "contract" ? "2026-01-31" : "2026-01-10"),
          ])
        ).total,
      ).toBe(kind === "contract" ? 3 : 1);
    });
    it(`${kind}: flags, match modes, archive inclusion, reach before total and paging`, async () => {
      const rows = [
        condition(kind, "title", "contains", "Alpha"),
        condition(kind, "confidential", "is", true),
      ];
      expect((await run(kind, rows)).total).toBe(0);
      const any = await run(kind, rows, "any", { limit: 1 });
      expect(any.total).toBe(2);
      expect(any.results).toHaveLength(1);
      expect(any.nextCursor).not.toBeNull();
      const next = await run(kind, rows, "any", { limit: 1, cursor: any.nextCursor });
      expect(new Set([...any.results, ...next.results].map((r) => r.id))).toEqual(
        new Set([ids[kind]![0], ids[kind]![3]]),
      );
      expect((await run(kind, [condition(kind, "confidential", "is", false)])).total).toBe(2);
      expect((await run(kind, [condition(kind, "includeArchived", "is", true)])).total).toBe(4);
      expect((await run(kind, [condition(kind, "includeArchived", "is", false)])).total).toBe(3);
      for (const [shown, total] of [
        [false, 3],
        [true, 4],
      ] as const) {
        expect(
          (
            await run(
              kind,
              [
                condition(kind, "includeArchived", "is", shown),
                condition(kind, "title", "contains", "Beta"),
              ],
              "any",
            )
          ).total,
        ).toBe(total);
      }
      const lifecycle = kind === "contract" ? "includeEnded" : "includeClosed";
      expect((await run(kind, [condition(kind, lifecycle, "is", false)])).total).toBe(2);
      expect((await run(kind, [condition(kind, lifecycle, "is", true)])).total).toBe(3);
      for (const shown of [false, true]) {
        expect(
          (
            await run(
              kind,
              [
                condition(kind, lifecycle, "is", shown),
                condition(kind, "title", "contains", "Beta"),
              ],
              "any",
            )
          ).total,
        ).toBe(3);
      }
    });
  }
  it("reads linked Counterparties, signing Entity, Matter people and severities", async () => {
    for (const [kind, property, value] of [
      ["contract", "counterparty", partyId],
      ["contract", "entity", entityId],
      ["matter", "businessOwner", "me"],
      ["matter", "priority", "high"],
      ["matter", "risk", "medium"],
    ] as const) {
      expect(
        (await run(kind, [condition(kind, property, "is_any_of", [value])])).results.map(
          (r) => r.id,
        ),
      ).toEqual([ids[kind]![0]]);
      expect((await run(kind, [condition(kind, property, "is_none_of", [value])])).total).toBe(2);
    }
    expect(
      (
        await run("contract", [
          condition("contract", "counterparty", "is_any_of", [partyId, otherPartyId]),
        ])
      ).total,
    ).toBe(1);
    expect(
      (await run("matter", [condition("matter", "risk", "is_any_of", ["unassigned"])])).total,
    ).toBe(2);
    expect(
      (await run("matter", [condition("matter", "businessOwner", "is_any_of", ["unassigned"])]))
        .total,
    ).toBe(2);
    expect(
      (await run("contract", [condition("contract", "expiry", "on", "2026-02-10")])).total,
    ).toBe(3);
    expect((await run("matter", [condition("matter", "incomplete", "is", true)])).total).toBe(2);
    expect((await run("matter", [condition("matter", "incomplete", "is", false)])).total).toBe(1);
  });
  it("supplies linked choices only from reached records", async () => {
    const [hiddenParty] = await h.db
      .insert(counterparties)
      .values({ name: "Hidden party" })
      .returning();
    await h.db
      .insert(contractCounterparties)
      .values({ contractId: ids.contract![2]!, counterpartyId: hiddenParty!.id, isPrimary: true });
    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/contracts/filter-options",
      cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .counterparties.map((choice: { id: string }) => choice.id)
        .sort(),
    ).toEqual([partyId, otherPartyId].sort());
    expect(response.json().entities).toEqual([{ id: entityId, displayName: "Signing company" }]);
  });
  it("keeps kinds independent under both match modes", async () => {
    for (const match of ["all", "any"] as const) {
      const answer = await run(
        "contract",
        [
          condition("contract", "title", "contains", "Alpha"),
          condition("matter", "title", "contains", "Beta"),
        ],
        match,
        { kinds: ["contract", "matter"] },
      );
      expect(answer.results.map((r) => r.id).sort()).toEqual(
        [ids.contract![0], ids.matter![1], ids.matter![3]].sort(),
      );
    }
  });
  it("uses the viewer's calendar date for Opened date", async () => {
    expect(
      (
        await run("matter", [condition("matter", "opened", "on", "2026-01-11")], "all", {
          timeZone: "Asia/Dubai",
        })
      ).total,
    ).toBe(3);
  });
  it("refuses unknown properties, mismatched operators, absent kinds, invalid values and a twenty-first row with problem details", async () => {
    const good = condition("contract", "confidential", "is", true);
    for (const conditions of [
      [{ ...good, property: "missing" }],
      [{ ...good, operator: "contains" }],
      [{ ...good, kind: "matter" }],
      [{ ...good, value: "true" }],
      [condition("contract", "effective", "on", "2026-02-30")],
      [condition("contract", "expiry", "between", ["2026-02-01", "2026-01-01"])],
      Array.from({ length: 21 }, () => good),
    ]) {
      const response = await h.app.inject({
        method: "POST",
        url: "/api/v1/search/query",
        cookies,
        payload: { ...simpleSearchQuestion("", ["contract"]), conditions },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json().detail).toEqual(expect.any(String));
    }
    expect(
      (
        await run(
          "contract",
          Array.from({ length: 20 }, () => good),
        )
      ).total,
    ).toBe(1);
  });
});
