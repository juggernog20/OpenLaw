// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared fixtures and instance-state helpers. The persistent instance is
 * never reset between runs (TECH-018), so everything here is written for
 * both worlds: a fresh stack where nothing exists yet, and the
 * accumulated one where earlier runs already left their state behind.
 */

import { expect, request as apiRequest, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

/** Mirrors playwright.config.ts — helpers that build their own request
 * context need the stack's origin outside any fixture. */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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
  return z.object({ needsSetup: z.boolean() }).parse(await probe.json()).needsSetup;
}

/**
 * Signs in as the Administrator over the API and marks SET-004
 * onboarding complete (idempotent), so browser journeys land on home
 * instead of the wizard. Also covers instances migrated from before the
 * wizard existed, whose completion timestamp starts NULL.
 */
export async function ensureOnboardingComplete(): Promise<void> {
  // A throwaway context: the admin session this creates must never leak
  // into a caller's cookie jar — a jar with a session makes better-auth
  // treat later Origin-less requests as CSRF (403), changing what the
  // anti-enumeration tests observe.
  const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const signedIn = await ctx.post("/api/auth/sign-in/email", {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(signedIn.ok()).toBe(true);
    const completed = await ctx.post("/api/v1/onboarding/complete");
    expect(completed.ok()).toBe(true);
  } finally {
    await ctx.dispose();
  }
}

/**
 * Guarantees the Administrator exists and onboarding is closed, via the
 * API. Suites that are not about first-run flows call this in beforeAll
 * so each spec file also passes alone against a fresh stack; in a full
 * run the bootstrap spec has already done both through the browser.
 */
export async function ensureAdminExists(request: APIRequestContext): Promise<void> {
  if (await needsSetup(request)) {
    // Setup answers with the creator's session cookie; keep it out of
    // the caller's jar for the same reason as ensureOnboardingComplete.
    const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
    try {
      const created = await ctx.post("/api/v1/auth/setup", { data: ADMIN });
      // 201 wins the race; 409 means someone else just did — both mean done.
      expect([201, 409]).toContain(created.status());
    } finally {
      await ctx.dispose();
    }
  }
  await ensureOnboardingComplete();
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
  // The shell header (#41) shows the signed-in identity as the user
  // menu's avatar; the display name is its accessible name.
  await expect(page.getByRole("banner").getByRole("button", { name: displayName })).toBeVisible();
}

/** Signs out through the shell's header user menu (#41). */
export async function signOut(page: Page, displayName: string): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
}
