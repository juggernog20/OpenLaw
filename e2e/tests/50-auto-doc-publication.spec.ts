// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

// A real Word comparison runs through the doc-engine, which journeys 39
// budget 180s for. This journey waits on one after a full publish run.
test.setTimeout(300_000);
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
  await page.getByRole("link", { name: /^Form/ }).click();
  const fixture = (file: string) =>
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/auto-docs/${file}.docx`, import.meta.url),
    );
  async function upload(file: string) {
    await page.getByRole("button", { name: "Upload version", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Word template", { exact: true }).setInputFiles(fixture(file));
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("File version");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  async function publish() {
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    return dialog;
  }
  await upload("blocks");
  const fields = page.getByRole("region", { name: "Fields", exact: true });
  await fields.getByRole("button", { name: "Edit Seat", exact: true }).click();
  await page
    .getByRole("region", { name: "Seat", exact: true })
    .getByRole("combobox", { name: "Map to", exact: true })
    .selectOption("attribute:region");
  await expect(fields.getByText("seat · Text · Region", { exact: true })).toBeVisible();
  await fields.getByRole("button", { name: "Add field", exact: true }).click();
  const added = page.getByRole("region", { name: "New field", exact: true });
  await added.getByLabel("Slug", { exact: true }).fill("jurisdiction");
  await added.getByLabel("Slug", { exact: true }).press("Enter");
  await expect(fields.getByText("jurisdiction · Text", { exact: true })).toBeVisible();
  await added.getByLabel("Label", { exact: true }).fill("Jurisdiction");
  await added.getByLabel("Label", { exact: true }).press("Enter");
  const jurisdiction = page.getByRole("region", { name: "Jurisdiction", exact: true });
  await jurisdiction
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("single_select");
  await jurisdiction.getByLabel("Options", { exact: true }).fill("US\nUK");
  await jurisdiction.getByLabel("Options", { exact: true }).blur();
  await expect(fields.getByText("jurisdiction · Single select", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit the rule for arbitration", exact: true }).click();
  const rule = page.getByRole("region", { name: "arbitration", exact: true });
  await rule.getByRole("combobox", { name: "Include", exact: true }).selectOption("conditional");
  await rule
    .getByRole("combobox", { name: "Form field", exact: true })
    .selectOption("jurisdiction");
  await rule.getByRole("combobox", { name: "Operator", exact: true }).selectOption("is_one_of");
  await rule.getByRole("listbox", { name: "Value", exact: true }).selectOption(["US", "UK"]);
  await expect(
    page.getByText("Included when Jurisdiction is one of US, UK", { exact: true }),
  ).toBeVisible();
  await publish();
  await expect(page.getByRole("link", { name: "Generate", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByText(/^Live since .*: file version 1, form version \d+\.$/)).toBeVisible();
  await page.getByRole("link", { name: /^Form/ }).click();
  await page.getByRole("button", { name: "Compare versions", exact: true }).click();
  // Every commit wrote a version; the first form is the one without the field.
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Form version 1" });
  await expect(
    page.getByRole("dialog").getByText("Added jurisdiction", { exact: false }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-publication")).toEqual([]);
  await upload("plain");
  await expect(page.getByText("File version 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Not in file version 2", { exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Auto-Doc actions", exact: true });
  await menu.click();
  await page.getByRole("menuitem", { name: "Publish new pair", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText('Clause rule "arbitration"');
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit the rule for arbitration", exact: true }).click();
  await rule.getByRole("combobox", { name: "Include", exact: true }).selectOption("always");
  // A Block the file lacks and no rule names has no row to keep.
  await expect(page.getByText("Not in file version 2", { exact: true })).toHaveCount(0);
  await menu.click();
  await page.getByRole("menuitem", { name: "Publish new pair", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByText(/^Live since .*: file version 2, form version \d+\.$/)).toBeVisible();
  await page.getByRole("link", { name: /^Form/ }).click();
  await expect(page.getByRole("link", { name: "Compare files", exact: true })).toHaveAttribute(
    "href",
    /\/documents\/[^/]+\/compare\?from=.+&to=.+/,
  );
  await page.getByRole("link", { name: "Compare files", exact: true }).click();
  await expect(page.getByRole("region", { name: "Compared document", exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await page.getByRole("link", { name: "Close comparison", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`^${recordUrl.replaceAll("/", "\\/")}(\\/form)?$`));
  await menu.click();
  await page.getByRole("menuitem", { name: "Unpublish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish", exact: true }).first()).toBeVisible();
  await menu.click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await page.goto("/auto-docs");
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await page.goto(recordUrl);
  await menu.click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish", exact: true }).first()).toBeVisible();
});
