// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal keeps answers through Unpublish, then generates and downloads the approved Word file", async ({
  page,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.goto("/auto-docs");
  const name = `Generated NDA ${Date.now()}`;
  await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const recordUrl = page.url();
  const id = recordUrl.split("/").at(-1)!;
  await page
    .getByLabel("Word template", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../../apps/api/src/testing/fixtures/auto-docs/plain.docx", import.meta.url),
      ),
    );
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  const counterparty = page.getByRole("group", { name: "counterparty_name", exact: true });
  await expect(counterparty).toBeVisible();
  await counterparty.getByLabel("Label", { exact: true }).fill("Counterparty");
  await counterparty.getByLabel("Required", { exact: true }).check();
  const date = page.getByRole("group", { name: "signing_date", exact: true });
  await date.getByRole("combobox", { name: "Type", exact: true }).selectOption("date");
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Form versions", exact: true })
      .getByText("Form version 2", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("link", { name: "Generate", exact: true })).toBeVisible();
  const read = await page.request.get(`/api/v1/auto-docs/${id}`);
  const pinned = z
    .object({
      autoDoc: z.object({
        publishedDocumentVersionId: z.string(),
        publishedFormVersionId: z.string(),
      }),
    })
    .parse(await read.json()).autoDoc;
  await page.getByRole("link", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Generate ${name}`, exact: true })).toBeVisible();
  await page.getByLabel("Counterparty", { exact: true }).fill("Acme & Sons");
  await page.getByLabel("Signing date", { exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "Choose a date" });
  await calendar.getByRole("combobox", { name: "Year", exact: true }).selectOption("2026");
  await calendar.getByRole("combobox", { name: "Month", exact: true }).selectOption("8");
  await calendar.getByRole("button", { name: /September 14th, 2026/ }).click();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-form")).toEqual([]);
  expect(
    (await page.request.post(`/api/v1/auto-docs/${id}/unpublish`, { data: {} })).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not published");
  await expect(page.getByLabel("Counterparty", { exact: true })).toHaveValue("Acme & Sons");
  expect(
    (
      await page.request.post(`/api/v1/auto-docs/${id}/publish`, {
        data: {
          documentVersionId: pinned.publishedDocumentVersionId,
          formVersionId: pinned.publishedFormVersionId,
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Generation", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Ready");
  const download = page.getByRole("link", { name: "Download Word", exact: true });
  const file = await page.request.get((await download.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("wordprocessingml.document");
  expect((await file.body()).subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-Generation")).toEqual([]);
  await page.getByRole("link", { name: "Back to Auto-Doc", exact: true }).click();
  await expect(page).toHaveURL(recordUrl);
  const generations = page.getByRole("region", { name: "Generations", exact: true });
  await expect(generations).toContainText(ADMIN.displayName);
  await expect(generations).toContainText("File version 1, form version 2");
  await expect(generations.getByRole("link", { name: "Download Word", exact: true })).toBeVisible();
});
