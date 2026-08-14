// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared fixtures and instance-state helpers. The persistent instance is
 * never reset between runs (TECH-018), so everything here is written for
 * both worlds: a fresh stack where nothing exists yet, and the
 * accumulated one where earlier runs already left their state behind.
 */

import http from "node:http";
import {
  expect,
  request as apiRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";
import { extractLink, waitForMailTo } from "./mailpit.js";

/** Mirrors playwright.config.ts — helpers that build their own request
 * context need the stack's origin outside any fixture, and so does a
 * spec that reaches the stack outside the browser (the M11 demo polls
 * the readiness probe across a container restart). */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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

/**
 * Switches the theme from its home, the Appearance pane (#62): avatar
 * menu → Settings → theme radio. Leaves the page on /settings/appearance.
 */
export async function switchTheme(
  page: Page,
  displayName: string,
  label: "Light" | "Warm" | "Dark",
): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  // The index lands on Profile (#67); Appearance is one rail hop away.
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Appearance" })
    .click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  const radio = page.getByRole("radio", { name: label });
  if (await radio.isChecked()) return;
  // The pane applies instantly and persists behind the paint; wait for
  // the PATCH so a reload right after the switch cannot race it.
  const persisted = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/me/preferences") && response.request().method() === "PATCH",
  );
  await radio.check();
  expect((await persisted).ok()).toBe(true);
}

/** Signs out through the shell's header user menu (#41). */
export async function signOut(page: Page, displayName: string): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
}

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

/**
 * Guarantees a registered SSO provider, which the Authentication pane
 * requires before it lets the auth mode switch to OIDC. Registers one
 * against a throwaway mock issuer when the instance has none; on the
 * never-reset instance (TECH-018) an earlier run's provider counts.
 * The request context must carry an Administrator session.
 */
export async function ensureSsoProviderExists(request: APIRequestContext): Promise<void> {
  const listed = await request.get("/api/v1/auth/sso-providers");
  expect(listed.ok()).toBe(true);
  const { providers } = z.object({ providers: z.array(z.unknown()) }).parse(await listed.json());
  if (providers.length > 0) return;
  const idp = await startMockIssuer();
  try {
    const registered = await request.post("/api/v1/auth/sso-providers", {
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

/** One axe finding, as the runner reports it. */
export type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

/**
 * Scans a page with axe-core and reports what it found (#48, DES-011).
 *
 * Reporting is the default and failing is the caller's choice. The
 * whole-page scans in the accessibility floor spec are an advisory
 * triage signal: violations are printed to the runner output (and
 * raised as GitHub warning annotations in CI) and attached to the
 * report, but they do not fail the run. A caller that owns a surface —
 * a milestone spec scanning the chrome it just built — asserts on the
 * answer instead.
 *
 * `include` narrows the scan to one CSS selector's subtree, which is
 * what makes the second use honest: a spec can gate its own surface
 * without adopting every finding on the page around it.
 */
export async function reportAxeViolations(
  page: Page,
  testInfo: TestInfo,
  label: string,
  options: { disableRules?: string[]; include?: string } = {},
): Promise<AxeViolation[]> {
  let builder = new AxeBuilder({ page }).disableRules(options.disableRules ?? []);
  if (options.include !== undefined) builder = builder.include(options.include);
  const results = await builder.analyze();
  await testInfo.attach(`axe-${label}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  if (results.violations.length === 0) {
    console.log(`axe(${label}): no violations.`);
    return results.violations;
  }
  for (const violation of results.violations) {
    const targets = violation.nodes.map((node) => node.target.join(" ")).join("; ");
    const line = `axe(${label}): [${violation.impact ?? "unknown"}] ${violation.id} — ${violation.help} (${targets})`;
    console.log(line);
    if (process.env.CI) console.log(`::warning title=New axe violation::${line}`);
  }
  return results.violations;
}

/** A per-run staff member with a live session of their own. */
export interface OnboardedMember {
  context: BrowserContext;
  page: Page;
}

/**
 * Onboards a per-run member through the real flows: invite → the
 * set-password email → their own sign-in, in a second browser context
 * so their session lives alongside the caller's. The request context
 * must carry an Administrator session. From the moment this is called
 * the user row exists, so callers clean up with ensureMemberInert in a
 * finally that covers this call too — activation can fail partway.
 */
export async function onboardActivatedMember(
  request: APIRequestContext,
  browser: Browser,
  member: { email: string; displayName: string; role: string; password: string },
): Promise<OnboardedMember> {
  const invited = await request.post("/api/v1/auth/invites", {
    data: { email: member.email, displayName: member.displayName, role: member.role },
  });
  expect(invited.status()).toBe(201);

  const context = await browser.newContext();
  try {
    const mail = await waitForMailTo(request, member.email);
    const link = extractLink(mail.text, "/auth/set-password");
    const page = await context.newPage();
    await page.goto(link);
    await page.getByLabel("New password").fill(member.password);
    await page.getByLabel("Confirm password").fill(member.password);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText("Password set")).toBeVisible();
    await signInAs(page, member.email, member.password, member.displayName);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Leaves a per-run member inert on the never-reset instance (TECH-018),
 * whatever state a failure stranded them in: a still-pending invite
 * (activation failed) is revoked outright; an activated user cannot be
 * deleted, so archived is their resting state. The request context must
 * carry an Administrator session.
 */
export async function ensureMemberInert(request: APIRequestContext, email: string): Promise<void> {
  const listed = await request.get("/api/v1/users");
  if (!listed.ok()) return;
  const { users } = z
    .object({ users: z.array(z.object({ id: z.string(), email: z.string(), status: z.string() })) })
    .parse(await listed.json());
  const member = users.find((user) => user.email === email);
  if (!member) return;
  if (member.status === "invited") {
    await request.delete(`/api/v1/auth/invites/${member.id}`);
  } else if (member.status !== "archived") {
    await request.post(`/api/v1/users/${member.id}/archive`);
  }
}
