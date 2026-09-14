// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal targets a Contract Type and generates its draft Contract with a primary Word Document", async ({
  page,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const currency = await page.request.post("/api/v1/org/currencies", { data: { code: "USD" } });
  expect(currency.status()).toBe(200);
  const name = `Target NDA ${Date.now()}`;
  const madeType = await page.request.post("/api/v1/contract-types", {
    data: { displayName: name },
  });
  expect(madeType.status()).toBe(201);
  const type = (await madeType.json()).contractType;
  await page.goto("/auto-docs");
  await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByLabel("Word template", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../../apps/api/src/testing/fixtures/auto-docs/directives.docx", import.meta.url),
      ),
    );
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  const counterparty = page.getByRole("group", { name: "counterparty_name", exact: true });
  await counterparty
    .getByRole("combobox", { name: "Map to", exact: true })
    .selectOption("attribute:primary_counterparty_name");
  const amount = page.getByRole("group", { name: "amount", exact: true });
  await amount
    .getByRole("combobox", { name: "Map to", exact: true })
    .selectOption("attribute:value");
  await amount.getByRole("combobox", { name: "Value currency", exact: true }).selectOption("USD");
  await amount
    .getByRole("combobox", { name: "Value cadence", exact: true })
    .selectOption("annually");
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  await expect(page.getByText("Form saved.", { exact: true })).toBeVisible();
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings
    .getByRole("combobox", { name: "Target Contract Type", exact: true })
    .selectOption(type.id);
  await settings.getByLabel("Title pattern", { exact: true }).fill("NDA - {{counterparty_name}}");
  await settings.getByRole("combobox", { name: "Formats", exact: true }).selectOption("docx");
  await settings.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(settings.getByText("Settings saved.", { exact: true })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-Contract-settings")).toEqual([]);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("link", { name: "Generate", exact: true }).click();
  const counterpartyName = `Acme Target ${Date.now()}`;
  await page.getByLabel("Counterparty name", { exact: true }).fill(counterpartyName);
  await page.getByLabel("Amount", { exact: true }).fill("12345.67");
  await page
    .getByRole("combobox", { name: "Business Owner", exact: true })
    .selectOption({ label: ADMIN.displayName });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Generation", exact: true })).toBeVisible();
  const contractLink = page.getByRole("link", { name: `NDA - ${counterpartyName}`, exact: true });
  await expect(contractLink).toBeVisible();
  const contractPath = (await contractLink.getAttribute("href"))!;
  const word = await page.request.get(
    (await page.getByRole("link", { name: "Download Word", exact: true }).getAttribute("href"))!,
  );
  expect(word.status()).toBe(200);
  const detail = await page.request.get(`/api/v1${contractPath}`);
  expect(detail.status()).toBe(200);
  const contract = (await detail.json()).contract;
  expect(contract.value).toEqual({ amount: 1234567, currency: "USD", cadence: "annually" });
  expect(contract.businessOwner.displayName).toBe(ADMIN.displayName);
  const papers = await page.request.get(`/api/v1${contractPath}/documents`);
  expect(papers.status()).toBe(200);
  const primary = (await papers.json()).documents.find(
    (document: { isPrimary: boolean }) => document.isPrimary,
  );
  expect(primary.versions[0]).toMatchObject({
    kind: "draft_ours",
    source: "generated",
    versionNumber: 1,
  });
  const primaryWord = await page.request.get(
    `/api/v1/documents/${primary.id}/versions/${primary.versions[0].id}/download`,
  );
  expect(primaryWord.status()).toBe(200);
  expect(await primaryWord.body()).toEqual(await word.body());
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-Contract-confirmation")).toEqual([]);
  await contractLink.click();
  await expect(
    page.getByRole("heading", { name: `NDA - ${counterpartyName}`, exact: true }),
  ).toBeVisible();
});
