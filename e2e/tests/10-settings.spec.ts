// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (#62, #63, #64): reached from the avatar
 * menu, and the Appearance pane is the theme's home — a pick applies
 * instantly and persists on the user record across a reload. The
 * Administrator's rail also carries the Organization group (SET-002),
 * whose General pane commits org identity per field (DES-017) and
 * whose Security group holds the Authentication pane — from which the
 * auth mode itself is switched. The Users pane (#65) lists everyone
 * with pending invites as rows and carries invite/resend/revoke; the
 * invite it creates is revoked again, so the never-reset instance
 * (TECH-018) stays clean. Deeper theme mechanics (chrome colors,
 * pre-login Light) stay in 06; this spec proves the destination.
 */

import http from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs, switchTheme } from "./helpers.js";
import { mailCountTo, waitForMailTo } from "./mailpit.js";

/**
 * A minimal OIDC issuer for provider registration: registration only
 * runs discovery (plus JWKS at most), so a discovery document that
 * echoes the registered issuer is enough. Listens on every interface —
 * the app reaches it from its container as host.docker.internal
 * (compose.dev.yml maps the name to the host gateway).
 */
async function startMockIssuer(): Promise<{ issuer: string; close: () => Promise<void> }> {
  let issuer = "";
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/.well-known/openid-configuration")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
        }),
      );
      return;
    }
    if (req.url?.startsWith("/jwks")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The mock issuer has no port.");
  issuer = `http://host.docker.internal:${address.port}`;
  return {
    issuer,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const rootTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test.describe.serial("the settings destination", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  // The suite runs against a never-reset instance (TECH-018): leave the
  // shared Administrator on the default theme even after a failure.
  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return;
    const menuButton = page.getByRole("banner").getByRole("button", { name: ADMIN.displayName });
    if (!(await menuButton.isVisible().catch(() => false))) return;
    if ((await rootTheme(page)) === "light") return;
    await switchTheme(page, ADMIN.displayName, "Light");
    await expect.poll(() => rootTheme(page)).toBe("light");
  });

  test("a signed-out visit to /settings bounces to login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test("avatar menu → Appearance; a theme pick applies now and survives a reload", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The avatar menu is the way in (SET-001) — and no longer switches
    // the theme itself, nor owns two-factor enrolment (#67).
    await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Two-factor authentication" })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Settings" }).click();

    // The index URL forwards to the rail's first pane: Profile (#67).
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page).toHaveTitle("Profile · OpenLaw");

    // The rail: the Personal group, and — for the Administrator — the
    // Organization group with its one shipped pane (#63).
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await expect(rail.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(rail.getByText("Organization")).toBeVisible();
    await expect(rail.getByRole("link", { name: "General" })).toBeVisible();

    // Appearance is the theme's home, one rail hop away.
    await rail.getByRole("link", { name: "Appearance" }).click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page).toHaveTitle("Appearance · OpenLaw");

    // Picking Warm applies the moment it is chosen — no save ceremony.
    // Await the preference PATCH too, so the reload below cannot race
    // the persistence riding behind the instant paint.
    const persisted = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/me/preferences") &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("radio", { name: "Warm" }).check();
    await expect.poll(() => rootTheme(page)).toBe("warm");
    await persisted;

    // Persisted via the preference: a full reload comes back Warm, with
    // the pane's radio reflecting the stored choice.
    await page.reload();
    await expect(page.getByRole("radio", { name: "Warm" })).toBeChecked();
    await expect.poll(() => rootTheme(page)).toBe("warm");

    // Back on Profile, the pane is real now (#67): account surfaces
    // with email read-only per SET-006.
    await rail.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page).toHaveTitle("Profile · OpenLaw");
    await expect(page.getByLabel("Full name")).toHaveValue(ADMIN.displayName);
    await expect(page.getByLabel("Email")).toHaveValue(ADMIN.email);
    await expect(page.getByRole("button", { name: "Sign out other devices" })).toBeVisible();
  });

  test("the General pane commits an org name edit on blur and it survives a reload", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/settings/general");
    await expect(page).toHaveTitle("General · OpenLaw");

    // Per-run unique (TECH-018 never-reset instance): a repeated name
    // would be a no-op commit, and no PATCH would fire to wait on.
    const name = `Acme QA ${Date.now()}`;
    const field = page.getByLabel("Organization name");
    await field.fill(name);
    const persisted = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/org/general") && response.request().method() === "PATCH",
    );
    // Blur commits the field (DES-017) — no Save button exists to click.
    await field.blur();
    expect((await persisted).ok()).toBe(true);
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Organization name")).toHaveValue(name);
  });

  test("the Authentication pane switches the auth mode and back (#64)", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left oidc mode behind — the admin
    // still signs in (break-glass), and this puts the mode back.
    const reset = await page.request.patch("/api/v1/auth/mode", { data: { mode: "built_in" } });
    expect(reset.ok()).toBe(true);

    // The pane refuses to switch until a provider is registered, so
    // make sure one exists — through the API; the pane's own provider
    // form is covered at the unit seam.
    const listed = await page.request.get("/api/v1/auth/sso-providers");
    expect(listed.ok()).toBe(true);
    const { providers } = z.object({ providers: z.array(z.unknown()) }).parse(await listed.json());
    if (providers.length === 0) {
      const idp = await startMockIssuer();
      try {
        const registered = await page.request.post("/api/v1/auth/sso-providers", {
          data: {
            providerId: `e2e-idp-${Date.now()}`,
            issuer: idp.issuer,
            domain: "sso.example",
            clientId: "openlaw-e2e",
            clientSecret: "e2e-client-secret",
          },
        });
        expect(registered.status(), await registered.text()).toBe(201);
      } finally {
        await idp.close();
      }
    }

    try {
      // The rail journey: Security is a collapsed group until opened.
      await page.goto("/settings/general");
      const rail = page.getByRole("navigation", { name: "Settings sections" });
      await expect(rail.getByRole("link", { name: "Authentication" })).toBeHidden();
      await rail.getByRole("button", { name: "Security" }).click();
      await rail.getByRole("link", { name: "Authentication" }).click();
      await expect(page).toHaveURL(/\/settings\/authentication$/);
      await expect(page).toHaveTitle("Authentication · OpenLaw");

      // Switching is immediate (SET-003): picking the OIDC card PATCHes
      // the mode, and the portal toggle unlocks with it.
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

      // The switch survives a reload — and reverses the same way.
      await page.reload();
      await expect(page.getByRole("radio", { name: "Identity provider (OIDC)" })).toBeChecked();
      const reverted = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/auth/mode") && response.request().method() === "PATCH",
      );
      await page.getByRole("radio", { name: "Built-in" }).check();
      expect((await reverted).ok()).toBe(true);
      await expect(page.getByRole("radio", { name: "Built-in" })).toBeChecked();
    } finally {
      // Leave the shared instance in built-in mode whatever happened.
      await page.request.patch("/api/v1/auth/mode", { data: { mode: "built_in" } });
    }
  });

  test("the Users pane invites a user, resends the invite, and revokes it (#65)", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/settings/general");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await rail.getByRole("link", { name: "Users" }).click();
    await expect(page).toHaveURL(/\/settings\/users$/);
    await expect(page).toHaveTitle("Users · OpenLaw");

    // The Administrator's own row: active, with a real last-active stamp
    // (they signed in moments ago, so it must read as a relative time).
    const adminRow = page.getByRole("row", { name: new RegExp(ADMIN.email) });
    await expect(adminRow.getByText("Active")).toBeVisible();
    await expect(adminRow.getByText(/\bago\b/)).toBeVisible();

    // Per-run unique (TECH-018 never-reset instance), and revoked again
    // below so no pending invite accumulates across runs.
    const email = `e2e-invite-${Date.now()}@e2e.example`;
    await page.getByRole("button", { name: "Invite user" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite user" });
    await dialog.getByLabel("Display name").fill("Pending Invitee");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Contributor" }).click();
    await dialog.getByRole("button", { name: "Send invite" }).click();

    try {
      // The invite is a row, not a fire-and-forget — and it survives a
      // reload with its role because the list route serves it.
      const inviteRow = page.getByRole("row", { name: new RegExp(email) });
      await expect(inviteRow.getByText("Invited")).toBeVisible();
      await expect(inviteRow.getByText("Contributor")).toBeVisible();
      await waitForMailTo(page.request, email);
      await page.reload();
      await expect(inviteRow.getByText("Invited")).toBeVisible();
      await expect(inviteRow.getByText("Contributor")).toBeVisible();

      // Resend delivers a second set-password email.
      await inviteRow.getByRole("button", { name: `Resend the invite to ${email}` }).click();
      await expect(inviteRow.getByText("Saved")).toBeVisible();
      await expect.poll(() => mailCountTo(page.request, email)).toBe(2);

      // Revoke removes the row; the dead-link half is proven at the API
      // seam, where the emailed token is directly in hand.
      await inviteRow.getByRole("button", { name: `Revoke the invite to ${email}` }).click();
      await expect(inviteRow).toHaveCount(0);
    } finally {
      // A failure above must not strand the pending invite on the
      // never-reset instance (TECH-018) — revoke through the API
      // whatever happened; on the happy path there is nothing to find.
      const listed = await page.request.get("/api/v1/users");
      if (listed.ok()) {
        const { users } = z
          .object({ users: z.array(z.object({ id: z.string(), email: z.string() })) })
          .parse(await listed.json());
        const leftover = users.find((user) => user.email === email);
        if (leftover) await page.request.delete(`/api/v1/auth/invites/${leftover.id}`);
      }
    }
  });
});
