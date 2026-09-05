// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Onboarding state (SET-004) and the portal toggle (DD-010): both are
 * Administrator-only, completion is one-way and idempotent, every
 * wizard step's done-ness is read off the rows that step configures,
 * and the toggle's effect is observable on the public methods endpoint
 * and the magic-link request path.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiConnector, orgSettings, signingConnectors } from "@openlaw/db";
import { ONBOARDING_STEPS, type OnboardingStatus } from "./routes.js";
import {
  settingsAuditRows,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  TEST_SMTP_ENV,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;
let staffCookies: Record<string, string>;

const STAFF = {
  email: "nadia@example.com",
  displayName: "Nadia Osei",
  password: "nadia-sets-her-own",
} as const;

/** Connector rows shaped like the ones an Administrator saves. They are
 * fixtures for a throwaway container and reach nothing real. */
const SIGNING_CONNECTOR = {
  provider: "docusign",
  environment: "demo",
  integrationKey: "22222222-3333-4444-5555-666666666666",
  apiUserId: "99999999-8888-7777-6666-555555555555",
  privateKey: [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEAopenlawonboardingfixturekeyusednowhereelseatall",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n"), // NOSONAR — inert fixture, not a credential
  webhookSecret: "connect-hmac-fixture-secret", // NOSONAR — inert fixture
} as const;

const AI_CONNECTOR = {
  preset: "anthropic",
  protocol: "anthropic_messages",
  baseUrl: "https://api.anthropic.com",
  model: "claude-sonnet-4-5",
} as const;

/** A relay URL with an inline credential, for the TECH-011 precedence
 * check: the app holds this one only while the environment holds none. */
const RELAY = {
  smtpUrl: "smtp://mailer:sekret-cred@relay.acme.example:587",
  smtpFrom: "Acme Legal <legal@acme.example>",
} as const;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  // The admin-only checks need an authenticated non-Administrator.
  const invited = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: adminCookies,
    payload: { email: STAFF.email, displayName: STAFF.displayName, role: "legal_team_member" },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const token = tokenFrom(harness.mailer.messagesTo(STAFF.email)[0]!.text);
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: STAFF.password, token },
  });
  expect(reset.statusCode, reset.body).toBe(200);
  staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
});

afterAll(async () => {
  await harness.stop();
});

type StepName = (typeof ONBOARDING_STEPS)[number];
type StepState = OnboardingStatus["steps"][StepName];

/** The status envelope as the wizard and the checklist card read it.
 * `inject().json()` is untyped, so the route's own schema names it. */
async function status(cookies: Record<string, string>): Promise<OnboardingStatus> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/onboarding",
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as OnboardingStatus;
}

/** One field of every step, keyed by step. Both derivation assertions
 * below compare against this shape, so a missing step fails loudly. */
function byStep<T>(
  steps: OnboardingStatus["steps"],
  read: (state: StepState) => T,
): Record<StepName, T> {
  return Object.fromEntries(ONBOARDING_STEPS.map((step) => [step, read(steps[step])])) as Record<
    StepName,
    T
  >;
}

describe("onboarding state (GET /api/v1/onboarding, POST /api/v1/onboarding/complete)", () => {
  it("is an Administrator-only surface", async () => {
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/onboarding" })).statusCode,
    ).toBe(401);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/onboarding",
          cookies: staffCookies,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: "/api/v1/onboarding/complete",
          cookies: staffCookies,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("names the Settings pane that owns each step", async () => {
    const { steps } = await status(adminCookies);
    expect(byStep(steps, (state) => state.settingsPath)).toEqual({
      organization: "/settings/general",
      authentication: "/settings/authentication",
      // The allowlist and the magic-link toggle are two of the
      // Authentication pane's controls, not a pane of their own.
      portal: "/settings/authentication",
      // No Settings pane edits an SMTP relay: the environment or the
      // wizard's own step sets it (TECH-011).
      email: null,
      invites: "/settings/users",
      "e-signature": "/settings/integrations/e-signature",
      "ai-analysis": "/settings/ai-analysis",
    });
  });

  it("reads each step's done-ness off the rows that step configures", async () => {
    // The instance so far: an Administrator plus the one invited
    // colleague this suite created, an env-pinned relay, and nothing
    // else touched.
    const fresh = await status(adminCookies);
    expect(fresh.completed).toBe(false);
    expect(byStep(fresh.steps, (state) => state.done)).toEqual({
      // org_settings.name is empty until an Administrator names it.
      organization: false,
      // auth_mode defaults to built_in and is never empty, so nothing
      // about built-in sign-in is ever outstanding.
      authentication: true,
      // An empty allowlist admits nobody.
      portal: false,
      email: true,
      // The invited colleague is the second users row.
      invites: true,
      "e-signature": false,
      "ai-analysis": false,
    });

    // Naming the organization is what the organization step is for, and
    // the pane and the wizard write the same row through the same route.
    const auditedBefore = (await settingsAuditRows(harness.db)).length;
    const named = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies: adminCookies,
      payload: { name: "Acme Legal" },
    });
    expect(named.statusCode, named.body).toBe(200);
    expect(named.json().general.name).toBe("Acme Legal");
    // One route, one narration (DD-017): the wizard's save is logged
    // because the pane's route logs it.
    expect((await settingsAuditRows(harness.db)).slice(auditedBefore)).toMatchObject([
      { entityType: "system", visibility: "admin_only", payload: { field: "name" } },
    ]);

    const opened = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/auth/allowed-domains",
      cookies: adminCookies,
      payload: { domains: ["acme.example"] },
    });
    expect(opened.statusCode, opened.body).toBe(200);

    const after = await status(adminCookies);
    expect(after.steps.organization.done).toBe(true);
    expect(after.steps.portal.done).toBe(true);
  });

  it("reads the connector steps from the connector rows", async () => {
    await harness.db.insert(signingConnectors).values(SIGNING_CONNECTOR);
    await harness.db.insert(aiConnector).values(AI_CONNECTOR);
    try {
      const { steps } = await status(adminCookies);
      expect(steps["e-signature"].done).toBe(true);
      expect(steps["ai-analysis"].done).toBe(true);
    } finally {
      await harness.db.delete(signingConnectors);
      await harness.db.delete(aiConnector);
    }
  });

  it("reports the e-signature step done once the wizard's own save lands", async () => {
    // The wizard's E-signature step (#698) writes through the pane's
    // route and adds none of its own, so the step's done-ness has to
    // follow that route's write. The narration the write leaves is the
    // signing-connector suite's own assertion.
    expect((await status(adminCookies)).steps["e-signature"].done).toBe(false);
    // The write is inside the try, so a refusal after the row lands
    // still clears it. The suite's later steps read a fresh install.
    try {
      const saved = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/signing-connectors/docusign",
        cookies: adminCookies,
        payload: {
          environment: SIGNING_CONNECTOR.environment,
          integrationKey: SIGNING_CONNECTOR.integrationKey,
          apiUserId: SIGNING_CONNECTOR.apiUserId,
          privateKey: SIGNING_CONNECTOR.privateKey,
          webhookSecret: SIGNING_CONNECTOR.webhookSecret,
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await status(adminCookies)).steps["e-signature"].done).toBe(true);
    } finally {
      await harness.db.delete(signingConnectors);
    }
  });

  it("reports the email step done for an env-pinned relay and for an app-saved one", async () => {
    // Env-pinned: the harness starts this way (TECH-011 precedence).
    expect((await status(adminCookies)).steps.email.done).toBe(true);

    harness.smtpEnv = null;
    try {
      // No environment relay and nothing saved: the one honest false.
      expect((await status(adminCookies)).steps.email.done).toBe(false);

      const saved = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/email-settings",
        cookies: adminCookies,
        payload: RELAY,
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await status(adminCookies)).steps.email.done).toBe(true);

      const cleared = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/email-settings",
        cookies: adminCookies,
        payload: { smtpUrl: null, smtpFrom: null },
      });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect((await status(adminCookies)).steps.email.done).toBe(false);
    } finally {
      harness.smtpEnv = TEST_SMTP_ENV;
    }
  });

  it("reflects an unconfigured mailer", async () => {
    harness.mailer.configured = false;
    try {
      expect((await status(adminCookies)).steps.email.done).toBe(false);
    } finally {
      harness.mailer.configured = true;
    }
  });

  it("completes once, idempotently, and never reopens", async () => {
    const first = await harness.app.inject({
      method: "POST",
      url: "/api/v1/onboarding/complete",
      cookies: adminCookies,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().completed).toBe(true);
    // Completion answers the same derived steps the status route does.
    expect(first.json().steps).toEqual((await status(adminCookies)).steps);

    const [afterFirst] = await harness.db
      .select({ at: orgSettings.onboardingCompletedAt })
      .from(orgSettings);
    expect(afterFirst?.at).toBeInstanceOf(Date);

    // A repeat call succeeds but must not move the recorded timestamp.
    const second = await harness.app.inject({
      method: "POST",
      url: "/api/v1/onboarding/complete",
      cookies: adminCookies,
    });
    expect(second.statusCode, second.body).toBe(200);
    const [afterSecond] = await harness.db
      .select({ at: orgSettings.onboardingCompletedAt })
      .from(orgSettings);
    expect(afterSecond?.at?.getTime()).toBe(afterFirst?.at?.getTime());

    expect((await status(adminCookies)).completed).toBe(true);
  });
});

describe("portal toggle (PATCH /api/v1/auth/portal)", () => {
  it("is an Administrator-only surface", async () => {
    const anonymous = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      payload: { magicLinkEnabled: false },
    });
    expect(anonymous.statusCode).toBe(401);
    const staff = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: staffCookies,
      payload: { magicLinkEnabled: false },
    });
    expect(staff.statusCode).toBe(403);
  });

  it("closes and reopens magic-link sign-in, visibly and effectively", async () => {
    const closed = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: adminCookies,
      payload: { magicLinkEnabled: false },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toEqual({ magicLinkEnabled: false });

    // The login screen's discovery endpoint reflects it…
    const methods = await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" });
    expect(methods.json()).toMatchObject({ magicLinkEnabled: false });

    // …and the request path refuses loudly (global config leaks nothing).
    const refused = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "anyone@example.com" },
    });
    expect(refused.statusCode).toBe(403);

    const reopened = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: adminCookies,
      payload: { magicLinkEnabled: true },
    });
    expect(reopened.json()).toEqual({ magicLinkEnabled: true });
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/auth/methods" })).json(),
    ).toMatchObject({ magicLinkEnabled: true });
  });

  it("logs each toggle as an admin_only org_settings entry, skipping no-ops (#64)", async () => {
    const settingsRows = () => settingsAuditRows(harness.db);

    const before = (await settingsRows()).length;
    const closed = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/portal",
      cookies: adminCookies,
      payload: { magicLinkEnabled: false },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    try {
      const rows = (await settingsRows()).slice(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: "system",
        entityId: null,
        visibility: "admin_only",
        payload: { field: "magicLinkEnabled", old: true, new: false },
      });
      expect(rows[0]!.actorId).not.toBeNull();

      // Repeating the closed state changes nothing, so nothing is logged.
      const repeat = await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/auth/portal",
        cookies: adminCookies,
        payload: { magicLinkEnabled: false },
      });
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect(await settingsRows()).toHaveLength(before + 1);
    } finally {
      const reopened = await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/auth/portal",
        cookies: adminCookies,
        payload: { magicLinkEnabled: true },
      });
      expect(reopened.statusCode, reopened.body).toBe(200);
    }
  });
});
