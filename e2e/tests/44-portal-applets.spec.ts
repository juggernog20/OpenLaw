// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  reportAxeViolations,
} from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Portal uses shared applets with private history omitted and expanding Fields", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const email = `portal-applets-${Date.now()}@example.com`;
  const colleague = await onboardActivatedMember(page.request, browser, {
    email,
    displayName: "Portal applet colleague",
    role: "business_user",
    password: "correct-horse-battery",
  });
  const portal = colleague.page;
  const identity = await portal.request.get("/api/v1/me");
  const userId = (await identity.json()).user.id;
  const records: { module: "contract" | "matter"; number: number }[] = [];
  try {
    for (const module of ["contract", "matter"] as const) {
      const options = await (await page.request.get(`/api/v1/${module}s/options`)).json();
      const type = options[`${module}Types`].find(
        (row: { fields: { isRequired: boolean }[] }) =>
          !row.fields.some((field) => field.isRequired),
      );
      const created = await page.request.post(`/api/v1/${module}s`, {
        data: { title: `Portal applet ${module}`, [`${module}TypeId`]: type.id },
      });
      expect(created.status(), await created.text()).toBe(201);
      const record = (await created.json())[module];
      records.push({ module, number: record.number });
      expect(
        (
          await page.request.post(`/api/v1/${module}s/${record.number}/team`, { data: { userId } })
        ).status(),
      ).toBe(201);
      for (const visibility of ["full_thread", "legal_only", "working_team"]) {
        expect(
          (
            await page.request.post("/api/v1/comments", {
              data: {
                entityType: module,
                entityId: record.id,
                visibility,
                body: `${visibility} discussion`,
              },
            })
          ).status(),
        ).toBe(201);
      }
      await portal.setViewportSize({ width: 1440, height: 1000 });
      await portal.goto(`/portal/${module}s/${record.number}`);
      const field = portal.getByRole("textbox", { name: "Description", exact: true });
      await field.fill("Short description");
      const short = await field.evaluate((node) => node.getBoundingClientRect().height);
      await field.fill(Array.from({ length: 18 }, (_, i) => `Context line ${i}`).join("\n"));
      await expect
        .poll(() => field.evaluate((node) => node.getBoundingClientRect().height))
        .toBeGreaterThan(short);
      expect(await field.evaluate((node) => getComputedStyle(node).resize)).toBe("none");
      await field.fill("Shared business context");
      await expect
        .poll(() => field.evaluate((node) => node.getBoundingClientRect().height))
        .toBe(short);
      await portal.getByRole("heading", { name: `Portal applet ${module}`, exact: true }).click();
      await expect(portal.getByRole("button", { name: /Comments.*1/ })).toBeVisible();
      await portal.getByRole("button", { name: /Comments.*1/ }).click();
      const comments = portal.getByRole("complementary", { name: "Comments", exact: true });
      await expect(comments.getByText("full_thread discussion", { exact: true })).toBeVisible();
      await expect(comments.getByText("legal_only discussion")).toHaveCount(0);
      await expect(comments.getByText("working_team discussion")).toHaveCount(0);
      await comments.getByRole("textbox", { name: "New comment" }).fill("Keep my draft");
      await portal
        .getByRole("button", {
          name: module === "contract" ? "Contract team" : "Matter team",
          exact: true,
        })
        .click();
      await expect(
        portal.getByRole("complementary").getByText("Portal applet colleague", { exact: true }),
      ).toBeVisible();
      await expect(portal.getByRole("button", { name: "Add team member" })).toHaveCount(0);
      await portal.getByRole("button", { name: "Comments", exact: true }).click();
      await expect(comments.getByRole("textbox", { name: "New comment" })).toHaveValue(
        "Keep my draft",
      );
      await comments.getByRole("textbox", { name: "New comment" }).press("Escape");
      await expect(portal.getByRole("button", { name: "Comments", exact: true })).toBeFocused();
      await portal.getByRole("button", { name: "History", exact: true }).click();
      const history = portal.getByRole("complementary", { name: "History", exact: true });
      await expect(history.getByText(/Shared business context/)).toBeVisible();
      const response = await portal.request.get(
        `/api/v1/portal/activity?entityType=${module}&entityId=${record.id}`,
      );
      expect(response.ok()).toBe(true);
      const entries = (await response.json()).entries;
      expect(
        entries.every((entry: { visibility: string }) => entry.visibility === "full_thread"),
      ).toBe(true);
      await reportAxeViolations(portal, testInfo, `portal-${module}-applets-desktop`);
      for (const width of [390, 320]) {
        await portal.setViewportSize({ width, height: 844 });
        await expect(history).toBeVisible();
        const box = await history.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(
          await portal.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      }
      await portal.setViewportSize({ width: 390, height: 844 });
      await portal.getByRole("button", { name: "Comments", exact: true }).click();
      await expect(comments.getByRole("textbox", { name: "New comment" })).toBeVisible();
      await reportAxeViolations(portal, testInfo, `portal-${module}-applets-mobile`);
      await portal.screenshot({ path: `/tmp/openlaw-portal-${module}-applets.png` });
    }
  } finally {
    for (const record of records)
      await page.request.delete(`/api/v1/${record.module}s/${record.number}`);
    await colleague.context.close();
    await ensureMemberInert(page.request, email);
  }
});
