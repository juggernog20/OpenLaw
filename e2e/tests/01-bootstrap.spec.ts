// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bootstrap probe: whatever state the instance is in, this spec leaves it
 * with its Administrator — created through the real first-run setup
 * screen when the instance is fresh, signed in with the known fixture
 * when it is not — and proves setup can never happen twice.
 */

import { test, expect } from "@playwright/test";
import { ADMIN, ensureAdminExists, needsSetup, signInAs, uniqueEmail } from "./helpers.js";

test.describe("bootstrap probe", () => {
  test("the instance has its Administrator — created via first-run setup when fresh", async ({
    page,
    request,
  }) => {
    if (await needsSetup(request)) {
      // A fresh instance owns every route: even the root bounces to setup.
      await page.goto("/");
      await expect(page).toHaveURL(/\/auth\/setup$/);
      await page.getByLabel("Name").fill(ADMIN.displayName);
      await page.getByLabel("Email").fill(ADMIN.email);
      await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
      await page.getByLabel("Confirm password").fill(ADMIN.password);
      await page.getByRole("button", { name: "Create Administrator" }).click();
      // Setup signs its creator in; landing on home proves the session.
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("banner").getByText(ADMIN.displayName)).toBeVisible();
    } else {
      await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    }
  });

  test("setup is permanently refused afterwards", async ({ page, request }) => {
    await ensureAdminExists(request);

    // The API answers 409 no matter what the caller offers…
    const refused = await request.post("/api/v1/auth/setup", {
      data: {
        email: uniqueEmail("usurper"),
        displayName: "Too Late",
        password: "not-going-to-happen",
      },
    });
    expect(refused.status()).toBe(409);

    // …and the screen is no longer a destination: an anonymous visit to
    // /auth/setup bounces to login before it can render.
    await page.goto("/auth/setup");
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
