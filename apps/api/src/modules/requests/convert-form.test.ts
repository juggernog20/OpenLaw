// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  contracts,
  matters,
  requests,
  requestTypes,
  users,
  fields,
  regions,
  departments,
  entities,
  entityTypes,
  counterparties,
  contractCounterparties,
  contractKeyDates,
  matterKeyDates,
  eq,
} from "@openlaw/db";
import { FORM_BUILTINS, pinnedFormRows, type Form } from "@openlaw/shared";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
let h: TestHarness;
let cookies: Record<string, string>;
let actorId: string;
let departmentId: string;
let regionId: string;
let entityId: string;
let partyId: string;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  actorId = (await h.db.select().from(users))[0]!.id;
  departmentId = (
    await h.db
      .insert(departments)
      .values({ displayOrder: 1, slug: "convert", displayName: "Convert department" })
      .returning()
  )[0]!.id;
  regionId = (
    await h.db
      .insert(regions)
      .values({ displayOrder: 1, slug: "convert", displayName: "Convert region" })
      .returning()
  )[0]!.id;
  const entityType = (await h.db.select().from(entityTypes))[0]!;
  entityId = (
    await h.db
      .insert(entities)
      .values({ legalName: "Our company", entityTypeId: entityType.id, portalListed: true })
      .returning()
  )[0]!.id;
  partyId = (await h.db.insert(counterparties).values({ name: "Picked party" }).returning())[0]!.id;
});
afterAll(async () => {
  await h?.stop();
});

let fixtureNumber = 0;
async function fixture(module: "contract" | "matter") {
  const suffix = ++fixtureNumber;
  const made = await h.app.inject({
    method: "POST",
    url: `/api/v1/${module}-types`,
    cookies,
    payload: { displayName: `Convert ${module} ${suffix}` },
  });
  expect(made.statusCode, made.body).toBe(201);
  const typeId = made.json()[`${module}Type`].id;
  const [answer] = await h.db
    .insert(fields)
    .values({
      moduleScope: module,
      slug: `convert_${module}_answer_${suffix}`,
      displayName: "Conditional answer",
      fieldType: "text",
    })
    .returning();
  const form: Form = [
    ...pinnedFormRows(module),
    ...Object.entries(FORM_BUILTINS[module]).map(([rowRef, fieldType]) => ({
      kind: "row" as const,
      id: rowRef,
      rowRef,
      fieldType,
      onIntakeForm: true,
      isRequired: false,
      visibleOnPortal: true,
    })),
    {
      kind: "branch",
      id: "high-risk",
      match: "all",
      conditions: [{ rowRef: "risk", operator: "equals", value: "high" }],
      children: [
        {
          kind: "row",
          id: answer!.id,
          rowRef: answer!.slug,
          fieldType: "text",
          onIntakeForm: false,
          isRequired: true,
          visibleOnPortal: true,
        },
      ],
    },
  ];
  const saved = await h.app.inject({
    method: "PUT",
    url: `/api/v1/${module}-types/${typeId}/form`,
    cookies,
    payload: { form },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const [rt] = await h.db
    .insert(requestTypes)
    .values({
      displayOrder: 1,
      slug: `convert-${module}-${suffix}`,
      displayName: `Convert ${module} ${suffix}`,
      targetModule: module,
      ...(module === "contract"
        ? { targetContractTypeId: typeId }
        : { targetMatterTypeId: typeId }),
    })
    .returning();
  const createRequest = async (customFields: Record<string, string | number | string[]> = {}) =>
    (
      await h.db
        .insert(requests)
        .values({
          requestTypeId: rt!.id,
          requesterId: actorId,
          title: "Conversion",
          description: "Requester description",
          urgency: "medium",
          departmentId,
          customFields,
          intakeCounterparties: [{ counterpartyId: partyId, name: "Picked party" }],
        })
        .returning()
    )[0]!;
  const convert = (number: number, body: object = {}) =>
    h.app.inject({
      method: "POST",
      url: `/api/v1/requests/${number}/convert`,
      cookies,
      payload: { title: "Converted", ...body },
    });
  return { typeId, form, answer: answer!, createRequest, convert };
}

it.each(["contract", "matter"] as const)(
  "%s conversion merges Row answers, evaluates Branches, and lands built-ins",
  async (module) => {
    const f = await fixture(module);
    const answers = {
      description: "Row description",
      risk: "low",
      priority: "high",
      region: regionId,
      department: departmentId,
      owning_department: departmentId,
      entity: entityId,
      counterparties: ["Picked party"],
      needed_by: "2027-02-03",
      term_type: "auto_renew",
      effective_date: "2026-09-22",
      expiry_date: "2027-09-22",
      renewal_period_months: 12,
      notice_period_days: 30,
      value_amount: 12345,
      value_currency: "USD",
      value_cadence: "monthly",
      stays_behind: "Request only",
    };
    const request = await f.createRequest(answers);
    const missing = await f.convert(request.number, { customFields: { risk: "high" } });
    expect(missing.statusCode, missing.body).toBe(400);
    expect(missing.json().detail).toContain("Conditional answer");
    const result = await f.convert(request.number, {
      customFields: { risk: "high", [f.answer.slug]: "Dialog answer" },
    });
    expect(result.statusCode, result.body).toBe(200);
    const table = module === "contract" ? contracts : matters;
    const [record] = await h.db.select().from(table).where(eq(table.title, "Converted"));
    expect(record).toMatchObject({
      description: "Row description",
      priority: "high",
      risk: "high",
      region: "Convert region",
      customFields: { [f.answer.slug]: "Dialog answer" },
    });
    if (module === "contract") {
      expect(record).toMatchObject({
        entityId,
        owningDepartmentId: departmentId,
        effectiveDate: "2026-09-22",
        expiryDate: "2027-09-22",
        termType: "auto_renew",
        renewalPeriodMonths: 12,
        noticePeriodDays: 30,
        valueAmount: 12345,
        valueCurrency: "USD",
        valueCadence: "monthly",
      });
      expect(
        await h.db
          .select()
          .from(contractCounterparties)
          .where(eq(contractCounterparties.contractId, record!.id)),
      ).toMatchObject([{ counterpartyId: partyId }]);
    } else expect(record).toMatchObject({ departmentId });
    const dates =
      module === "contract"
        ? await h.db
            .select()
            .from(contractKeyDates)
            .where(eq(contractKeyDates.contractId, record!.id))
        : await h.db.select().from(matterKeyDates).where(eq(matterKeyDates.matterId, record!.id));
    expect(dates).toMatchObject([{ label: "Needed by", date: "2027-02-03" }]);
    expect(
      (await h.db.select().from(requests).where(eq(requests.id, request.id)))[0]!.customFields,
    ).toEqual(answers);
    const hidden = await f.createRequest({ risk: "low" });
    expect((await f.convert(hidden.number)).statusCode).toBe(200);
  },
);

it("carries migrated built-ins, with dialog answers taking precedence", async () => {
  const f = await fixture("contract");
  for (const [canonical, override, expected] of [
    [undefined, undefined, "2026-01-01"],
    ["2026-02-01", undefined, "2026-02-01"],
    ["2026-02-01", "2026-03-01", "2026-03-01"],
    ["2026-02-01", null, null],
  ] as const) {
    const request = await f.createRequest({
      effective_date: "2026-01-01",
      ...(canonical ? { effective_date: canonical } : {}),
    });
    const result = await f.convert(request.number, {
      customFields: {
        ...(override !== undefined ? { effective_date: override } : {}),
        description: null,
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    const [contract] = await h.db
      .select()
      .from(contracts)
      .where(eq(contracts.number, result.json().request.convertedRecord.number));
    expect(contract).toMatchObject({ effectiveDate: expected, description: null });
  }
});

it("re-reads the target Form at conversion and carries only answers with a target Row", async () => {
  const nda = await fixture("contract");
  const msa = await fixture("contract");
  const request = await nda.createRequest({
    [nda.answer.slug]: "NDA only",
    [msa.answer.slug]: "Shared answer",
    risk: "low",
  });
  // A changed Form makes the Row required after the Request was submitted.
  const changed = msa.form.map((node) =>
    node.kind === "branch"
      ? { ...node, conditions: [{ rowRef: "risk", operator: "equals" as const, value: "low" }] }
      : node,
  );
  const saved = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${msa.typeId}/form`,
    cookies,
    payload: { form: changed },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const result = await nda.convert(request.number, { contractTypeId: msa.typeId });
  expect(result.statusCode, result.body).toBe(200);
  const [record] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.number, result.json().request.convertedRecord.number));
  expect(record!.customFields).toEqual({ [msa.answer.slug]: "Shared answer" });
  const missing = await nda.createRequest({ risk: "low" });
  expect((await nda.convert(missing.number, { contractTypeId: msa.typeId })).statusCode).toBe(400);
});
