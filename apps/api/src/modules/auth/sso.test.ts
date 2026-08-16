// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime BYO-OIDC (TECH-008): the provider is registered through the
 * real admin endpoint against an in-process mock OIDC issuer, then every
 * flow runs the full authorize → callback → session round trip at the
 * HTTP seam — the BYO-IdP feature doubles as its own test fixture.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OAuth2Server } from "oauth2-mock-server";
import {
  accounts,
  activityLog,
  and,
  asc,
  eq,
  orgSettings,
  sql,
  ssoProviders,
  SECRET_ENVELOPE_PREFIX,
  users,
} from "@openlaw/db";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let idp: OAuth2Server;
let issuerUrl: string;
let adminCookies: Record<string, string>;

/** The identity the mock IdP asserts on its next userinfo response. */
let idpIdentity: { sub: string; email: string; name?: string };

const ALLOWED_DOMAINS = ["acme.example"];

const PROVIDER = {
  providerId: "acme-idp",
  domain: "acme.example",
  clientId: "openlaw",
  clientSecret: "test-client-secret",
} as const;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  await harness.db.update(orgSettings).set({ allowedEmailDomains: ALLOWED_DOMAINS });
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  // A real (in-process) OIDC issuer: discovery, authorize, token, JWKS
  // and userinfo endpoints over HTTP on a random localhost port.
  idp = new OAuth2Server();
  await idp.issuer.keys.generate("RS256");
  await idp.start(0);
  issuerUrl = idp.issuer.url!;
  idp.service.on("beforeUserinfo", (userInfoResponse) => {
    userInfoResponse.body = {
      sub: idpIdentity.sub,
      email: idpIdentity.email,
      name: idpIdentity.name ?? "",
    };
  });
}, 120_000);

afterAll(async () => {
  await idp.stop();
  await harness.stop();
});

/** Registers PROVIDER through the typed admin route. */
async function registerProvider(
  cookies: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/sso-providers",
    cookies,
    payload: { ...PROVIDER, issuer: issuerUrl, ...overrides },
  });
}

/** The session cookies set by a response, or null if none were. */
function sessionCookies(res: {
  cookies: { name: string; value: string }[];
}): Record<string, string> | null {
  const cookies: Record<string, string> = {};
  for (const c of res.cookies) if (c.value) cookies[c.name] = c.value;
  return Object.keys(cookies).some((name) => name.includes("session_token")) ? cookies : null;
}

/**
 * The full browser round trip: sign-in at OpenLaw, authorize at the IdP
 * (which asserts `identity`), then the callback redirect — carrying the
 * state cookie between the two OpenLaw requests like a browser would.
 */
async function ssoRoundTrip(
  identity: { sub: string; email: string; name?: string },
  signInBody: Record<string, unknown>,
) {
  idpIdentity = identity;
  const start = await harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/sso",
    payload: { callbackURL: "/portal", ...signInBody },
  });
  expect(start.statusCode, start.body).toBe(200);
  const authUrl: string = start.json().url;
  expect(authUrl, "authorization URL should point at the registered IdP").toContain(issuerUrl);

  const stateCookies: Record<string, string> = {};
  for (const c of start.cookies) stateCookies[c.name] = c.value;

  const idpRes = await fetch(authUrl, { redirect: "manual" });
  expect(idpRes.status).toBe(302);
  const location = new URL(idpRes.headers.get("location")!);
  return harness.app.inject({
    method: "GET",
    url: location.pathname + location.search,
    cookies: stateCookies,
  });
}

/** GET /api/v1/me with the given cookies. */
async function me(cookies: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
}

describe("runtime BYO-OIDC (POST /api/v1/auth/sso-providers + sso sign-in)", () => {
  it("lets an Administrator register a provider and returns the shared callback URL", async () => {
    const res = await registerProvider(adminCookies);
    expect(res.statusCode, res.body).toBe(201);

    const body = res.json();
    expect(body.provider).toMatchObject({
      providerId: PROVIDER.providerId,
      issuer: issuerUrl,
      domain: PROVIDER.domain,
    });
    // The stable, provider-independent URL an Administrator pastes into
    // the IdP console.
    expect(body.callbackUrl).toBe("http://localhost/api/auth/sso/callback");
    // The client secret never travels back out.
    expect(res.body).not.toContain(PROVIDER.clientSecret);

    // Discovery from the issuer populated the endpoints, and the admin's
    // registration marked the provider trusted for email linking.
    const [row] = await harness.db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.providerId, PROVIDER.providerId));
    expect(row).toBeDefined();
    expect(row!.domainVerified).toBe(true);
    const oidc = JSON.parse(row!.oidcConfig!) as Record<string, unknown>;
    expect(oidc.tokenEndpoint).toContain(issuerUrl);
    expect(oidc.authorizationEndpoint).toContain(issuerUrl);

    // And the row Postgres holds carries no readable client secret
    // (TECH-022). Read past the ORM on purpose: asking Drizzle would
    // only return what it had already opened. The plugin writes this
    // column through our own tables, which is what puts its config
    // inside the seal along with everything else.
    const stored = await harness.db.execute<{ value: string | null }>(
      sql`SELECT oidc_config AS value FROM sso_providers LIMIT 1`,
    );
    expect(stored.rows[0]?.value?.startsWith(SECRET_ENVELOPE_PREFIX)).toBe(true);
    expect(stored.rows[0]?.value).not.toContain(PROVIDER.clientSecret);

    // The login screen's public discovery now carries the provider slug,
    // so the SSO button knows which provider to start.
    const methods = await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" });
    expect(methods.statusCode, methods.body).toBe(200);
    expect(methods.json().ssoProviderId).toBe(PROVIDER.providerId);
  });

  it("rejects a duplicate provider slug through the same relayed error shape", async () => {
    const res = await registerProvider(adminCookies);
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("refuses registration when discovery cannot reach the issuer", async () => {
    const res = await registerProvider(adminCookies, {
      providerId: "dead-idp",
      // Nothing listens here; discovery must fail before anything persists.
      issuer: "http://127.0.0.1:9",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const rows = await harness.db
      .select({ id: ssoProviders.id })
      .from(ssoProviders)
      .where(eq(ssoProviders.providerId, "dead-idp"));
    expect(rows).toHaveLength(0);
  });

  it("JIT-provisions an unknown allowlisted identity as a Business User (email matching)", async () => {
    const email = "newbie@acme.example";
    const redeemed = await ssoRoundTrip(
      { sub: "idp-newbie", email, name: "New Bee" },
      { email, requestSignUp: true },
    );
    expect(redeemed.statusCode, redeemed.body).toBe(302);
    expect(redeemed.headers.location).not.toContain("error");
    const cookies = sessionCookies(redeemed);
    expect(cookies, "callback set no session cookie").not.toBeNull();

    const who = await me(cookies!);
    expect(who.statusCode, who.body).toBe(200);
    expect(who.json().user).toMatchObject({
      email,
      role: "business_user",
      displayName: "New Bee",
    });
  });

  it("rejects an unknown identity on a non-allowlisted domain (providerId entry path)", async () => {
    const email = "mallory@evil.example";
    const redeemed = await ssoRoundTrip(
      { sub: "idp-mallory", email },
      { providerId: PROVIDER.providerId, requestSignUp: true },
    );
    expect(sessionCookies(redeemed), "rejected identity must not sign in").toBeNull();
    expect(redeemed.headers.location ?? "").toContain("error");

    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it("does not create a user when sign-up is not explicitly requested", async () => {
    const email = "implicit@acme.example";
    const redeemed = await ssoRoundTrip({ sub: "idp-implicit", email }, { email });
    expect(sessionCookies(redeemed), "implicit sign-up must not sign in").toBeNull();

    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it("signs an activated staff member in through the IdP, linking and keeping their role", async () => {
    const staffer = { email: "counsel@acme.example", displayName: "Casey Counsel" };
    const invited = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies: adminCookies,
      payload: { ...staffer, role: "legal_team_member" },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const setToken = /\/auth\/set-password\?token=([A-Za-z0-9._~-]+)/.exec(
      harness.mailer.messagesTo(staffer.email)[0]!.text,
    )![1]!;
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "casey-sets-her-own", token: setToken },
    });
    expect(reset.statusCode, reset.body).toBe(200);

    const redeemed = await ssoRoundTrip(
      { sub: "idp-counsel", email: staffer.email, name: "Casey at the IdP" },
      { email: staffer.email },
    );
    expect(redeemed.statusCode, redeemed.body).toBe(302);
    const cookies = sessionCookies(redeemed);
    expect(cookies, "staff SSO sign-in should create a session").not.toBeNull();

    // The pre-existing row authorizes: same user, invited role kept.
    const who = await me(cookies!);
    expect(who.statusCode, who.body).toBe(200);
    expect(who.json().user).toMatchObject({ email: staffer.email, role: "legal_team_member" });

    // Linked, not duplicated: one user row, plus an IdP-subject account.
    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, staffer.email));
    expect(rows).toHaveLength(1);
    const linked = await harness.db
      .select({ accountId: accounts.accountId })
      .from(accounts)
      .where(and(eq(accounts.userId, rows[0]!.id), eq(accounts.providerId, PROVIDER.providerId)));
    expect(linked).toHaveLength(1);
    expect(linked[0]!.accountId).toBe("idp-counsel");
  });

  it("signs an invited-but-never-activated staffer in through the IdP", async () => {
    const staffer = { email: "paralegal@acme.example", displayName: "Pat Paralegal" };
    const invited = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies: adminCookies,
      payload: { ...staffer, role: "contributor" },
    });
    expect(invited.statusCode, invited.body).toBe(201);

    // No activation: in SSO-mode installs staff never set a password.
    const redeemed = await ssoRoundTrip(
      { sub: "idp-paralegal", email: staffer.email },
      { email: staffer.email },
    );
    const cookies = sessionCookies(redeemed);
    expect(cookies, "unactivated staffer should still SSO in").not.toBeNull();
    const who = await me(cookies!);
    expect(who.statusCode, who.body).toBe(200);
    expect(who.json().user).toMatchObject({ email: staffer.email, role: "contributor" });
  });

  it("rejects registration by staff below Administrator with a 403 problem", async () => {
    const staffCookies = await signInCookies(
      harness.app,
      "counsel@acme.example",
      "casey-sets-her-own",
    );
    const res = await registerProvider(staffCookies, { providerId: "rogue-idp" });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("closes better-auth's raw /sso/register the same way", async () => {
    const staffCookies = await signInCookies(
      harness.app,
      "counsel@acme.example",
      "casey-sets-her-own",
    );
    const raw = await harness.app.inject({
      method: "POST",
      url: "/api/auth/sso/register",
      cookies: staffCookies,
      payload: {
        providerId: "rogue-idp",
        issuer: issuerUrl,
        domain: "evil.example",
        oidcConfig: { clientId: "rogue", clientSecret: "rogue" },
      },
    });
    expect(raw.statusCode).toBe(403);
    const rows = await harness.db
      .select({ id: ssoProviders.id })
      .from(ssoProviders)
      .where(eq(ssoProviders.providerId, "rogue-idp"));
    expect(rows).toHaveLength(0);

    // Reads are closed too — the provider config carries the client secret.
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/auth/sso/providers",
      cookies: staffCookies,
    });
    expect(list.statusCode).toBe(403);
    expect(list.body).not.toContain(PROVIDER.clientSecret);
  });

  it("refuses an archived user a session even when the IdP still asserts them", async () => {
    // The Business User JIT-provisioned earlier, now archived by the org.
    const email = "newbie@acme.example";
    const [archived] = await harness.db
      .update(users)
      .set({ archivedAt: new Date() })
      .where(eq(users.email, email))
      .returning({ id: users.id });
    expect(archived, "the JIT test should have created this user").toBeDefined();

    try {
      const redeemed = await ssoRoundTrip({ sub: "idp-newbie", email }, { email });
      expect(sessionCookies(redeemed), "archived user must not get a session").toBeNull();
      expect(redeemed.headers.location ?? "").toContain("error");
    } finally {
      await harness.db.update(users).set({ archivedAt: null }).where(eq(users.email, email));
    }
  });
});

describe("the provider management surface (#64)", () => {
  async function listProviders(cookies?: Record<string, string>) {
    return harness.app.inject({ method: "GET", url: "/api/v1/auth/sso-providers", cookies });
  }

  async function patchProvider(
    providerId: string,
    payload: Record<string, unknown>,
    cookies: Record<string, string> = adminCookies,
  ) {
    return harness.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/sso-providers/${providerId}`,
      cookies,
      payload,
    });
  }

  it("lists the registered provider for an Administrator, without the secret", async () => {
    const res = await listProviders(adminCookies);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().providers).toEqual([
      {
        id: expect.any(String),
        providerId: PROVIDER.providerId,
        issuer: issuerUrl,
        domain: PROVIDER.domain,
        clientId: PROVIDER.clientId,
      },
    ]);
    expect(res.body).not.toContain(PROVIDER.clientSecret);
  });

  it("is an Administrator-only surface", async () => {
    expect((await listProviders()).statusCode).toBe(401);
    const staffCookies = await signInCookies(
      harness.app,
      "counsel@acme.example",
      "casey-sets-her-own",
    );
    expect((await listProviders(staffCookies)).statusCode).toBe(403);
    const write = await patchProvider(PROVIDER.providerId, { clientId: "rogue" }, staffCookies);
    expect(write.statusCode).toBe(403);
  });

  it("updates the provider in place, re-running discovery, and sign-in still works", async () => {
    const res = await patchProvider(PROVIDER.providerId, { clientId: "openlaw-rotated" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().provider).toMatchObject({
      providerId: PROVIDER.providerId,
      issuer: issuerUrl,
      domain: PROVIDER.domain,
    });
    expect(res.json().callbackUrl).toBe("http://localhost/api/auth/sso/callback");

    const listed = await listProviders(adminCookies);
    expect(listed.json().providers[0]).toMatchObject({ clientId: "openlaw-rotated" });

    // Discovery re-ran and the admin's registration stayed trusted.
    const [row] = await harness.db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.providerId, PROVIDER.providerId));
    expect(row!.domainVerified).toBe(true);
    const oidc = JSON.parse(row!.oidcConfig!) as Record<string, unknown>;
    expect(oidc.tokenEndpoint).toContain(issuerUrl);

    // The already-linked staffer still signs in through the IdP.
    const email = "counsel@acme.example";
    const redeemed = await ssoRoundTrip({ sub: "idp-counsel", email }, { email });
    expect(sessionCookies(redeemed), "sign-in must survive a provider update").not.toBeNull();
  });

  it("answers 404 for a provider slug that does not exist", async () => {
    const res = await patchProvider("never-registered", { clientId: "whatever" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("restores the provider untouched when the new issuer cannot be discovered", async () => {
    const before = await listProviders(adminCookies);
    const res = await patchProvider(PROVIDER.providerId, { issuer: "http://127.0.0.1:9" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");

    const after = await listProviders(adminCookies);
    expect(after.json()).toEqual(before.json());
    const [row] = await harness.db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.providerId, PROVIDER.providerId));
    expect(row!.issuer).toBe(issuerUrl);
    expect(row!.domainVerified).toBe(true);
  });
});

describe("the DD-017 audit trail (#64)", () => {
  const providerRows = (action: string) =>
    harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, action))
      .orderBy(asc(activityLog.createdAt));

  it("logged the registration without carrying credentials", async () => {
    const rows = await providerRows("sso_provider.registered");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "system",
      entityId: null,
      visibility: "admin_only",
      payload: {
        providerId: PROVIDER.providerId,
        issuer: issuerUrl,
        domain: PROVIDER.domain,
      },
    });
    expect(rows[0]!.actorId).not.toBeNull();
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(PROVIDER.clientSecret);
  });

  it("logs an update per changed field, masking the rotated secret", async () => {
    // Arrange the pre-state inside the test: the expected `old` must
    // not depend on which test ran before this one.
    const previousClientId = "openlaw-pre-audit";
    const seed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/sso-providers/${PROVIDER.providerId}`,
      cookies: adminCookies,
      payload: { clientId: previousClientId },
    });
    expect(seed.statusCode, seed.body).toBe(200);

    const before = (await providerRows("sso_provider.updated")).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/sso-providers/${PROVIDER.providerId}`,
      cookies: adminCookies,
      payload: { clientId: PROVIDER.clientId, clientSecret: "rotated-client-secret" },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = (await providerRows("sso_provider.updated")).slice(before);
    expect(rows.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        {
          providerId: PROVIDER.providerId,
          field: "clientId",
          old: previousClientId,
          new: PROVIDER.clientId,
        },
        {
          providerId: PROVIDER.providerId,
          field: "clientSecret",
          old: "[secret]",
          new: "[secret]",
        },
      ]),
    );
    expect(JSON.stringify(rows.map((row) => row.payload))).not.toContain("rotated-client-secret");
  });
});
