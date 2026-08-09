// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Password sign-in: the credential path staff use every day, and the
 * anti-enumeration property that protects it — a wrong password earns
 * the same answer whether or not the account exists.
 */

import { test, expect } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs, uniqueEmail } from "./helpers";

test.describe("password sign-in", () => {
  test("correct credentials land in the app", async ({ page, request }) => {
    await ensureAdminExists(request);
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  });

  test("a wrong password never reveals whether the account exists", async ({ request }) => {
    await ensureAdminExists(request);
    const attempt = (email: string) =>
      request.post("/api/auth/sign-in/email", {
        data: { email, password: "wrong-password-on-purpose" },
      });

    const existing = await attempt(ADMIN.email);
    const ghost = await attempt(uniqueEmail("ghost"));

    // Equality, not copy-matching: whatever the refusal looks like, it
    // must be byte-identical for a real account and an invented one.
    expect(existing.status()).toBe(401);
    expect(ghost.status()).toBe(existing.status());
    expect(await ghost.text()).toBe(await existing.text());
  });
});
