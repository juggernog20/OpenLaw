// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  submitLogin,
} from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("a Business User completes each accessible first-run step and keeps completion across sign-ins", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const email = `portal-first-run-${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const department = await page.request.post("/api/v1/departments", {
    data: { displayName: `First-run Department ${Date.now()}` },
  });
  expect(department.status(), await department.text()).toBe(201);
  const {
    department: { id: departmentId },
  } = z.object({ department: z.object({ id: z.string() }) }).parse(await department.json());
  let colleague: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  try {
    colleague = await onboardActivatedMember(page.request, browser, {
      email,
      displayName: "First-run colleague",
      password,
      role: "business_user",
      completePortalOnboarding: false,
    });
    const portal = colleague.page;
    await portal.setViewportSize({ width: 390, height: 844 });
    await portal.goto("/portal/contracts");
    await expect(portal).toHaveURL(/\/portal\/onboarding$/);
    await expect(
      portal.getByRole("heading", { name: "We need to learn a little about you" }),
    ).toBeVisible();
    await expect(portal.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(portal.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
    for (const name of ["Department", "Name and photo", "Theme", "Notifications", "A short tour"]) {
      await expect(portal.getByRole("region", { name, exact: true })).toBeVisible();
      expect(await reportAxeViolations(portal, testInfo, `first-run-${name}`)).toEqual([]);
      if (name === "Department") {
        await portal.getByRole("combobox", { name: "Department" }).selectOption(departmentId);
        await expect(portal.getByRole("button", { name: "Continue" })).toBeEnabled();
        await portal.getByRole("button", { name: "Continue" }).click();
      } else if (name === "A short tour") {
        await expect(portal.getByRole("heading", { name: "Auto-Docs", exact: true })).toBeVisible();
        await portal.getByRole("button", { name: "Finish" }).click();
      } else {
        await portal.getByRole("button", { name: "Skip", exact: true }).click();
      }
    }
    await expect(portal).toHaveURL(/\/portal$/);
    const readStamp = async () => {
      const response = await portal.request.get("/api/v1/me");
      expect(response.status(), await response.text()).toBe(200);
      return z
        .object({ user: z.object({ portalOnboardingCompletedAt: z.string() }) })
        .parse(await response.json()).user.portalOnboardingCompletedAt;
    };
    const stamp = await readStamp();
    await portal.getByRole("button", { name: "Sign out" }).click();
    await expect(portal).toHaveURL(/\/portal\/enter$/);
    await submitLogin(portal, email, password);
    await expect(portal).toHaveURL(/\/portal$/);
    await portal.goto("/portal/onboarding");
    await expect(portal).toHaveURL(/\/portal$/);
    expect(await readStamp()).toBe(stamp);
  } finally {
    await colleague?.context.close();
    await ensureMemberInert(page.request, email);
    const archived = await page.request.post(`/api/v1/departments/${departmentId}/archive`, {
      data: {},
    });
    expect(archived.status(), await archived.text()).toBe(200);
  }
});
