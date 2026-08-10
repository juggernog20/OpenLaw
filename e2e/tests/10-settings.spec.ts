// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (#62): reached from the avatar menu, the
 * rail carries the Personal group only, and the Appearance pane is the
 * theme's home — a pick applies instantly and persists on the user
 * record across a reload. Deeper theme mechanics (chrome colors,
 * pre-login Light) stay in 06; this spec proves the destination.
 */

import { test, expect, type Page } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs, switchTheme } from "./helpers.js";

const rootTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test.describe.serial("the settings destination", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  // The suite runs against a never-reset instance (TECH-018): leave the
  // shared Administrator on the default theme even after a failure.
  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return;
    const menuButton = page.getByRole("banner").getByRole("button", { name: ADMIN.displayName });
    if (!(await menuButton.isVisible().catch(() => false))) return;
    if ((await rootTheme(page)) === "light") return;
    await switchTheme(page, ADMIN.displayName, "Light");
    await expect.poll(() => rootTheme(page)).toBe("light");
  });

  test("a signed-out visit to /settings bounces to login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test("avatar menu → Appearance; a theme pick applies now and survives a reload", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The avatar menu is the way in (SET-001) — and no longer switches
    // the theme itself.
    await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Settings" }).click();

    // The index URL forwards to the first live pane.
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page).toHaveTitle("Appearance · OpenLaw");

    // The rail: Personal group only — no Organization entries yet.
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await expect(rail.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(rail.getByText("Organization")).toHaveCount(0);

    // Picking Warm applies the moment it is chosen — no save ceremony.
    // Await the preference PATCH too, so the reload below cannot race
    // the persistence riding behind the instant paint.
    const persisted = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/me/preferences") &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("radio", { name: "Warm" }).check();
    await expect.poll(() => rootTheme(page)).toBe("warm");
    await persisted;

    // Persisted via the preference: a full reload comes back Warm, with
    // the pane's radio reflecting the stored choice.
    await page.reload();
    await expect(page.getByRole("radio", { name: "Warm" })).toBeChecked();
    await expect.poll(() => rootTheme(page)).toBe("warm");

    // The stubbed Profile entry routes to its own URL.
    await rail.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page).toHaveTitle("Profile · OpenLaw");
  });
});
