// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test("both AI prompt cards show editable prompts and no code-owned format note", async ({
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
      await expect(input).not.toHaveAttribute("aria-describedby", /.+/);
    }
    await expect(card.getByText(/^Return .+\.$/)).toHaveCount(0);
    await expect(card.getByText(/greyed sentence/)).toHaveCount(0);
  }
  const date = page.getByRole("textbox", { name: "Effective date prompt", exact: true });
  await expect(date).toBeVisible();
  await expect(date).not.toHaveAccessibleDescription(/Return a date/);
});
