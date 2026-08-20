// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Business User portal-access journey (#25, TECH-018), closing the
 * auth epic's acceptance: the Administrator allowlists a per-run unique
 * domain through the API front door (#22), a requester on that domain
 * asks the login screen for a magic link, the mail arrives through real
 * SMTP, and redemption JIT-provisions a Business User — while an
 * ineligible address gets the identical 202 and no mail. The remaining
 * route guards close it out: a signed-in visit to the login route
 * bounces home, and a dead link lands on the link-expired page.
 *
 * The per-run domain keeps reruns collision-free on the never-reset
 * persistent instance; stale domains from earlier runs are pruned on
 * the way in so the allowlist does not grow without bound.
 */

import { test, expect } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { extractLink, mailCountTo, waitForMailTo } from "./mailpit.js";

const RUN_DOMAIN = `e2e-${Date.now()}.example`;
const REQUESTER = `requester@${RUN_DOMAIN}`;

const DomainsEnvelope = z.object({ domains: z.array(z.string()) });

test.describe.serial("magic link → JIT provisioning → route guards", () => {
  let magicLink: string;

  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("the admin allowlists the run's domain through the API front door", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Replace-the-list semantics (#22): read what is there, prune the
    // domains earlier runs left behind, and add this run's.
    const read = await page.request.get("/api/v1/auth/allowed-domains");
    expect(read.status()).toBe(200);
    const { domains: existing } = DomainsEnvelope.parse(await read.json());
    const kept = existing.filter((domain) => !/^e2e-\d+\.example$/.test(domain));

    const written = await page.request.put("/api/v1/auth/allowed-domains", {
      data: { domains: [...kept, RUN_DOMAIN] },
    });
    expect(written.status()).toBe(200);
    const { domains } = DomainsEnvelope.parse(await written.json());
    expect(domains).toContain(RUN_DOMAIN);
  });

  test("an eligible requester asks the login screen for a link and mail arrives", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Email").fill(REQUESTER);
    await page.getByRole("button", { name: "Send link" }).click();

    // The sent screen is the same whether or not mail goes out; Mailpit
    // is what proves delivery.
    await expect(page.getByText("Check your email")).toBeVisible();

    const mail = await waitForMailTo(page.request, REQUESTER);
    expect(mail.subject).toBe("Sign in to OpenLaw");
    magicLink = extractLink(mail.text, "/api/auth/magic-link/verify");
  });

  test("an ineligible address gets the identical 202 — and no mail", async ({ request }) => {
    const ghost = `requester@ghost-${Date.now()}.example`;

    // Ineligible first, eligible second: when the second's mail has
    // arrived, the SMTP pipeline has demonstrably flushed past the
    // point where the first's would have appeared.
    const ineligible = await request.post("/api/v1/auth/magic-link", {
      data: { email: ghost },
    });
    const eligible = await request.post("/api/v1/auth/magic-link", {
      data: { email: `second@${RUN_DOMAIN}` },
    });
    expect(eligible.status()).toBe(202);
    expect(ineligible.status()).toBe(eligible.status());
    expect(await ineligible.text()).toBe(await eligible.text());

    await waitForMailTo(request, `second@${RUN_DOMAIN}`);
    expect(await mailCountTo(request, ghost)).toBe(0);
  });

  test("redeeming the link JIT-provisions a Business User", async ({ page }) => {
    await page.goto(magicLink);
    // The verify endpoint's callback is "/", and the root guard forwards
    // a Business User from there to the portal — the surface that is
    // theirs (INT-001, #376).
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { name: "What do you need from Legal?" })).toBeVisible();

    // DD-010: an unknown identity on an allowed domain is admitted as
    // exactly a Business User — the me endpoint carries the live role.
    const me = await page.request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    const { user } = z
      .object({ user: z.object({ email: z.string(), role: z.string() }) })
      .parse(await me.json());
    expect(user.email).toBe(REQUESTER);
    expect(user.role).toBe("business_user");
  });

  test("route guards: dead links land on link-expired; signed-in login visits bounce home", async ({
    page,
  }) => {
    // The link was spent in the previous test; tokens work once. The
    // verify endpoint redirects to "/?error=", and the root guard
    // forwards that here before any session check.
    await page.goto(magicLink);
    await expect(page).toHaveURL(/\/auth\/link-expired$/);
    await expect(page.getByText("Sign-in link expired")).toBeVisible();

    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/auth/login");
    await expect(page).toHaveURL("/");
  });
});
