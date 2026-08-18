// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M5 milestone acceptance (#68): the demo, end to end, in one browser
 * session. An Administrator opens /settings, changes their own theme,
 * switches the organization's auth mode, and revokes another user's
 * session — the revocation proven by that user's next request failing.
 * A second journey proves the SET-002 rail split from the other side:
 * a Legal Team Member sees Personal only and is bounced from
 * Organization URLs, with the API's 403 standing behind the bounce.
 * Spec 10 proves each pane against a fresh page; this file proves the
 * demo sentence holds together in sequence. Everything per-run ends
 * revoked or archived, so the never-reset instance (TECH-018) stays
 * clean.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  ensureSsoProviderExists,
  onboardActivatedMember,
  signInAs,
  switchTheme,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";

const rootTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

// Serial like 10-settings.spec.ts: both tests drive the same
// Administrator's theme and auth mode on the never-reset instance, so
// they must never share a wall clock even if fullyParallel turns on.
test.describe.serial("M5 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  // The suite runs against a never-reset instance (TECH-018): leave the
  // shared Administrator on the default theme even after a failure. The
  // guard skips the reset when the failure happened before sign-in.
  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return;
    const menuButton = page.getByRole("banner").getByRole("button", { name: ADMIN.displayName });
    if (!(await menuButton.isVisible().catch(() => false))) return;
    if ((await rootTheme(page)) === "light") return;
    await switchTheme(page, ADMIN.displayName, "Light");
    await expect.poll(() => rootTheme(page)).toBe("light");
  });

  test("open /settings, change theme, switch auth mode, revoke a session — one journey", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left oidc mode behind — the admin
    // still signs in (break-glass), and this puts the mode back. The
    // mode switch below also needs a registered provider to exist.
    const reset = await page.request.patch("/api/v1/auth/mode", { data: { mode: "built_in" } });
    expect(reset.ok()).toBe(true);
    await ensureSsoProviderExists(page.request);

    // The demo's "another user": a per-run member onboarded through the
    // real flows, with a live session of their own to revoke.
    const email = `e2e-m5-demo-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;

    /** Leaves the shared instance in built-in mode and the per-run
     * member inert (TECH-018), whatever happened above. */
    const leaveInert = async () => {
      await member?.context.close();
      const reverted = await page.request.patch("/api/v1/auth/mode", {
        data: { mode: "built_in" },
      });
      expect(reverted.status(), await reverted.text()).toBe(200);
      await ensureMemberInert(page.request, email);
    };

    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Riva Member",
        role: "contributor",
        password: "their-own-e2e-password",
      });

      // Opens /settings, from its way in — the avatar menu (SET-001);
      // the index URL forwards to the rail's first pane, Profile (#67).
      await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Settings" }).click();
      await expect(page).toHaveURL(/\/settings\/profile$/);
      const rail = page.getByRole("navigation", { name: "Settings sections" });

      // Changes their own theme, from its home, the Appearance pane —
      // applied the moment it is chosen, persisted behind the paint.
      await rail.getByRole("link", { name: "Appearance" }).click();
      const persisted = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/me/preferences") &&
          response.request().method() === "PATCH",
      );
      await page.getByRole("radio", { name: "Warm" }).check();
      await expect.poll(() => rootTheme(page)).toBe("warm");
      expect((await persisted).ok()).toBe(true);

      // Switches the organization's auth mode: rail → Security group →
      // Authentication, then the OIDC mode card. Immediate (SET-003) —
      // the portal magic-link toggle unlocking is the visible proof.
      await rail.getByRole("button", { name: "Security" }).click();
      await rail.getByRole("link", { name: "Authentication" }).click();
      await expect(page).toHaveURL(/\/settings\/authentication$/);
      const toggle = page.getByRole("switch", { name: "Magic-link sign-in" });
      await expect(toggle).toBeDisabled();
      const switched = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/auth/mode") && response.request().method() === "PATCH",
      );
      await page.getByRole("radio", { name: "Identity provider (OIDC)" }).check();
      expect((await switched).ok()).toBe(true);
      await expect(page.getByText("Saved").first()).toBeVisible();
      await expect(toggle).toBeEnabled();

      // Revokes the member's session from the Users pane (SET-005) —
      // proven the only way that matters: the member's next request
      // fails, landing them on login.
      await rail.getByRole("link", { name: "Users" }).click();
      await expect(page).toHaveURL(/\/settings\/users$/);
      const row = page.getByRole("row", { name: new RegExp(email) });
      await row.getByRole("button", { name: `Revoke all sessions of ${email}` }).click();
      await expect(row.getByText("Saved")).toBeVisible();
      await member.page.goto("/settings/appearance");
      await expect(member.page).toHaveURL(/\/auth\/login/);
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M5 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });

  test("a Legal Team Member sees Personal only and is bounced from Organization URLs", async ({
    page,
    browser,
  }) => {
    // The Administrator exists only to onboard the member; the journey
    // itself runs in the member's own context.
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const email = `e2e-m5-member-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;

    const leaveInert = async () => {
      await member?.context.close();
      await ensureMemberInert(page.request, email);
    };

    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Lena Counsel",
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const memberPage = member.page;

      // Their /settings is the Personal group alone: the Organization
      // group is absent from the rail, not disabled (SET-002).
      await memberPage.goto("/settings");
      await expect(memberPage).toHaveURL(/\/settings\/profile$/);
      const rail = memberPage.getByRole("navigation", { name: "Settings sections" });
      await expect(rail.getByRole("link", { name: "Profile" })).toBeVisible();
      await expect(rail.getByRole("link", { name: "Appearance" })).toBeVisible();
      // Notifications joined the Personal group in M18 (#320), which is
      // what "omitted rather than disabled" was waiting for: the rail
      // grew the entry when the pane behind it existed.
      await expect(rail.getByRole("link", { name: "Notifications" })).toBeVisible();
      await expect(rail.getByText("Organization")).toHaveCount(0);
      await expect(rail.getByRole("link", { name: "General" })).toHaveCount(0);
      await expect(rail.getByRole("link", { name: "Users" })).toHaveCount(0);
      await expect(rail.getByRole("button", { name: "Security" })).toHaveCount(0);

      // Every Organization URL bounces them to their own settings home.
      for (const path of ["/settings/general", "/settings/users", "/settings/authentication"]) {
        await memberPage.goto(path);
        await expect(memberPage).toHaveURL(/\/settings\/profile$/);
      }

      // The client bounce is convenience; the API's role gate is the
      // real refusal (SET-002).
      const refused = await memberPage.request.get("/api/v1/users");
      expect(refused.status()).toBe(403);
    } catch (error) {
      await sweepOrSay("M5 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
