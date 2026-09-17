// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The application shell (#41): sign-in lands in the real chrome at the
 * DES-007 normalized geometry. That chrome is the header, the top nav
 * from the destination registry, and the page sub-bar, rendered in
 * self-hosted Inter with no outbound font request.
 *
 * The second test is the scroll model (DES-030, #158). It belongs here
 * because it is a fact about the shell rather than about any page, and
 * because layout is the only way to prove it. A class name on a `div`
 * says nothing about what actually moves.
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
    await expect(header.getByRole("combobox", { name: "Search" })).toBeVisible();

    // The shared registry puts My Tasks between Inbox and Matters.
    const nav = page.getByRole("navigation");
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(9);
    await expect(links.first()).toContainText("Home");
    await expect(links.first()).toHaveAttribute("aria-current", "page");
    await expect(links.nth(1)).toContainText("Inbox");
    await expect(links.nth(2)).toContainText("My Tasks");
    await expect(links.nth(2)).toHaveAttribute("href", "/home/tasks");
    await expect(links.nth(3)).toContainText("Matters");
    await expect(links.nth(4)).toContainText("Contracts");
    await expect(links.nth(5)).toContainText("Documents");
    await expect(links.nth(6)).toContainText("Entities");
    await expect(links.nth(7)).toContainText("Knowledge");
    await expect(links.nth(8)).toContainText("Auto-Docs");
    await expect(links.nth(8)).toHaveAttribute("href", "/auto-docs");

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

  test("the chrome holds its place while the main region scrolls", async ({ page, request }) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const header = page.getByRole("banner");
    const nav = page.getByRole("navigation");
    const subbar = page.locator("#page-title");
    const main = page.locator("main#main");

    // The overflow is made rather than waited for. Home is shorter than
    // the viewport on a fresh install, and the model has to hold for the
    // tallest surface the product will ever draw, not for whatever rows
    // this instance happens to be carrying today.
    await main.evaluate((region) => {
      const filler = document.createElement("div");
      filler.style.height = "4000px";
      // A plain tall block misses the Fields regression: screen-reader labels
      // are absolute and must remain inside the same scroll container.
      filler.innerHTML = '<div style="height:3990px"></div><span class="sr-only">Field type</span>';
      region.append(filler);
    });

    // The document has no scroll to give away, which is what makes the
    // chrome fixed. Nothing here is `position: sticky`.
    expect(
      await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollHeight <= root.clientHeight;
      }),
    ).toBe(true);

    const chromeBefore = [
      await header.boundingBox(),
      await nav.boundingBox(),
      await subbar.boundingBox(),
    ];

    await main.evaluate((region) => region.scrollTo(0, region.scrollHeight));

    // The region moved, the window did not, and the three strips are
    // exactly where they were. DES-009 Tier 2 and DES-028 both promise
    // a statement that survives a long record.
    expect(await main.evaluate((region) => region.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect([
      await header.boundingBox(),
      await nav.boundingBox(),
      await subbar.boundingBox(),
    ]).toEqual(chromeBefore);
  });
});

test("long settings and portal pages contain screen-reader labels within one page scroller", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/settings/contracts/fields", "/settings/matters/fields", "/portal"]) {
      await page.goto(path);
      await expect(page.locator("main#main")).toBeVisible();
      const result = await page.locator("main#main").evaluate((main) => {
        const scroller = [main, ...main.querySelectorAll<HTMLElement>("*")].find(
          (element) => getComputedStyle(element).overflowY === "auto",
        );
        if (!scroller) throw new Error("Page scroller not found");
        const filler = document.createElement("div");
        filler.style.cssText = "height:4000px; flex-shrink:0";
        filler.innerHTML =
          '<div style="height:3990px"></div><span class="sr-only">Field type</span>';
        const settingsPane = main.querySelector(
          'nav[aria-label="Settings sections"]',
        )?.nextElementSibling;
        (settingsPane ?? scroller).append(filler);
        const root = document.documentElement;
        const overflow = root.scrollHeight - root.clientHeight;
        scroller.scrollTop = scroller.scrollHeight;
        return {
          overflow,
          scrollTop: scroller.scrollTop,
          windowScroll: window.scrollY,
          bottomGap:
            scroller.getBoundingClientRect().bottom - filler.getBoundingClientRect().bottom,
        };
      });
      expect(result.overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
      expect(result.scrollTop, `${path} stays scrollable`).toBeGreaterThan(0);
      expect(result.windowScroll).toBe(0);
      if (path.startsWith("/settings/")) expect(result.bottomGap).toBeGreaterThanOrEqual(23);
    }
  }
});
