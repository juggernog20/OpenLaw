// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test("both AI prompt cards show format guidance in delayed label tooltips", async ({
  page,
  request,
}) => {
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.goto("/settings/ai-analysis");
  for (const name of ["Matter and Contract conversion prompts", "Contract analysis prompts"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const card = page.getByRole("region", { name, exact: true });
    const inputs = card.getByRole("textbox");
    await expect(inputs).toHaveCount(name.startsWith("Matter") ? 5 : 7);
    for (const input of await inputs.all()) {
      await expect(input).toBeEditable();
      await expect(input).toHaveAccessibleDescription(/^Return .+\.$/);
    }
    for (const hint of await card.getByText(/^Return .+\.$/).all()) await expect(hint).toBeHidden();
    await expect(card.getByText(/greyed sentence/)).toHaveCount(0);
  }
  const date = page.getByRole("textbox", { name: "Effective date prompt", exact: true });
  await expect(date).toBeVisible();
  await expect(date).toHaveAccessibleDescription("Return a date as YYYY-MM-DD.");
  const help = page
    .locator("label[for='ai-field-prompt-effective_date']")
    .locator("..")
    .getByRole("button", { name: "More information" });
  await help.hover();
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(page.getByRole("tooltip")).toHaveText("Return a date as YYYY-MM-DD.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
});
