// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal publishes one pair, sees a stale Clause refusal, and restores an archived Auto-Doc", async ({
  page,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.goto("/auto-docs");
  const name = `Publication NDA ${Date.now()}`;
  await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const recordUrl = page.url();
  const fixture = (file: string) =>
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/auto-docs/${file}.docx`, import.meta.url),
    );
  await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture("blocks"));
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  const seat = page.getByRole("group", { name: "seat", exact: true });
  await expect(seat).toBeVisible();
  await seat
    .getByRole("combobox", { name: "Map to", exact: true })
    .selectOption("attribute:region");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  const field = page.getByRole("group", { name: "field_1", exact: true });
  await field.getByLabel("Slug", { exact: true }).fill("jurisdiction");
  const jurisdiction = page.getByRole("group", { name: "jurisdiction", exact: true });
  await jurisdiction
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("single_select");
  await jurisdiction.getByLabel("Options, one per line", { exact: true }).fill("US\nUK");
  const clause = page.getByRole("group", { name: "arbitration", exact: true });
  await clause
    .getByRole("combobox", { name: "Include this Block", exact: true })
    .selectOption("conditional");
  await clause
    .getByRole("combobox", { name: "Form field", exact: true })
    .selectOption("jurisdiction");
  await clause.getByRole("combobox", { name: "Operator", exact: true }).selectOption("is_one_of");
  await clause.getByRole("listbox", { name: "Value", exact: true }).selectOption(["US", "UK"]);
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Form versions", exact: true })
      .getByText("Form version 2", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Live: file version 1 and form version 2.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare forms", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Version comparisons", exact: true })
      .getByText("Added jurisdiction", { exact: false }),
  ).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-publication")).toEqual([]);
  await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture("plain"));
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open version 2", exact: true })).toBeVisible();
  await expect(
    page.getByText("Live: file version 1 and form version 2.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText('Clause rule "arbitration"');
  await clause
    .getByRole("combobox", { name: "Include this Block", exact: true })
    .selectOption("always");
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Form versions", exact: true })
      .getByText("Form version 4", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Live: file version 2 and form version 4.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare files", exact: true })).toHaveAttribute(
    "href",
    /\/documents\/[^/]+\/compare\?from=.+&to=.+/,
  );
  await page.getByRole("link", { name: "Compare files", exact: true }).click();
  await expect(page.getByRole("region", { name: "Compared document", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("link", { name: "Close comparison", exact: true }).click();
  await expect(page).toHaveURL(recordUrl);
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(
    page.getByText("No file and form pair is published.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await page.goto("/auto-docs");
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await page.goto(recordUrl);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
});
