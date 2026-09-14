// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal uploads a template, edits its form, and retains orphaned fields on re-upload", async ({
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
  const fixture = (file: string) =>
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/auto-docs/${file}.docx`, import.meta.url),
    );
  await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture("plain"));
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open version 1", exact: true })).toBeVisible();
  const date = page.getByRole("group", { name: "signing_date", exact: true });
  await date.getByRole("combobox", { name: "Type", exact: true }).selectOption("date");
  await date.getByLabel("Help text", { exact: true }).fill("Use the agreed date.");
  await date.getByLabel("Required", { exact: true }).check();
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Form versions", exact: true })
      .getByText("Form version 2", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture("formatting"));
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open version 2", exact: true })).toBeVisible();
  await expect(page.getByText("1 orphaned field", { exact: true })).toBeVisible();
  await expect(
    date.getByText("This field no longer has a Placeholder in the template.", { exact: true }),
  ).toBeVisible();
  await expect(date.getByRole("combobox", { name: "Type", exact: true })).toHaveValue("date");
  await expect(page.getByRole("group", { name: "amount", exact: true })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-editor")).toEqual([]);
  await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture("unclosed-block"));
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("{{#block arbitration}}");
  await expect(page.getByRole("button", { name: "Open version 3", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open version 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close the document", exact: true })).toBeVisible();
});
