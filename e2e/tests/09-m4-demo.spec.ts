// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M4 milestone acceptance (#49): the demo, end to end, in one browser
 * session. Sign in, land on the authenticated shell, switch between
 * the three themes, and resize to the mobile layout without anything
 * breaking. Specs 05–08 each prove one piece against a fresh page;
 * this journey proves the pieces hold together in sequence — theme
 * survives the resize, the mobile shell works in the theme you chose,
 * and the desktop chrome comes back intact.
 */

import { test, expect, type Page } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

/** The header background per theme — bg-inverted from styles/themes/. */
const HEADER_BG = {
  light: "rgb(13, 17, 23)", // #0D1117
  warm: "rgb(232, 224, 208)", // #E8E0D0
  dark: "rgb(1, 4, 9)", // #010409
} as const;

const DESKTOP = { width: 1280, height: 800 } as const;
const MOBILE = { width: 375, height: 812 } as const;

async function switchTheme(page: Page, label: "Light" | "Warm" | "Dark"): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

const rootTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

const headerBg = (page: Page) =>
  page.getByRole("banner").evaluate((el) => getComputedStyle(el).backgroundColor);

/** True when the page cannot be scrolled sideways. */
const hasNoHorizontalOverflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });

test.describe("M4 demo path", () => {
  test.use({ viewport: { ...DESKTOP } });

  test("sign in, shell, three themes, mobile resize — one journey", async ({ page, request }) => {
    await ensureAdminExists(request);

    // Sign in and land on the authenticated shell.
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    const header = page.getByRole("banner");
    await expect(header.getByText("openlaw")).toBeVisible();
    await expect(header.getByRole("searchbox", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    // Switch between the three themes; each applies to the chrome
    // instantly via the token layer.
    for (const label of ["Warm", "Dark", "Light"] as const) {
      const theme = label.toLowerCase() as Lowercase<typeof label>;
      await switchTheme(page, label);
      await expect.poll(() => rootTheme(page)).toBe(theme);
      expect(await headerBg(page)).toBe(HEADER_BG[theme]);
    }

    // Mid-journey theme for the resize leg: the mobile shell must work
    // in whatever theme the user chose, not just the default.
    await switchTheme(page, "Dark");
    await expect.poll(() => rootTheme(page)).toBe("dark");

    // Resize to the mobile layout: nav collapses into the hamburger
    // drawer, the theme survives, nothing overflows sideways.
    await page.setViewportSize({ ...MOBILE });
    await expect(page.getByRole("navigation")).toBeHidden();
    const hamburger = page.getByRole("button", { name: "Open navigation" });
    await expect(hamburger).toBeVisible();
    expect(await rootTheme(page)).toBe("dark");
    expect(await headerBg(page)).toBe(HEADER_BG.dark);
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    // The drawer navigates, then gets out of the way.
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await drawer.getByRole("link", { name: "Home" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    // Back up to desktop: the full chrome returns, still themed.
    await page.setViewportSize({ ...DESKTOP });
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(hamburger).toBeHidden();
    expect(await rootTheme(page)).toBe("dark");

    // Leave the shared Administrator on the default theme: the suite
    // runs against a never-reset instance (TECH-018), and the theme
    // rides the user record across runs.
    await switchTheme(page, "Light");
    await expect.poll(() => rootTheme(page)).toBe("light");
  });
});
