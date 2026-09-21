// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { fields, regions, matterTemplates, counterparties } from "@openlaw/db";
import { FORM_BUILTINS, pinnedFormRows, type FormNode, type FormModule } from "@openlaw/shared";
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

it.each(["contract", "matter", "entity"] as const)(
  "%s creation enforces only visible required Rows and returns the creation tree",
  async (module: FormModule) => {
    const plural = module === "entity" ? "entities" : `${module}s`;
    const made = await h.app.inject({
      method: "POST",
      url: `/api/v1/${module}-types`,
      cookies,
      payload: { displayName: `Creation ${module}` },
    });
    expect(made.statusCode, made.body).toBe(201);
    const typeId = made.json()[`${module}Type`].id;
    const definitions = await h.db
      .insert(fields)
      .values(
        ["Choice", "Conditional answer", "Record note"].map((displayName, index) => ({
          moduleScope: module,
          slug: `${module}_creation_${index}`,
          displayName,
          fieldType: "text" as const,
          fieldTag: "business" as const,
        })),
      )
      .returning();
    const rows = definitions.map((f, index) => ({
      kind: "row" as const,
      id: f.id,
      rowRef: f.slug,
      fieldType: f.fieldType,
      isRequired: index < 2,
      visibleOnPortal: true,
      ...(module === "entity" ? {} : { onIntakeForm: false }),
    }));
    const form: FormNode[] = [
      ...pinnedFormRows(module),
      rows[0]!,
      {
        kind: "branch",
        id: "conditional",
        match: "all",
        conditions: [{ rowRef: rows[0]!.rowRef, operator: "equals", value: "Yes" }],
        children: [rows[1]!],
      },
      rows[2]!,
      ...Object.entries(FORM_BUILTINS[module]).map(([rowRef, fieldType]) => ({
        kind: "row" as const,
        id: rowRef,
        rowRef,
        fieldType,
        isRequired: false,
        onIntakeForm: false,
        visibleOnPortal: true,
      })),
    ];
    const written = await h.app.inject({
      method: "PUT",
      url: `/api/v1/${module}-types/${typeId}/form`,
      cookies,
      payload: { form },
    });
    expect(written.statusCode, written.body).toBe(200);
    const options = await h.app.inject({
      method: "GET",
      url: `/api/v1/${plural}/${module === "entity" ? "types" : "options"}`,
      cookies,
    });
    const type = options.json()[`${module}Types`].find((t: { id: string }) => t.id === typeId);
    expect(type.creationForm).toEqual(form.slice(0, pinnedFormRows(module).length + 2));
    const create = (choice: string, answer?: string) =>
      h.app.inject({
        method: "POST",
        url: `/api/v1/${plural}`,
        cookies,
        payload: {
          [module === "entity" ? "legalName" : "title"]: "Branch creation",
          [`${module}TypeId`]: typeId,
          customFields: {
            [rows[0]!.rowRef]: choice,
            ...(answer ? { [rows[1]!.rowRef]: answer } : {}),
          },
        },
      });
    const hidden = await create("No");
    expect(hidden.statusCode, hidden.body).toBe(201);
    const missing = await create("Yes");
    expect(missing.statusCode, missing.body).toBe(400);
    expect(missing.json().detail).toContain("Conditional answer");
    const answered = await create("Yes", "Collected");
    expect(answered.statusCode, answered.body).toBe(201);
    expect(answered.json()[module].customFields[rows[1]!.rowRef]).toBe("Collected");
    if (module === "matter") {
      const [template] = await h.db
        .insert(matterTemplates)
        .values({
          matterTypeId: typeId,
          name: "Branch defaults",
          defaultCustomFields: { [rows[0]!.rowRef]: "Yes", [rows[1]!.rowRef]: "Template answer" },
        })
        .returning();
      const templated = await h.app.inject({
        method: "POST",
        url: "/api/v1/matters",
        cookies,
        payload: {
          title: "From template",
          matterTypeId: typeId,
          templateId: template!.id,
          neededBy: "2026-12-01",
        },
      });
      expect(templated.statusCode, templated.body).toBe(201);
      expect(templated.json().matter.customFields[rows[1]!.rowRef]).toBe("Template answer");
      const dates = await h.app.inject({
        method: "GET",
        url: `/api/v1/matters/${templated.json().matter.number}/key-dates`,
        cookies,
      });
      expect(dates.json().deadlines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Needed by", date: "2026-12-01" }),
        ]),
      );
    }
    const record = hidden.json()[module];
    const read = await h.app.inject({
      method: "GET",
      url: `/api/v1/${plural}/${module === "entity" ? record.id : record.number}`,
      cookies,
    });
    expect(read.json().form).toEqual(form);
  },
);

it("collects Contract built-ins and stores Needed by and Counterparties on the record", async () => {
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies,
    payload: { displayName: "Built-in creation" },
  });
  const id = made.json().contractType.id;
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${id}/form`,
    cookies,
  });
  const original: FormNode[] = read.json().form;
  const expiry = original.find((r) => r.kind === "row" && r.rowRef === "expiry_date")!;
  const form = original
    .filter((r) => r !== expiry)
    .map((r) =>
      r.kind === "row" && ["term_type", "counterparties", "value", "needed_by"].includes(r.rowRef)
        ? { ...r, onIntakeForm: true }
        : r,
    );
  form.push({
    kind: "branch",
    id: "fixed",
    match: "all",
    conditions: [{ rowRef: "term_type", operator: "equals", value: "fixed" }],
    children: [{ ...expiry, isRequired: true } as FormNode],
  });
  const written = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${id}/form`,
    cookies,
    payload: { form },
  });
  expect(written.statusCode, written.body).toBe(200);
  const create = (extra: Record<string, unknown>) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies,
      payload: { title: "Built-in answers", contractTypeId: id, ...extra },
    });
  const evergreen = await create({ termType: "evergreen" });
  expect(evergreen.statusCode, evergreen.body).toBe(201);
  const missing = await create({ termType: "fixed" });
  expect(missing.statusCode, missing.body).toBe(400);
  expect(missing.json().detail).toContain("Expiry date");
  const born = await create({
    termType: "fixed",
    expiryDate: "2027-09-21",
    neededBy: "2026-12-01",
    value: { amount: 12500, currency: "USD", cadence: "one_time" },
    counterparties: [{ name: "Creation party" }],
  });
  expect(born.statusCode, born.body).toBe(201);
  expect(born.json().contract.value).toMatchObject({ amount: 12500, currency: "USD" });
  expect(born.json().contract.primaryCounterparty.name).toBe("Creation party");
  const dates = await h.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${born.json().contract.number}/key-dates`,
    cookies,
  });
  expect(dates.json().deadlines).toEqual(
    expect.arrayContaining([expect.objectContaining({ label: "Needed by", date: "2026-12-01" })]),
  );
});

it("uses the Region identity when a Branch evaluates a stored Region name", async () => {
  const [region] = await h.db
    .insert(regions)
    .values({ slug: "creation-region", displayName: "Creation Region", displayOrder: 99 })
    .returning();
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies,
    payload: { displayName: "Regional creation" },
  });
  const id = made.json().matterType.id;
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/matter-types/${id}/form`,
    cookies,
  });
  const original: FormNode[] = read.json().form;
  const form = original
    .filter((r) => r.kind !== "row" || r.rowRef !== "needed_by")
    .map((r) => (r.kind === "row" && r.rowRef === "region" ? { ...r, onIntakeForm: true } : r));
  form.push({
    kind: "branch",
    id: "region-deadline",
    match: "all",
    conditions: [{ rowRef: "region", operator: "equals", value: region!.id }],
    children: [
      {
        kind: "row",
        id: "needed_by",
        rowRef: "needed_by",
        fieldType: "date",
        isRequired: true,
        visibleOnPortal: true,
      },
    ],
  });
  const written = await h.app.inject({
    method: "PUT",
    url: `/api/v1/matter-types/${id}/form`,
    cookies,
    payload: { form },
  });
  expect(written.statusCode, written.body).toBe(200);
  const missing = await h.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies,
    payload: { title: "Regional matter", matterTypeId: id, region: "creation region" },
  });
  expect(missing.statusCode, missing.body).toBe(400);
  expect(missing.json().detail).toContain("Needed by");
});

it("evaluates Counterparties Branches using the selected registry identities", async () => {
  const [party] = await h.db.insert(counterparties).values({ name: "Branch party" }).returning();
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies,
    payload: { displayName: "Counterparty Branch" },
  });
  const id = made.json().contractType.id;
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${id}/form`,
    cookies,
  });
  const original: FormNode[] = read.json().form;
  const form = original
    .filter((r) => r.kind !== "row" || r.rowRef !== "description")
    .map((r) =>
      r.kind === "row" && r.rowRef === "counterparties" ? { ...r, onIntakeForm: true } : r,
    );
  form.push({
    kind: "branch",
    id: "party-details",
    match: "all",
    conditions: [{ rowRef: "counterparties", operator: "equals", value: party!.id }],
    children: [
      {
        kind: "row",
        id: "description",
        rowRef: "description",
        fieldType: "long_text",
        isRequired: true,
        visibleOnPortal: true,
      },
    ],
  });
  const written = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${id}/form`,
    cookies,
    payload: { form },
  });
  expect(written.statusCode, written.body).toBe(200);
  const payload = {
    title: "Selected party",
    contractTypeId: id,
    counterparties: [{ counterpartyId: party!.id }],
  };
  const missing = await h.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies,
    payload,
  });
  expect(missing.statusCode, missing.body).toBe(400);
  expect(missing.json().detail).toContain("Description");
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies,
    payload: { ...payload, description: "Collected details" },
  });
  expect(created.statusCode, created.body).toBe(201);
  expect(created.json().contract.primaryCounterparty.id).toBe(party!.id);
});
