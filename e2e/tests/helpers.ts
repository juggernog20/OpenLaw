// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared fixtures and instance-state helpers. The persistent instance is
 * never reset between runs (TECH-018), so everything here is written for
 * both worlds: a fresh stack where nothing exists yet, and the
 * accumulated one where earlier runs already left their state behind.
 */

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The instance's Administrator. Stable across runs on purpose — the
 * bootstrap probe creates it on a fresh instance and signs in with it
 * ever after. Matches the API harness's TEST_ADMIN so one set of
 * credentials works everywhere.
 */
export const ADMIN = {
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  password: "correct-horse-battery",
} as const;

/**
 * A per-run unique address. Anything a run creates (users, invites)
 * must not collide with what previous runs left in the instance.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}@example.com`;
}

/** Whether first-run setup is still open, straight from the API. */
export async function needsSetup(request: APIRequestContext): Promise<boolean> {
  const probe = await request.get("/api/v1/auth/setup");
  expect(probe.status()).toBe(200);
  const body = (await probe.json()) as { needsSetup: boolean };
  return body.needsSetup;
}

/**
 * Guarantees the Administrator exists, via the API. Suites that are not
 * about first-run setup call this in beforeAll so each spec file also
 * passes alone against a fresh stack; in a full run the bootstrap spec
 * has already done this through the browser and it no-ops.
 */
export async function ensureAdminExists(request: APIRequestContext): Promise<void> {
  if (!(await needsSetup(request))) return;
  const created = await request.post("/api/v1/auth/setup", { data: ADMIN });
  // 201 wins the race; 409 means someone else just did — both mean done.
  expect([201, 409]).toContain(created.status());
}

/**
 * Fills and submits the login form. Where the submission lands depends
 * on the account — home, or the two-factor challenge — so callers
 * assert the destination themselves.
 */
export async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in through the login screen and lands on the guarded home. */
export async function signInAs(
  page: Page,
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  await submitLogin(page, email, password);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("banner").getByText(displayName)).toBeVisible();
}
