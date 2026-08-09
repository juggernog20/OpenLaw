// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Theme switching end to end (#44): the user-menu switcher applies the
 * theme instantly via the root data-theme attribute, the choice
 * persists on the user record across a reload, computed chrome colors
 * follow the token layer, and pre-login screens are always Light.
 */

import { test, expect, type Page } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs, signOut } from "./helpers.js";

/** The header background per theme — bg-inverted from styles/themes/. */
const HEADER_BG = {
  warm: "rgb(232, 224, 208)", // #E8E0D0
  dark: "rgb(1, 4, 9)", // #010409
  light: "rgb(13, 17, 23)", // #0D1117
} as const;

async function switchTheme(page: Page, label: "Light" | "Warm" | "Dark"): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

const rootTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

const headerBg = (page: Page) =>
  page.getByRole("banner").evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe.serial("theme switching", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("switching applies instantly and survives a reload", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Warm: instant root attribute, token-driven computed chrome color.
    await switchTheme(page, "Warm");
    await expect.poll(() => rootTheme(page)).toBe("warm");
    expect(await headerBg(page)).toBe(HEADER_BG.warm);

    // Persisted on the user record: a full reload comes back Warm.
    await page.reload();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect.poll(() => rootTheme(page)).toBe("warm");
    expect(await headerBg(page)).toBe(HEADER_BG.warm);

    // And Dark, the same round trip.
    await switchTheme(page, "Dark");
    await expect.poll(() => rootTheme(page)).toBe("dark");
    expect(await headerBg(page)).toBe(HEADER_BG.dark);

    await page.reload();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect.poll(() => rootTheme(page)).toBe("dark");
    expect(await headerBg(page)).toBe(HEADER_BG.dark);
  });

  test("pre-login screens render Light even for a Dark user", async ({ page }) => {
    // The previous test left the Administrator on Dark.
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await expect.poll(() => rootTheme(page)).toBe("dark");

    await signOut(page, ADMIN.displayName);
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect.poll(() => rootTheme(page)).toBe("light");

    // Leave the shared Administrator on the default theme: this suite
    // runs against a never-reset instance (TECH-018), and the theme
    // rides the user record across runs.
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await switchTheme(page, "Light");
    await expect.poll(() => rootTheme(page)).toBe("light");
    expect(await headerBg(page)).toBe(HEADER_BG.light);
  });
});
