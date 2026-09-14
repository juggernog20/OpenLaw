// SPDX-License-Identifier: AGPL-3.0-only

/** DES-087: the builder. Upload in a dialog, edit from the field card, keep the orphan cue. */
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal uploads a template, edits its form from the card, and retains orphaned fields on re-upload", async ({
  page,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const name = `Supplier NDA ${Date.now()}`;
  await page.goto("/auto-docs");
  await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Supplier template editor journey");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Form", exact: true }).click();
  const fixture = (file: string) =>
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/auto-docs/${file}.docx`, import.meta.url),
    );
  async function upload(file: string) {
    await page.getByRole("button", { name: "Upload version", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Word template", { exact: true }).setInputFiles(fixture(file));
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    return dialog;
  }
  let dialog = await upload("plain");
  await expect(dialog.getByRole("status")).toContainText("File version 1");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Placeholder signing_date", exact: true }),
  ).toBeVisible();
  const fields = page.getByRole("region", { name: "Fields", exact: true });
  await fields.getByRole("button", { name: "Edit signing date", exact: true }).click();
  const card = page.getByRole("region", { name: "signing date", exact: true });
  await card.getByRole("combobox", { name: "Type", exact: true }).selectOption("date");
  await expect(fields.getByText("signing_date · Date", { exact: true })).toBeVisible();
  await card.getByLabel("Help text", { exact: true }).fill("Use the agreed date.");
  await card.getByLabel("Help text", { exact: true }).blur();
  await card.getByRole("checkbox", { name: "Required", exact: true }).click();
  await expect(card.getByRole("checkbox", { name: "Required", exact: true })).toBeChecked();
  expect(page.getByRole("button", { name: "Save form", exact: true })).toHaveCount(0);
  dialog = await upload("formatting");
  await expect(dialog.getByRole("status")).toContainText("1 field has no Placeholder now.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(fields.getByText("1 orphaned", { exact: true })).toBeVisible();
  await expect(fields.getByText("No Placeholder in file version 2", { exact: true })).toBeVisible();
  await expect(fields.getByText("amount", { exact: true })).toBeVisible();
  await fields.getByRole("button", { name: "Edit signing date", exact: true }).click();
  await expect(card.getByRole("combobox", { name: "Type", exact: true })).toHaveValue("date");
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-editor")).toEqual([]);
  dialog = await upload("unclosed-block");
  await expect(dialog.getByRole("alert")).toContainText("{{#block arbitration}}");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("File version 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Earlier versions (1)", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Close the document", exact: true })).toBeVisible();
});
