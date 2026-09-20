// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test("both AI prompt cards show the fixed format below each editable prompt", async ({
  page,
  request,
}) => {
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.goto("/settings/ai-analysis");
  for (const name of ["Matter and Contract conversion prompts", "Contract analysis prompts"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const card = page.getByRole("region", { name, exact: true });
    await expect(card.getByText("The greyed sentence is fixed by the Field's type.")).toBeVisible();
    const inputs = card.getByRole("textbox");
    await expect(inputs).toHaveCount(name.startsWith("Matter") ? 5 : 7);
    for (const input of await inputs.all()) {
      const descriptionId = await input.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      const sentence = page.locator(`[id="${descriptionId}"]`);
      await expect(sentence).toBeVisible();
      await expect(sentence).toHaveClass(/text-muted/);
      expect(
        await sentence.evaluate((element) => ({
          tag: element.tagName,
          editable: element instanceof HTMLElement && element.isContentEditable,
          previous: element.previousElementSibling?.tagName,
        })),
      ).toMatchObject({ tag: "P", editable: false, previous: "TEXTAREA" });
    }
  }
  const date = page.getByRole("textbox", { name: "Effective date prompt", exact: true });
  await expect(date).toHaveValue("Extract the Contract's effective date.");
  await expect(date).toHaveAccessibleDescription("Return a date as YYYY-MM-DD.");
});
