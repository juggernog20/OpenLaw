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

  // The record is the DES-087 builder: the file arrives through the
  // upload dialog, and each field is edited on its own card. Every
  // commit writes a form version, so none of them is asserted by number.
  await page.getByRole("link", { name: "Form", exact: true }).click();
  await page.getByRole("button", { name: "Upload version", exact: true }).click();
  const upload = page.getByRole("dialog");
  await upload
    .getByLabel("Word template", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../../apps/api/src/testing/fixtures/auto-docs/plain.docx", import.meta.url),
      ),
    );
  await upload.getByRole("button", { name: "Upload", exact: true }).click();
  await upload.getByRole("button", { name: "Close", exact: true }).click();

  const fields = page.getByRole("region", { name: "Fields", exact: true });
  await fields.getByRole("button", { name: "Edit Counterparty name", exact: true }).click();
  const counterparty = page.getByRole("region", { name: "Counterparty name", exact: true });
  // Required first: renaming the field renames its card with it, so the
  // locator above stops matching the moment the label commits.
  await counterparty.getByRole("checkbox", { name: "Required", exact: true }).click();
  await expect(counterparty.getByRole("checkbox", { name: "Required", exact: true })).toBeChecked();
  await counterparty.getByLabel("Label", { exact: true }).fill("Counterparty");
  await counterparty.getByLabel("Label", { exact: true }).blur();
  await expect(page.getByRole("region", { name: "Counterparty", exact: true })).toBeVisible();
  await fields.getByRole("button", { name: "Edit Signing date", exact: true }).click();
  const date = page.getByRole("region", { name: "Signing date", exact: true });
  await date.getByRole("combobox", { name: "Type", exact: true }).selectOption("date");
  await expect(fields.getByText("signing_date · Date", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
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
  // The builder's sub-bar carries the Auto-Doc's name, so the heading is
  // the action alone.
  await expect(page.getByRole("heading", { name: "Generate", exact: true })).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText("Ready", { timeout: 60_000 });
  const download = page.getByRole("link", { name: "Download Word", exact: true });
  const file = await page.request.get((await download.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("wordprocessingml.document");
  expect((await file.body()).subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-Generation")).toEqual([]);
  // The builder's sub-bar is the way back, and it carries the Auto-Doc's
  // own name rather than a generic label.
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page).toHaveURL(recordUrl);
  const generations = page.getByRole("region", { name: "Generations", exact: true });
  await expect(generations).toContainText(ADMIN.displayName);
  // Every commit writes a form version, so the number is not fixed.
  await expect(generations).toContainText(/File version 1, form version \d+/);
  await expect(generations.getByRole("link", { name: "Download Word", exact: true })).toBeVisible();
});
