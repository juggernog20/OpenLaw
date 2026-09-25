// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import { sweepOrSay } from "./helpers.js";

/** Four Contracts let each part of the renewals question exclude a different row. */
export async function createSearchFixture(request: APIRequestContext) {
  const marker = `renewalproof${Date.now()}`;
  const contracts: { number: number; title: string }[] = [];
  let typeId: string | undefined;
  let replacementTypeId: string | undefined;
  const cleanup = async () => {
    const failures: unknown[] = [];
    for (const contract of contracts) {
      try {
        const archived = await request.post(`/api/v1/contracts/${contract.number}/archive`);
        expect(archived.status(), await archived.text()).toBe(200);
      } catch (error) {
        failures.push(error);
      }
    }
    if (typeId) {
      try {
        const archived = await request.post(`/api/v1/contract-types/${typeId}/archive`, {
          data: { reassignToId: replacementTypeId },
        });
        expect(archived.status(), await archived.text()).toBe(200);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Search fixture cleanup failed");
  };
  try {
    const types = await request.get("/api/v1/contract-types");
    expect(types.status(), await types.text()).toBe(200);
    replacementTypeId = z
      .object({ contractTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
      .parse(await types.json())
      .contractTypes.find((type) => type.slug === "other")!.id;
    const catalog = await request.get("/api/v1/fields");
    expect(catalog.status(), await catalog.text()).toBe(200);
    const field = z
      .object({
        fields: z.array(
          z.object({
            id: z.string(),
            slug: z.string(),
            fieldType: z.string(),
            moduleScope: z.string(),
          }),
        ),
      })
      .parse(await catalog.json())
      .fields.find((row) => row.slug === "governing_law" && row.moduleScope === "contract");
    expect(field, "The seeded Governing law Field must be live").toBeDefined();
    const createdType = await request.post("/api/v1/contract-types", {
      data: { displayName: `Search proof ${marker}` },
    });
    expect(createdType.status(), await createdType.text()).toBe(201);
    typeId = z
      .object({ contractType: z.object({ id: z.string() }) })
      .parse(await createdType.json()).contractType.id;
    const formResponse = await request.get(`/api/v1/contract-types/${typeId}/form`);
    expect(formResponse.status(), await formResponse.text()).toBe(200);
    const { form } = z
      .object({ form: z.array(z.record(z.string(), z.unknown())) })
      .parse(await formResponse.json());
    form.push({
      kind: "row",
      id: field!.id,
      rowRef: field!.slug,
      fieldType: field!.fieldType,
      isRequired: false,
      onIntakeForm: false,
      visibleOnPortal: false,
    });
    const attached = await request.put(`/api/v1/contract-types/${typeId}/form`, { data: { form } });
    expect(attached.status(), await attached.text()).toBe(200);

    for (const [label, days, law, description] of [
      ["Renewal target", 30, "Delaware", "A change of control requires written consent."],
      ["Other law", 30, "New York", "A change of control requires written consent."],
      ["Later expiry", 180, "Delaware", "A change of control requires written consent."],
      ["Other clause", 30, "Delaware", "Assignment requires written consent."],
    ] as const) {
      const expiry = new Date();
      expiry.setUTCDate(expiry.getUTCDate() + days);
      const created = await request.post("/api/v1/contracts", {
        data: {
          title: `${label} ${marker}`,
          contractTypeId: typeId,
          description,
          termType: "fixed",
          expiryDate: expiry.toISOString().slice(0, 10),
          customFields: { governing_law: law },
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      contracts.push(
        z
          .object({ contract: z.object({ number: z.number(), title: z.string() }) })
          .parse(await created.json()).contract,
      );
    }
    return { marker, target: contracts[0]!, cleanup };
  } catch (error) {
    await sweepOrSay("search fixture setup", cleanup);
    throw error;
  }
}

export async function buildRenewalsQuestion(page: Page, marker: string) {
  const dialog = page.getByRole("dialog", { name: "Advanced search", exact: true });
  const preview = dialog.getByRole("region", { name: "Preview" });
  await dialog.getByLabel("All of these words", { exact: true }).fill(marker);
  await dialog.getByRole("button", { name: "Contract", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "4 matches", exact: true })).toBeVisible();
  await dialog.getByLabel("This exact phrase").fill("change of control");
  await expect(preview.getByRole("heading", { name: "3 matches", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await page.getByRole("button", { name: "Expiry date", exact: true }).click();
  const expiry = dialog.getByRole("group", {
    name: "Contract Expiry date condition",
    exact: true,
  });
  await expiry.getByLabel("Operator").selectOption("in_next_days");
  await expiry.getByLabel("Number of days").fill("90");
  await expect(preview.getByRole("heading", { name: "2 matches", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await page.getByRole("button", { name: "Governing law", exact: true }).click();
  const law = dialog.getByRole("group", { name: "Contract Governing law condition", exact: true });
  await law.getByLabel("Operator").selectOption("contains");
  await law.getByLabel("Value", { exact: true }).fill("Delaware");
  await expect(preview.getByRole("heading", { name: "1 match", exact: true })).toBeVisible();
  return dialog;
}
