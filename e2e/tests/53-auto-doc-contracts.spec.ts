// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { z } from "zod";
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
  const { contractType: type } = z
    .object({ contractType: z.object({ id: z.string() }) })
    .parse(await madeType.json());
  await page.goto("/auto-docs");
  await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Form", exact: true }).click();
  await page.getByRole("button", { name: "Upload version", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Word template", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../../apps/api/src/testing/fixtures/auto-docs/directives.docx", import.meta.url),
      ),
    );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("File version 1");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const fields = page.getByRole("region", { name: "Fields", exact: true });
  await fields.getByRole("button", { name: "Edit Counterparty name", exact: true }).click();
  await page
    .getByRole("region", { name: "Counterparty name", exact: true })
    .getByRole("combobox", { name: "Map to", exact: true })
    .selectOption("attribute:counterparties");
  await expect(
    fields
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Edit Counterparty name", exact: true }) })
      .getByText("Text · Primary Counterparty name", { exact: true }),
  ).toBeVisible();
  await fields.getByRole("button", { name: "Edit Amount", exact: true }).click();
  const amount = page.getByRole("region", { name: "Amount", exact: true });
  await amount
    .getByRole("combobox", { name: "Map to", exact: true })
    .selectOption("attribute:value");
  await amount.getByRole("combobox", { name: "Currency", exact: true }).selectOption("USD");
  await amount.getByRole("combobox", { name: "Cadence", exact: true }).selectOption("annually");
  await expect(amount.getByRole("combobox", { name: "Cadence", exact: true })).toHaveValue(
    "annually",
  );
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const creation = page.getByRole("region", { name: "Contract creation", exact: true });
  await creation
    .getByRole("combobox", { name: "Target Contract Type", exact: true })
    .selectOption(type.id);
  await creation.getByLabel("Title pattern", { exact: true }).fill("NDA - {{counterparty_name}}");
  await creation.getByLabel("Title pattern", { exact: true }).press("Enter");
  await expect(creation.getByText("Saved", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("region", { name: "Output", exact: true })
    .getByRole("combobox", { name: "Formats", exact: true })
    .selectOption("docx");
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-Contract-settings")).toEqual([]);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
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
  const { contract } = z
    .object({
      contract: z.object({
        value: z.object({ amount: z.number(), currency: z.string(), cadence: z.string() }),
        businessOwner: z.object({ displayName: z.string() }),
      }),
    })
    .parse(await detail.json());
  expect(contract.value).toEqual({ amount: 1234567, currency: "USD", cadence: "annually" });
  expect(contract.businessOwner.displayName).toBe(ADMIN.displayName);
  const papers = await page.request.get(`/api/v1${contractPath}/documents`);
  expect(papers.status()).toBe(200);
  const { documents } = z
    .object({
      documents: z.array(
        z.object({
          id: z.string(),
          isPrimary: z.boolean(),
          versions: z
            .array(
              z.object({
                id: z.string(),
                kind: z.string(),
                source: z.string(),
                versionNumber: z.number(),
              }),
            )
            .min(1),
        }),
      ),
    })
    .parse(await papers.json());
  const primary = documents.find((document) => document.isPrimary);
  expect(primary, "The generated Contract has a primary Document").toBeDefined();
  if (!primary) throw new Error("The generated Contract has no primary Document.");
  expect(primary.versions[0]).toMatchObject({
    kind: "draft_ours",
    source: "generated",
    versionNumber: 1,
  });
  const primaryWord = await page.request.get(
    `/api/v1/documents/${primary.id}/versions/${primary.versions[0]!.id}/download`,
  );
  expect(primaryWord.status()).toBe(200);
  expect(await primaryWord.body()).toEqual(await word.body());
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-Contract-confirmation")).toEqual([]);
  await contractLink.click();
  await expect(
    page.getByRole("heading", { name: `NDA - ${counterpartyName}`, exact: true }),
  ).toBeVisible();
});
