// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  reportAxeViolations,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";

const prefix = "E2E Portal list";
test.setTimeout(90_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Business Users search, filter and sort Contract and Matter tables", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await sweepRecords(page.request);
  const email = `e2e-portal-lists-${Date.now()}@example.com`;
  let member: OnboardedMember | undefined;
  const cleanup = async () => {
    const results = await Promise.allSettled([
      sweepRecords(page.request),
      member?.context.close(),
      ensureMemberInert(page.request, email),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Portal list cleanup failed",
      );
  };
  try {
    member = await onboardActivatedMember(page.request, browser, {
      email,
      displayName: "Portal list colleague",
      role: "business_user",
      password: "correct-horse-battery",
    });
    const identity = await member.page.request.get("/api/v1/me");
    const userId = (await identity.json()).user.id;
    const portal = member.page;
    await portal.setViewportSize({ width: 1440, height: 1000 });
    for (const module of ["contracts", "matters"] as const) {
      const singular = module === "contracts" ? "contract" : "matter";
      const label = module === "contracts" ? "Contracts" : "Matters";
      const optionsRead = await page.request.get(`/api/v1/${module}/options`);
      expect(optionsRead.ok()).toBe(true);
      const options = await optionsRead.json();
      const type = options[`${singular}Types`].find(
        (row: { fields: { isRequired: boolean }[] }) =>
          !row.fields.some((field) => field.isRequired),
      );
      expect(type).toBeDefined();
      for (const suffix of ["Alpha", "Zulu", "Hidden"]) {
        const result = await page.request.post(`/api/v1/${module}`, {
          data: { title: `${prefix} ${suffix}`, [`${singular}TypeId`]: type.id },
        });
        expect(result.status(), await result.text()).toBe(201);
        const record = (await result.json())[singular];
        if (suffix !== "Hidden") {
          const added = await page.request.post(`/api/v1/${module}/${record.number}/team`, {
            data: { userId },
          });
          expect(added.status(), await added.text()).toBe(201);
        }
      }
      await portal.goto(`/portal/${module}`);
      await expect(portal.getByRole("heading", { name: `Your ${label}` })).toBeVisible();
      const table = portal.getByRole("table");
      await expect(table).toBeVisible();
      await expect(table.getByRole("link", { name: `${prefix} Hidden` })).toHaveCount(0);
      await expect(portal.getByText("2 of 2 records")).toBeVisible();
      await portal.getByRole("searchbox", { name: `Search ${label}` }).fill("Alpha");
      await portal.getByRole("button", { name: "Search", exact: true }).click();
      await expect(portal).toHaveURL(/q=Alpha/);
      await expect(table.getByRole("link", { name: `${prefix} Zulu` })).toHaveCount(0);
      await expect(portal.getByText("1 of 1 record")).toBeVisible();
      await portal.getByRole("button", { name: "Filter", exact: true }).click();
      const filter = portal.getByRole("dialog", { name: "Filter", exact: true });
      await filter.getByRole("button", { name: "Type", exact: true }).click();
      await filter.getByRole("radio", { name: type.displayName, exact: true }).check();
      await filter.getByRole("button", { name: "Apply" }).click();
      await expect(portal).toHaveURL(/typeId=/);
      await portal.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(portal.getByText("2 of 2 records")).toBeVisible();
      await table.getByRole("button", { name: "Title", exact: true }).click();
      await expect(table.getByRole("columnheader", { name: "Title", exact: true })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await expect(table.getByRole("link").first()).toHaveText(`${prefix} Alpha`);
      await expect(portal).toHaveURL(/sort=title/);
      await portal.reload();
      await expect(table.getByRole("columnheader", { name: "Title", exact: true })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await portal.getByRole("button", { name: "Columns", exact: true }).click();
      await portal.getByRole("menuitemcheckbox", { name: "Business Owner", exact: true }).click();
      await portal.keyboard.press("Escape");
      await expect(
        table.getByRole("columnheader", { name: "Business Owner", exact: true }),
      ).toBeVisible();
      expect(await reportAxeViolations(portal, testInfo, `Portal ${module} list`)).toEqual([]);
      await portal.screenshot({
        path: testInfo.outputPath(`portal-${module}.png`),
        fullPage: true,
      });
      await checkMobile(portal);
      await portal.setViewportSize({ width: 1440, height: 1000 });
    }
  } catch (error) {
    await sweepOrSay("Portal lists", cleanup);
    throw error;
  }
  await cleanup();
});

async function checkMobile(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole("button", { name: /^Filter(?: \d+)?$/ })).toBeVisible();
}

async function sweepRecords(request: APIRequestContext) {
  for (const module of ["contracts", "matters"] as const) {
    let cursor: string | undefined;
    const numbers: number[] = [];
    do {
      const query = new URLSearchParams(
        module === "contracts" ? { includeEnded: "true" } : { includeClosed: "true" },
      );
      if (cursor) query.set("cursor", cursor);
      const response = await request.get(`/api/v1/${module}?${query}`);
      expect(response.status(), await response.text()).toBe(200);
      const data = await response.json();
      numbers.push(
        ...data[module]
          .filter((row: { title: string }) => row.title.startsWith(prefix))
          .map((row: { number: number }) => row.number),
      );
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
    const results = await Promise.allSettled(
      numbers.map(async (number) => {
        const response = await request.post(`/api/v1/${module}/${number}/archive`);
        expect(response.status(), await response.text()).toBe(200);
      }),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        `Could not archive ${module}`,
      );
  }
}
