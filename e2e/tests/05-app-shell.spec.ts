// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The application shell (#41): sign-in lands in the real chrome —
 * header, top nav from the destination registry, page sub-bar — at the
 * DES-007 normalized geometry, rendered in self-hosted Inter with no
 * outbound font request.
 */

import { test, expect } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.describe("application shell", () => {
  test("sign-in lands in the shell chrome", async ({ page, request }) => {
    await ensureAdminExists(request);

    // Everything the shell loads must come from the stack itself: a
    // fresh install may not have internet at all (self-hosted).
    const offOrigin: string[] = [];
    page.on("request", (req) => {
      const host = new URL(req.url()).hostname;
      if (host !== "localhost" && host !== "127.0.0.1") offOrigin.push(req.url());
    });

    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Header: product mark, search box, user menu.
    const header = page.getByRole("banner");
    await expect(header.getByText("openlaw")).toBeVisible();
    await expect(header.getByRole("searchbox", { name: "Search" })).toBeVisible();

    // Nav renders from the destination registry — Home and, for
    // Member+, the M7 Entities registry — with the current one marked.
    const nav = page.getByRole("navigation");
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAttribute("aria-current", "page");
    await expect(links.first()).toContainText("Home");
    await expect(links.nth(1)).toContainText("Entities");

    // Sub-bar carries the page title as the page's single h1.
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    // DES-007 normalized geometry: 62px header with 16px horizontal
    // padding, 48px nav with 8px item gap.
    expect((await header.boundingBox())?.height).toBe(62);
    expect((await nav.boundingBox())?.height).toBe(48);
    expect(await header.evaluate((el) => getComputedStyle(el).paddingInlineStart)).toBe("16px");
    expect(await nav.evaluate((el) => getComputedStyle(el).columnGap)).toBe("8px");

    // Inter is self-hosted: the registered face resolves, and nothing
    // was fetched from outside the stack.
    expect(
      await page.evaluate(() =>
        document.fonts.ready.then(() => document.fonts.check('14px "Inter Variable"')),
      ),
    ).toBe(true);
    expect(offOrigin).toEqual([]);
  });
});
