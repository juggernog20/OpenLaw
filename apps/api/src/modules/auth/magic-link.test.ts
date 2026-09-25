// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, orgSettings, sql, users, verifications } from "@openlaw/db";
import {
  linkFrom,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;

/** The allowlist most tests run under; individual tests that change the
 * row restore it so ordering stays local. */
const ALLOWED_DOMAINS = ["example.com", "acme.example"];

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  // No Settings surface exists yet (it ships with its module); configure
  // the seeded row directly, the same way tests time-travel tokens.
  await harness.db.update(orgSettings).set({ allowedEmailDomains: ALLOWED_DOMAINS });
});

afterAll(async () => {
  await harness.stop();
});

/** POST /api/v1/auth/magic-link — the typed issuance route. */
async function requestLink(email: string) {
  return harness.app.inject({ method: "POST", url: "/api/v1/auth/magic-link", payload: { email } });
}

/** Follows the emailed link through the mounted better-auth handler. */
async function redeem(link: string) {
  const url = new URL(link);
  return harness.app.inject({ method: "GET", url: url.pathname + url.search });
}

/** The session cookies set by a response, or null if none were. */
function sessionCookies(res: Awaited<ReturnType<typeof redeem>>): Record<string, string> | null {
  const cookies: Record<string, string> = {};
  for (const c of res.cookies) if (c.value) cookies[c.name] = c.value;
  return Object.keys(cookies).some((name) => name.includes("session_token")) ? cookies : null;
}

describe("magic-link portal auth (POST /api/v1/auth/magic-link)", () => {
  it("emails an allowlisted address a link that redeems into a Business User session", async () => {
    const email = "requester@acme.example";
    const res = await requestLink(email);
    expect(res.statusCode, res.body).toBe(202);

    const mail = harness.mailer.messagesTo(email);
    expect(mail).toHaveLength(1);

    const redeemed = await redeem(linkFrom(mail[0]!.text));
    expect(redeemed.statusCode, redeemed.body).toBe(302);
    expect(redeemed.headers.location).not.toContain("error");
    const cookies = sessionCookies(redeemed);
    expect(cookies, "redemption set no session cookie").not.toBeNull();

    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookies! });
    expect(me.statusCode, me.body).toBe(200);
    // JIT-provisioned per DD-010: Business User, display name defaulted.
    expect(me.json().user).toMatchObject({ email, role: "business_user" });
    expect(me.json().user.displayName).not.toHaveLength(0);
  });

  it("answers a non-allowlisted address identically, without sending anything", async () => {
    const allowed = await requestLink("colleague@acme.example");
    const denied = await requestLink("mallory@evil.example");

    expect(denied.statusCode).toBe(allowed.statusCode);
    expect(denied.body).toBe(allowed.body);
    expect(harness.mailer.messagesTo("mallory@evil.example")).toHaveLength(0);
  });

  it("holds the allowlist on better-auth's raw sign-in path too", async () => {
    const raw = (email: string) =>
      harness.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/magic-link",
        payload: { email },
      });

    const allowed = await raw("direct@acme.example");
    const denied = await raw("mallory@evil.example");

    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(denied.statusCode).toBe(allowed.statusCode);
    expect(denied.body).toBe(allowed.body);
    expect(harness.mailer.messagesTo("mallory@evil.example")).toHaveLength(0);
  });

  it("rejects a second redemption of the same link", async () => {
    const email = "single-use@acme.example";
    await requestLink(email);
    const link = linkFrom(harness.mailer.messagesTo(email)[0]!.text);

    const first = await redeem(link);
    expect(sessionCookies(first), "first redemption should sign in").not.toBeNull();

    const second = await redeem(link);
    expect(sessionCookies(second), "second redemption must not sign in").toBeNull();
    expect(second.headers.location ?? "").toContain("error");
  });

  it("rejects an expired link", async () => {
    const email = "latecomer@acme.example";
    await requestLink(email);
    const link = linkFrom(harness.mailer.messagesTo(email)[0]!.text);

    // Age every outstanding token past expiry — time travel via the
    // database, since the HTTP seam offers no clock.
    await harness.db.update(verifications).set({ expiresAt: sql`now() - interval '1 minute'` });

    const res = await redeem(link);
    expect(sessionCookies(res), "expired link must not sign in").toBeNull();
    const noUser = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    expect(noUser).toHaveLength(0);
  });

  it("stores the magic-link token hashed at rest", async () => {
    const email = "hashed@acme.example";
    // Only the rows this issuance creates prove anything — earlier tests
    // leave verification rows behind.
    const before = new Set(
      (await harness.db.select({ id: verifications.id }).from(verifications)).map((r) => r.id),
    );
    await requestLink(email);
    const link = linkFrom(harness.mailer.messagesTo(email)[0]!.text);
    const token = new URL(link).searchParams.get("token")!;
    expect(token).toBeTruthy();

    const rows = (await harness.db.select().from(verifications)).filter((r) => !before.has(r.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.identifier.includes(token) || row.value.includes(token))).toBe(
      false,
    );
  });

  it("disables issuance entirely when the toggle is off", async () => {
    await harness.db.update(orgSettings).set({ magicLinkEnabled: false });
    try {
      const typed = await requestLink("anyone@acme.example");
      expect(typed.statusCode).toBe(403);
      expect(typed.headers["content-type"]).toContain("application/problem+json");

      const raw = await harness.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/magic-link",
        payload: { email: "anyone@acme.example" },
      });
      expect(raw.statusCode).toBe(403);
      expect(harness.mailer.messagesTo("anyone@acme.example")).toHaveLength(0);
    } finally {
      await harness.db.update(orgSettings).set({ magicLinkEnabled: true });
    }
  });

  it("refuses uniformly when the deployment cannot send email", async () => {
    // Without this refusal the send throws for allowlisted addresses and
    // nobody else, so the status code alone tells an anonymous visitor
    // which domains are on the DD-010 allowlist — the exact oracle the
    // identical-response design exists to deny.
    harness.mailer.configured = false;
    try {
      const allowed = await requestLink("someone@acme.example");
      const denied = await requestLink("mallory@evil.example");
      expect(allowed.statusCode).toBe(403);
      expect(allowed.headers["content-type"]).toContain("application/problem+json");
      expect(denied.statusCode).toBe(allowed.statusCode);
      // The content type is part of the response an anonymous visitor can
      // see, so it has to match too — a problem+json for one address and
      // anything else for another would rebuild the same oracle.
      expect(denied.headers["content-type"]).toBe(allowed.headers["content-type"]);
      expect(denied.body).toBe(allowed.body);

      const raw = (email: string) =>
        harness.app.inject({
          method: "POST",
          url: "/api/auth/sign-in/magic-link",
          payload: { email },
        });
      const rawAllowed = await raw("someone@acme.example");
      const rawDenied = await raw("mallory@evil.example");
      expect(rawAllowed.statusCode).toBe(403);
      expect(rawDenied.statusCode).toBe(rawAllowed.statusCode);
      expect(rawDenied.headers["content-type"]).toBe(rawAllowed.headers["content-type"]);
      expect(rawDenied.body).toBe(rawAllowed.body);

      expect(harness.mailer.messagesTo("someone@acme.example")).toHaveLength(0);
      // Refusal is complete: no link, and no JIT account either.
      const noUser = await harness.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "someone@acme.example"));
      expect(noUser, "a refused request must not create an account").toHaveLength(0);
    } finally {
      harness.mailer.configured = true;
    }
  });

  it("issues again once email is configured", async () => {
    const email = "someone@acme.example";
    const res = await requestLink(email);
    expect(res.statusCode, res.body).toBe(202);
    expect(harness.mailer.messagesTo(email)).toHaveLength(1);
  });

  it("rejects redemption of an already-issued link once the toggle is off", async () => {
    const email = "in-flight@acme.example";
    await requestLink(email);
    const link = linkFrom(harness.mailer.messagesTo(email)[0]!.text);

    await harness.db.update(orgSettings).set({ magicLinkEnabled: false });
    try {
      const res = await redeem(link);
      expect(sessionCookies(res), "redemption while disabled must not sign in").toBeNull();
    } finally {
      await harness.db.update(orgSettings).set({ magicLinkEnabled: true });
    }
  });

  it("keeps an existing staff user's role when they redeem a magic link", async () => {
    const res = await requestLink(TEST_ADMIN.email);
    expect(res.statusCode, res.body).toBe(202);
    // The magic-link mail is the latest of the admin's captured messages.
    const mail = harness.mailer.messagesTo(TEST_ADMIN.email);
    const redeemed = await redeem(linkFrom(mail.at(-1)!.text));
    const cookies = sessionCookies(redeemed);
    expect(cookies, "staff redemption should sign in").not.toBeNull();

    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookies! });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().user).toMatchObject({ email: TEST_ADMIN.email, role: "administrator" });
  });

  it("rejects redemption when the domain left the allowlist after issuance", async () => {
    const email = "revoked@acme.example";
    await requestLink(email);
    const link = linkFrom(harness.mailer.messagesTo(email)[0]!.text);

    await harness.db.update(orgSettings).set({ allowedEmailDomains: ["example.com"] });
    try {
      const res = await redeem(link);
      expect(sessionCookies(res), "revoked domain must not sign in").toBeNull();
      const noUser = await harness.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      expect(noUser).toHaveLength(0);
    } finally {
      await harness.db.update(orgSettings).set({ allowedEmailDomains: ALLOWED_DOMAINS });
    }
  });

  it("keeps an invited staffer's password and role after they redeem a magic link", async () => {
    const adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const invitee = {
      email: "casey@example.com",
      displayName: "Casey Reyes",
      role: "legal_team_member",
    };
    const invited = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies: adminCookies,
      payload: invitee,
    });
    expect(invited.statusCode, invited.body).toBe(201);

    const setToken = tokenFrom(harness.mailer.messagesTo(invitee.email)[0]!.text);
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "casey-sets-her-own", token: setToken },
    });
    expect(reset.statusCode, reset.body).toBe(200);

    await requestLink(invitee.email);
    const redeemed = await redeem(linkFrom(harness.mailer.messagesTo(invitee.email).at(-1)!.text));
    expect(sessionCookies(redeemed), "staffer redemption should sign in").not.toBeNull();

    // The password credential survived the redemption (activation proved
    // the inbox, so the plugin's unproven-account revocation must not
    // fire), and the invited role is untouched.
    const cookies = await signInCookies(harness.app, invitee.email, "casey-sets-her-own");
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookies! });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().user).toMatchObject({ email: invitee.email, role: "legal_team_member" });
  });

  it("survives sign-in for the admin afterwards — settings churn never touched accounts", async () => {
    await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  });
});

it.each(["legal", "business"])(
  "preserves the magic-link marker on a non-token %s refusal",
  async (group) => {
    const email = `refused-${group}@example.com`;
    const issued = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email, group },
    });
    expect(issued.statusCode, issued.body).toBe(202);
    const link = linkFrom(harness.mailer.messagesTo(email).at(-1)!.text);
    await harness.db.update(orgSettings).set({ allowedEmailDomains: [] });
    try {
      const response = await redeem(link);
      expect(response.statusCode, response.body).toBe(302);
      const location = new URL(response.headers.location!);
      expect(location.pathname).toBe(group === "business" ? "/portal/login" : "/auth/login");
      expect(location.searchParams.get("method")).toBe("magic-link");
      expect(location.searchParams.get("error")).toBeTruthy();
      expect(location.searchParams.get("error")).not.toBe("INVALID_TOKEN");
    } finally {
      await harness.db.update(orgSettings).set({ allowedEmailDomains: ALLOWED_DOMAINS });
    }
  },
);

it.each(["legal", "business"])(
  "redirects a refused magic-link session back to the %s sign-in page",
  async (group) => {
    const email = "requester@acme.example";
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email, group },
    });
    const link = linkFrom(harness.mailer.messagesTo(email).at(-1)!.text);
    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.email, email));
    try {
      const response = await redeem(link);
      expect(response.statusCode, response.body).toBe(302);
      const location = new URL(response.headers.location!);
      expect(location.pathname).toBe(group === "business" ? "/portal/login" : "/auth/login");
      expect(location.searchParams.get("method")).toBe("magic-link");
      expect(location.searchParams.get("error")).toBe("failed_to_create_session");
      expect(sessionCookies(response)).toBeNull();
    } finally {
      await harness.db.update(users).set({ archivedAt: null }).where(eq(users.email, email));
    }
  },
);

it.each(["/api/v1/auth/magic-link", "/api/auth/sign-in/magic-link"])(
  "sends existing Business Users outside the allowlist a link through %s",
  async (endpoint) => {
    const email = endpoint.startsWith("/api/v1")
      ? "invited@external.example"
      : "existing@external.example";
    const created = await harness.app.auth.api.createUser({
      body: { email, name: "Invited colleague", role: "business_user" },
    });
    const issued = await harness.app.inject({
      method: "POST",
      url: endpoint,
      payload: endpoint.startsWith("/api/v1")
        ? { email, group: "legal" }
        : { email, callbackURL: "/portal" },
    });
    expect(issued.statusCode, issued.body).toBe(endpoint.startsWith("/api/v1") ? 202 : 200);
    const mail = harness.mailer.messagesTo(email);
    expect(mail).toHaveLength(1);
    const response = await redeem(linkFrom(mail[0]!.text));
    expect(new URL(response.headers.location!).pathname).toBe("/portal");
    const cookies = sessionCookies(response);
    expect(cookies).not.toBeNull();
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookies! });
    expect(me.json().user).toMatchObject({ id: created.user.id, role: "business_user" });
    const staff = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts",
      cookies: cookies!,
    });
    expect(staff.statusCode).toBe(403);
    await harness.db
      .update(users)
      .set({ archivedAt: new Date() })
      .where(eq(users.id, created.user.id));
    await harness.app.inject({ method: "POST", url: endpoint, payload: { email } });
    expect(harness.mailer.messagesTo(email)).toHaveLength(1);
    const unknown = "unknown@external.example";
    await harness.app.inject({ method: "POST", url: endpoint, payload: { email: unknown } });
    expect(harness.mailer.messagesTo(unknown)).toHaveLength(0);
  },
);

describe("the request budget (TECH-032)", () => {
  // Each test names its own client address, so the budget one test
  // spends never leaks into the next, nor into the suite above, which
  // sends from the default address.
  const ask = (email: string, remoteAddress: string) =>
    harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      remoteAddress,
      payload: { email },
    });

  it("issues thirty links to distinct addresses from one client address and refuses the thirty-first", async () => {
    const address = "192.0.2.77";
    const email = (n: number) => `budgeted-${n}@acme.example`;
    for (let n = 1; n <= 30; n++) {
      const res = await ask(email(n), address);
      expect(res.statusCode, `request ${n}: ${res.body}`).toBe(202);
      expect(harness.mailer.messagesTo(email(n))).toHaveLength(1);
    }
    const refused = await ask(email(31), address);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(harness.mailer.messagesTo(email(31))).toHaveLength(0);
  });

  it("issues three links to one address in a window and refuses the fourth, eligible or not", async () => {
    const email = "outsider@evil.example";
    const address = "192.0.2.78";
    for (let n = 0; n < 3; n++) expect((await ask(email, address)).statusCode).toBe(202);
    expect((await ask(email, address)).statusCode).toBe(429);
    // Refused the same way as an eligible address, and nothing was sent.
    expect(harness.mailer.messagesTo(email)).toHaveLength(0);
  });
});

it.each(["legal", "business"] as const)(
  "returns a magic-link session to the %s login with the exact OAuth query",
  async (group) => {
    const email = `oauth-${group}@acme.example`;
    const callbackURL = `${group === "business" ? "/portal/login" : "/auth/login"}?client_id=claude&state=a%2fb&sig=signed%2Bvalue&exp=123&ba_iat=100&ba_param=scope`;
    const sent = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email, group, callbackURL },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const link = linkFrom(harness.mailer.messagesTo(email).at(-1)!.text);
    expect(decodeURIComponent(new URL(link).searchParams.get("callbackURL")!)).toBe(callbackURL);
    const redeemed = await redeem(link);
    expect(redeemed.statusCode, redeemed.body).toBe(302);
    expect(
      new URL(redeemed.headers.location!, harness.app.baseUrl).pathname +
        new URL(redeemed.headers.location!, harness.app.baseUrl).search,
    ).toBe(callbackURL);
    expect(sessionCookies(redeemed)).not.toBeNull();
  },
);

it.each([
  "https://evil.example/auth/login?sig=x",
  "//evil.example/auth/login?sig=x",
  "/auth/login/evil?sig=x",
  "/auth/login?sig=x#fragment",
  "/portal",
])("refuses an arbitrary magic-link callback %s", async (callbackURL) => {
  const sent = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/magic-link",
    payload: { email: "callback@acme.example", callbackURL },
  });
  expect(sent.statusCode, sent.body).toBe(400);
});
