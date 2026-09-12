// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  reportAxeViolations,
  sweepOrSay,
} from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Portal uses shared applets with private history omitted, read-only Fields and an expanding composer", async ({
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
  let journeyError: unknown;
  try {
    for (const module of ["contract", "matter"] as const) {
      const options = await (await page.request.get(`/api/v1/${module}s/options`)).json();
      const type = options[`${module}Types`].find(
        (row: { fields: { isRequired: boolean }[] }) =>
          !row.fields.some((field) => field.isRequired),
      );
      const created = await page.request.post(`/api/v1/${module}s`, {
        data: {
          title: `Portal applet ${module}`,
          [`${module}TypeId`]: type.id,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const record = (await created.json())[module];
      records.push({ module, number: record.number });
      const described = await page.request.patch(`/api/v1/${module}s/${record.number}`, {
        data: { description: "Shared business context" },
      });
      expect(described.status(), await described.text()).toBe(200);
      expect(
        (
          await page.request.post(`/api/v1/${module}s/${record.number}/team`, { data: { userId } })
        ).status(),
      ).toBe(201);
      let sharedCommentId: string | undefined;
      for (const visibility of ["full_thread", "legal_only", "working_team"]) {
        const posted = await page.request.post("/api/v1/comments", {
          data: {
            entityType: module,
            entityId: record.id,
            visibility,
            body: `${visibility} discussion`,
          },
        });
        expect(posted.status(), await posted.text()).toBe(201);
        if (visibility === "full_thread") sharedCommentId = (await posted.json()).comment.id;
      }
      await portal.setViewportSize({ width: 1440, height: 1000 });
      await portal.goto(`/portal/${module}s/${record.number}`);
      const fields = portal.getByRole("region", { name: "Fields", exact: true });
      await expect(fields.getByText("Shared business context", { exact: true })).toBeVisible();
      await expect(fields.getByRole("textbox")).toHaveCount(0);
      await expect(portal.getByRole("button", { name: /Comments.*1/ })).toBeVisible();
      await portal.getByRole("button", { name: /Comments.*1/ }).click();
      const comments = portal.getByRole("complementary", { name: "Comments", exact: true });
      await expect(comments.getByText("full_thread discussion", { exact: true })).toBeVisible();
      await expect(comments.getByText("legal_only discussion")).toHaveCount(0);
      await expect(comments.getByText("working_team discussion")).toHaveCount(0);
      const composer = comments.getByRole("textbox", { name: "New comment" });
      await composer.fill("Short comment");
      const short = await composer.evaluate((node) => node.getBoundingClientRect().height);
      await composer.fill(Array.from({ length: 18 }, (_, i) => `Context line ${i}`).join("\n"));
      await expect
        .poll(() => composer.evaluate((node) => node.getBoundingClientRect().height))
        .toBeGreaterThan(short);
      expect(await composer.evaluate((node) => getComputedStyle(node).resize)).toBe("none");
      await composer.fill("Keep my draft");
      await expect
        .poll(() => composer.evaluate((node) => node.getBoundingClientRect().height))
        .toBe(short);
      await portal
        .getByRole("button", {
          name: module === "contract" ? "Contract team" : "Matter team",
          exact: true,
        })
        .click();
      await expect(
        portal.getByRole("complementary").getByText("Portal applet colleague", { exact: true }),
      ).toBeVisible();
      await expect(portal.getByRole("button", { name: "Add team member" })).toBeEnabled();
      await expect(portal.getByRole("button", { name: /^Remove / })).toHaveCount(0);
      await portal.getByRole("button", { name: "Comments", exact: true }).click();
      await expect(composer).toHaveValue("Keep my draft");
      // The preserved draft is posted: a Business User may add comments, and
      // the Portal composer only offers the Full Thread tier.
      const posting = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await comments.getByRole("button", { name: "Comment", exact: true }).click();
      const postedByPortal = await posting;
      expect(postedByPortal.status(), await postedByPortal.text()).toBe(201);
      const portalCommentId: string = (await postedByPortal.json()).comment.id;
      await expect(comments.getByText("Keep my draft", { exact: true })).toBeVisible();
      await expect(composer).toHaveValue("");
      await composer.press("Escape");
      await expect(portal.getByRole("button", { name: "Comments", exact: true })).toBeFocused();
      await portal.getByRole("button", { name: "History", exact: true }).click();
      const history = portal.getByRole("complementary", { name: "History", exact: true });
      await expect(
        history.getByText(`${ADMIN.displayName} commented`, { exact: true }),
      ).toBeVisible();
      await expect(
        history.getByText("Portal applet colleague commented", { exact: true }),
      ).toBeVisible();
      const response = await portal.request.get(
        `/api/v1/portal/activity?entityType=${module}&entityId=${record.id}`,
      );
      expect(response.ok()).toBe(true);
      const entries = (await response.json()).entries;
      expect(sharedCommentId).toBeDefined();
      // Newest first: the Portal's own comment, then Legal's shared one. The
      // two private comments leave no entry at all.
      expect(entries).toMatchObject([
        {
          action: "comment.posted",
          visibility: "full_thread",
          payload: { commentId: portalCommentId },
        },
        {
          action: "comment.posted",
          visibility: "full_thread",
          payload: { commentId: sharedCommentId },
        },
      ]);
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
  } catch (error) {
    journeyError = error;
    throw error;
  } finally {
    await colleague.context.close();
    // Every sweep step is asserted, so a failed archive cannot pass quietly.
    // After a failed journey the sweep is reported rather than thrown, so
    // the journey's own failure is the one that propagates.
    const cleanup = async () => {
      for (const record of records) {
        const archived = await page.request.post(
          `/api/v1/${record.module}s/${record.number}/archive`,
        );
        expect(archived.status(), await archived.text()).toBe(200);
      }
      await ensureMemberInert(page.request, email);
    };
    if (journeyError) await sweepOrSay("Portal applets", cleanup);
    else await cleanup();
  }
});
