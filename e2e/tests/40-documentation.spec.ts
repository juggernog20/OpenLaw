// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import { ADMIN, signInAs } from "./helpers.js";

test("Help stays in the staff and portal shells and preserves keyboard shortcuts", async ({
  page,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.getByRole("banner").getByRole("link", { name: "Help", exact: true }).click();
  await expect(page).toHaveURL(/\/help(?:\?|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "Help", exact: true })).toBeFocused();
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { level: 1, name: "Help", exact: true }).focus();
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Search", exact: true })).toBeFocused();
  await page.goto("/portal/help");
  await expect(page.getByRole("heading", { level: 1, name: "Help", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Legal request portal" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "All documentation", exact: true }).click();
  await expect(page).toHaveURL(/\/documentation$/);
});

test("a signed-out Help deep link keeps its article and section", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/portal/help/unavailable-fixture#before-you-start");
  await expect(page).toHaveURL(/\/documentation\/unavailable-fixture#before-you-start$/);
  await expect(page.getByRole("heading", { name: "Article unavailable" })).toBeVisible();
});

test("bundled documentation and its export are public without API reads", async ({
  page,
  context,
  request,
}) => {
  await context.clearCookies();
  const apiRequests: string[] = [];
  await page.route("**/api/**", (route) => {
    apiRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/documentation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Documentation", exact: true }),
  ).toBeVisible();
  await page.getByText("Edition details", { exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Download standalone edition" })).toBeVisible();
  expect(apiRequests).toEqual([]);
  const index = await request.get("/documentation-export/index.html");
  expect(index.status()).toBe(200);
  expect(await index.text()).toContain("OpenLaw documentation");
  const archive = await request.get("/documentation-export/openlaw-documentation.tar.gz");
  expect(archive.status()).toBe(200);
  expect((await archive.body()).subarray(0, 2).toString("hex")).toBe("1f8b");
  await page.goto("/documentation/unavailable-fixture");
  await expect(page.getByRole("heading", { name: "Article unavailable" })).toBeVisible();
  const missing = await request.get("/documentation-export/unavailable-fixture.html");
  expect(missing.status()).toBe(404);
});
