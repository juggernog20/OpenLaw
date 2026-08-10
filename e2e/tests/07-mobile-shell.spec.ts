// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mobile shell (DES-012, #46): below 768px the top nav collapses into
 * the hamburger drawer, modals go full-screen, and nothing overflows
 * horizontally down to 375px. At md and above the desktop chrome is
 * untouched — the hamburger stays out of the way.
 */

import { test, expect, type Page } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

/** True when the page cannot be scrolled sideways. */
async function hasNoHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
}

test.describe("mobile shell below 768px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger drawer navigates; no horizontal overflow", async ({ page, request }) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The desktop top nav is gone; the hamburger stands in for it.
    await expect(page.getByRole("navigation")).toBeHidden();
    const hamburger = page.getByRole("button", { name: "Open navigation" });
    await expect(hamburger).toBeVisible();

    // The workspace crumb yields to search; the search box survives.
    await expect(page.getByRole("banner").getByText("workspace")).toBeHidden();
    await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();

    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    // Open the drawer, navigate to Home: the drawer closes and the
    // page lands where the destination points.
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    await drawer.getByRole("link", { name: "Home" }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    expect(await hasNoHorizontalOverflow(page)).toBe(true);
  });

  test("an open drawer closes when the viewport crosses up into md", async ({ page, request }) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    // Tablet rotation: the drawer must not keep its focus trap and
    // scroll lock over the desktop chrome.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  test("modals render full-screen", async ({ page, request }) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The `?` cheat-sheet (#45) is the shell's one modal today.
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: 375, height: 812 });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("desktop chrome at 768px and above", () => {
  // Exactly 768px: the md boundary itself must already be desktop.
  test.use({ viewport: { width: 768, height: 812 } });

  test("the hamburger stays hidden; the top nav renders", async ({ page, request }) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByRole("banner").getByText("workspace")).toBeVisible();
  });
});
