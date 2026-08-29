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

import { test, expect } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs, sweepOrSay } from "./helpers.js";

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

  test("Documents page: axe scan and title", async ({ page, request }, testInfo) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/documents");

    await expect(page).toHaveTitle("Documents · OpenLaw");
    await expect(page.getByRole("region", { name: "Documents" })).toBeVisible();
    await reportAxeViolations(page, testInfo, "documents");
  });

  test("search results box and results page: axe scans", async ({ page, request }, testInfo) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const options = await page.request.get("/api/v1/contracts/options");
    expect(options.status(), await options.text()).toBe(200);
    const contractType = z
      .object({
        contractTypes: z.array(
          z.object({ id: z.string(), fields: z.array(z.object({ isRequired: z.boolean() })) }),
        ),
      })
      .parse(await options.json())
      .contractTypes.find((row) => row.fields.every((field) => !field.isRequired));
    expect(
      contractType,
      "the install has no Contract Type without a hard-required Field",
    ).toBeDefined();

    const query = `axesearch${Date.now()}`;
    const title = `Axe search result ${query}`;
    const created = await page.request.post("/api/v1/contracts", {
      data: { title, contractTypeId: contractType!.id },
    });
    expect(created.status(), await created.text()).toBe(201);
    const contract = z
      .object({ contract: z.object({ number: z.number().int() }) })
      .parse(await created.json()).contract;

    try {
      await page.goto("/");
      const search = page.getByRole("banner").getByRole("combobox", { name: "Search" });
      await search.fill(query);
      const answer = page.getByRole("listbox", { name: "Search results" });
      await expect(answer.getByRole("option").filter({ hasText: title })).toBeVisible();
      await reportAxeViolations(page, testInfo, "search-results-box");

      await answer.getByRole("option", { name: "See all results" }).click();
      await expect(page).toHaveURL(new RegExp(`/search\\?q=${query}$`));
      await expect(page.getByRole("main").getByText(title)).toBeVisible();
      await reportAxeViolations(page, testInfo, "search-results-page");
    } finally {
      const archived = await page.request.post(`/api/v1/contracts/${contract.number}/archive`);
      expect(archived.status(), await archived.text()).toBe(200);
    }
  });

  test("settings page: /settings forwards to Profile; axe scan and title on every pane, plus a seeded archived row", async ({
    page,
    request,
  }, testInfo) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/settings");

    // The index lands on Profile (#67).
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page).toHaveTitle("Profile · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-profile");

    // The Appearance pane, the theme's home.
    await page.goto("/settings/appearance");
    await expect(page).toHaveTitle("Appearance · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-appearance");

    // The Notifications pane (#320), the toggle grid M5 deferred.
    await page.goto("/settings/notifications");
    await expect(page).toHaveTitle("Notifications · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-notifications");

    // The Organization · Notifications pane (#322): the NOT-004 lead
    // times in the DES-052 value-list anatomy. The rail entry is called
    // Notifications like the Personal one; the screen title is the
    // pane's own, because DES-011 asks every screen for a unique title.
    await page.goto("/settings/reminders");
    await expect(page).toHaveTitle("Reminder lead times · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-reminders");

    // The Organization · General form (#63), as the Administrator.
    await page.goto("/settings/general");
    await expect(page).toHaveTitle("General · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-general");

    // The Security · Authentication pane (#64), as the Administrator.
    await page.goto("/settings/authentication");
    await expect(page).toHaveTitle("Authentication · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-authentication");

    // The Organization · Users table (#65), as the Administrator.
    await page.goto("/settings/users");
    await expect(page).toHaveTitle("Users · OpenLaw");
    await reportAxeViolations(page, testInfo, "settings-users");

    // The archived view (#66) scans against its own seed, so it can
    // never silently skip: a per-run invite is archived (a pending
    // invite archives fine — the guard chain only bars activated
    // states), scanned, and revoked again so the never-reset instance
    // (TECH-018) keeps nothing.
    const email = `axe-archived-${Date.now()}@example.com`;
    const invited = await page.request.post("/api/v1/auth/invites", {
      data: { email, displayName: "Axe Archived", role: "contributor" },
    });
    expect(invited.status()).toBe(201);
    const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await invited.json());

    const leaveInert = async () => {
      const revoked = await page.request.delete(`/api/v1/auth/invites/${user.id}`);
      expect(revoked.status(), await revoked.text()).toBe(204);
    };

    try {
      const archived = await page.request.post(`/api/v1/users/${user.id}/archive`);
      expect(archived.ok()).toBe(true);

      await page.reload();
      await page.getByRole("switch", { name: "Show archived" }).click();
      await expect(page.getByText(email)).toBeVisible();
      // Contrast is exempted here on purpose: archived rows render in
      // the SET-005 greyed inactive treatment, and WCAG 1.4.3 exempts
      // text in inactive components from its minima — axe cannot know
      // the dimming is the meaning. The default view above still scans
      // contrast in full.
      await reportAxeViolations(page, testInfo, "settings-users-archived", {
        disableRules: ["color-contrast"],
      });
    } catch (error) {
      await sweepOrSay("the archived-rows axe scan", leaveInert);
      throw error;
    }
    await leaveInert();
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
