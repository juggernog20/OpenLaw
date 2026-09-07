// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";

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
