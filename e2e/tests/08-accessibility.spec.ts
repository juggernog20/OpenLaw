// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The accessibility floor (#48, DES-011): an axe-core scan of the
 * representative pages (login, home), plus hard checks for the parts of
 * the contract a scanner cannot judge — unique per-screen titles, the
 * declared document language, and reduced-motion degradation.
 *
 * The axe scan is an advisory triage signal, not a build gate: found
 * violations are printed to the runner output (and surfaced as GitHub
 * warning annotations in CI) and attached to the report, but they do
 * not fail the run. The gate started clean — zero violations on both
 * pages when #48 closed — so anything reported here is new.
 */

import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

/** Scans the page and reports violations without failing the run. */
async function reportAxeViolations(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`axe-${label}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  if (results.violations.length === 0) {
    console.log(`axe(${label}): no violations.`);
    return;
  }
  for (const violation of results.violations) {
    const targets = violation.nodes.map((n) => n.target.join(" ")).join("; ");
    const line = `axe(${label}): [${violation.impact ?? "unknown"}] ${violation.id} — ${violation.help} (${targets})`;
    console.log(line);
    if (process.env.CI) console.log(`::warning title=New axe violation::${line}`);
  }
}

test.describe("accessibility floor", () => {
  test("login page: axe scan, title, and document language", async ({ page }, testInfo) => {
    await page.goto("/auth/login");
    await expect(page.getByLabel("Email")).toBeVisible();

    // DES-011 commitment 7: declared language, unique screen title.
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await expect(page).toHaveTitle("Sign in · OpenLaw");

    await reportAxeViolations(page, testInfo, "login");
  });

  test("home page: axe scan and title", async ({ page, request }, testInfo) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    await expect(page).toHaveTitle("Home · OpenLaw");

    await reportAxeViolations(page, testInfo, "home");
  });

  test("settings page: /settings forwards to Appearance; axe scan and title", async ({
    page,
    request,
  }, testInfo) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page).toHaveTitle("Appearance · OpenLaw");

    await reportAxeViolations(page, testInfo, "settings");

    // The Organization · General form (#63), as the Administrator.
    await page.goto("/settings/general");
    await expect(page).toHaveTitle("General · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-general");

    // The Security · Authentication pane (#64), as the Administrator.
    await page.goto("/settings/authentication");
    await expect(page).toHaveTitle("Authentication · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-authentication");
  });

  test("reduced motion degrades transitions to instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/auth/login");
    // The sign-in button carries the shell's standard transition
    // utilities; under reduced motion the global override must cut its
    // duration to effectively zero (near-zero, so transitionend fires).
    const seconds = await page
      .getByRole("button", { name: "Sign in" })
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(seconds).toBeLessThan(0.001);
  });
});
