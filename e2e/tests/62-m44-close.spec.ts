// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs, sweepOrSay } from "./helpers.js";
import { buildRenewalsQuestion, createSearchFixture } from "./search-fixture.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("M44: build Renewals, save, reload, reopen from the header, and land on the Contract", async ({
  page,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  page.setDefaultTimeout(15_000);
  const fixture = await createSearchFixture(page.request);
  let savedId: string | undefined;
  const cleanup = async () => {
    try {
      if (savedId) {
        const removed = await page.request.delete(`/api/v1/list-views/${savedId}`);
        expect(removed.status(), await removed.text()).toBe(200);
      }
    } finally {
      await fixture.cleanup();
    }
  };
  try {
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Advanced search", exact: true })
      .click();
    const dialog = await buildRenewalsQuestion(page, fixture.marker);
    await dialog.getByRole("button", { name: "Save search", exact: true }).click();
    const naming = page.getByRole("dialog", { name: "Save this search" });
    // Per-run name: a killed run leaves its row behind, and a repeated
    // name would be refused with 409 on the next run.
    const savedName = `Renewals ${fixture.marker}`;
    await naming.getByLabel("Name", { exact: true }).fill(savedName);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/list-views") && response.request().method() === "POST",
    );
    await naming.getByRole("button", { name: "Save", exact: true }).click();
    const response = await saved;
    expect(response.status(), await response.text()).toBe(201);
    savedId = z
      .object({ views: z.array(z.object({ id: z.string(), name: z.string() })) })
      .parse(await response.json())
      .views.find((view) => view.name === savedName)!.id;
    await expect(naming).not.toBeVisible();
    await dialog.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?aq=/);
    const questionUrl = page.url();
    await expect(page.getByRole("main").getByText("1 match", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(questionUrl);
    await expect(
      page.getByRole("button", { name: /Edit Contract Governing law contains Delaware/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Edit Contract Expiry date in the next 90 days/ }),
    ).toBeVisible();

    await page.goto("/");
    const header = page.getByRole("banner").getByRole("combobox", { name: "Search", exact: true });
    await expect(header).toHaveValue("");
    await header.focus();
    const entries = page.getByRole("listbox", { name: "Search results" });
    await expect(entries.getByRole("group", { name: "Recent" })).toBeVisible();
    await entries
      .getByRole("group", { name: "Saved" })
      .getByRole("option", { name: savedName, exact: true })
      .click();
    await expect(page).toHaveURL(questionUrl);
    await expect(page.getByRole("main").getByText("1 match", { exact: true })).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: fixture.target.title })
      .click();
    await expect(page).toHaveURL(new RegExp(`/contracts/${fixture.target.number}$`));
    await expect(
      page.getByRole("heading", { name: fixture.target.title, exact: true }),
    ).toBeVisible();
  } catch (error) {
    await sweepOrSay("M44 close journey", cleanup);
    throw error;
  }
  await cleanup();
});
