// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The full staff-onboarding journey (#24, TECH-018): the Administrator
 * invites a Legal Team Member through the invites API (no invite UI
 * exists yet — the API is the legitimate front door), the set-password
 * email arrives via the stack's real SMTP into Mailpit, its link
 * activates the account, and the new member enrols in TOTP and signs
 * back in through the challenge — with a live code, then a backup code.
 *
 * One journey, serial by construction: each test hands state (secret,
 * backup codes) to the next, and the per-run unique invitee keeps
 * reruns clean on the never-reset persistent instance. 2FA stays
 * enabled on the per-run user forever after; nobody signs in as it
 * again.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs, submitLogin, uniqueEmail } from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";
import { totp } from "./totp.js";

const MEMBER = {
  email: uniqueEmail("staff"),
  displayName: "Sam Staffer",
  password: "till-dawn-we-ride",
} as const;

/**
 * Fills a code field and submits, retrying once with a freshly computed
 * code if the server rejects it — a code computed astride a 30-second
 * TOTP window boundary is stale by the time it arrives, and one retry
 * inside the new window settles it.
 */
async function submitLiveCode(
  page: Page,
  secret: string,
  submitName: string,
  success: Locator,
  rejection: Locator,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    await page.getByLabel("Code", { exact: true }).fill(totp(secret));
    await page.getByRole("button", { name: submitName }).click();
    await expect(success.or(rejection).first()).toBeVisible();
    if (await success.isVisible()) return;
    expect(attempt, "a second freshly computed TOTP code was also rejected").toBeLessThan(1);
  }
}

test.describe.serial("invite → activation → TOTP", () => {
  let totpSecret: string;
  let backupCodes: string[];

  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("the invite email activates the account and the member signs in", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // page.request rides the browser session's cookie jar, so this is
    // the Administrator making the call — not an anonymous API client.
    const invited = await page.request.post("/api/v1/auth/invites", {
      data: {
        email: MEMBER.email,
        displayName: MEMBER.displayName,
        role: "legal_team_member",
      },
    });
    expect(invited.status()).toBe(201);

    const mail = await waitForMailTo(page.request, MEMBER.email);
    expect(mail.subject).toBe("Set your OpenLaw password");
    const link = extractLink(mail.text, "/auth/set-password");

    // The invitee redeems the link, not the Administrator: hand the
    // browser over before following it.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);

    // Redeem exactly the link the email carries — a wrong BASE_URL on
    // the stack must fail here, not be papered over by rewriting it.
    await page.goto(link);
    await page.getByLabel("New password").fill(MEMBER.password);
    await page.getByLabel("Confirm password").fill(MEMBER.password);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText("Password set")).toBeVisible();

    await signInAs(page, MEMBER.email, MEMBER.password, MEMBER.displayName);
  });

  test("TOTP enrolment arms with an in-test computed code", async ({ page }) => {
    await signInAs(page, MEMBER.email, MEMBER.password, MEMBER.displayName);
    await page.goto("/auth/two-factor/enroll");

    await page.getByLabel("Password").fill(MEMBER.password);
    await page.getByRole("button", { name: "Turn on two-factor" }).click();

    // The suite is the authenticator app: it reads the manual-entry
    // secret the page shows instead of scanning the QR code.
    const secret = await page
      .locator("p", { hasText: "Enter this secret manually" })
      .locator("span")
      .innerText();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    totpSecret = secret;

    await submitLiveCode(
      page,
      totpSecret,
      "Confirm",
      page.getByText("Save these backup codes"),
      page.getByText("Wrong code. Scan the QR code again"),
    );

    // Backup codes are shown this once and never again — capture them
    // now; the last test spends one.
    backupCodes = await page.getByRole("listitem").allInnerTexts();
    expect(backupCodes.length).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Done" }).click();
    await expect(page).toHaveURL("/");
  });

  test("sign-in now challenges, and a live code passes it", async ({ page }) => {
    await submitLogin(page, MEMBER.email, MEMBER.password);
    await expect(page).toHaveURL(/\/auth\/two-factor$/);

    await submitLiveCode(
      page,
      totpSecret,
      "Verify",
      page.getByRole("banner"),
      page.getByText("Wrong code. Try again"),
    );
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("banner").getByText(MEMBER.displayName)).toBeVisible();
  });

  test("a backup code passes the challenge — once", async ({ page }) => {
    const spent = backupCodes[0]!;

    await submitLogin(page, MEMBER.email, MEMBER.password);
    await expect(page).toHaveURL(/\/auth\/two-factor$/);
    await page.getByRole("button", { name: "Use a backup code" }).click();
    await page.getByLabel("Backup code").fill(spent);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("banner").getByText(MEMBER.displayName)).toBeVisible();

    // Each backup code works exactly once: replaying the spent one on a
    // fresh challenge must fail.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await submitLogin(page, MEMBER.email, MEMBER.password);
    await expect(page).toHaveURL(/\/auth\/two-factor$/);
    await page.getByRole("button", { name: "Use a backup code" }).click();
    await page.getByLabel("Backup code").fill(spent);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Wrong code. Try again")).toBeVisible();
  });
});
