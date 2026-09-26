// SPDX-License-Identifier: AGPL-3.0-only

import { saveFieldRow } from "../../testing/form-fixtures.js";

/**
 * Onboarding state (SET-004) and the portal toggle (DD-010): both are
 * Administrator-only, completion is one-way and idempotent, every
 * wizard step's done-ness is read off the rows that step configures,
 * and the toggle's effect is observable on the public methods endpoint
 * and the magic-link request path.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  aiConnector,
  asc,
  contractTypeFields,
  eq,
  fields,
  knowledgeItems,
  matterTemplates,
  matterTypes,
  orgSettings,
  signingConnectors,
  users,
} from "@openlaw/db";
import { ONBOARDING_STEPS, StatusSchema, type OnboardingStatus } from "./routes.js";
import { NO_PERMISSION } from "../../auth/guards.js";
import { PROBLEM_CONTENT_TYPE, UNNAMED_PROBLEM_TYPE } from "../../lib/problem.js";
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
  return StatusSchema.parse(res.json());
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
      email: "/settings/email",
      invites: "/settings/users",
      "e-signature": "/settings/integrations/e-signature",
      "ai-analysis": "/settings/ai-analysis",
      review: null,
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
      review: false,
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

  it("reports the AI analysis step done once the wizard's own save lands", async () => {
    // The wizard's AI analysis step (#699) writes through the pane's
    // route and adds none of its own, so the step's done-ness has to
    // follow that route's write. The narration the write leaves is the
    // ai-connector suite's own assertion.
    expect((await status(adminCookies)).steps["ai-analysis"].done).toBe(false);
    // The write is inside the try, so a refusal after the row lands
    // still clears it. The suite's later steps read a fresh install.
    try {
      const saved = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/ai-connector",
        cookies: adminCookies,
        payload: {
          preset: AI_CONNECTOR.preset,
          model: AI_CONNECTOR.model,
          apiKey: "onboarding-fixture-key-used-nowhere", // NOSONAR — inert fixture
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await status(adminCookies)).steps["ai-analysis"].done).toBe(true);
    } finally {
      await harness.db.delete(aiConnector);
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
      const blocked = await harness.app.inject({
        method: "POST",
        url: "/api/v1/onboarding/complete",
        cookies: adminCookies,
      });
      expect(blocked.statusCode, blocked.body).toBe(409);
      expect(blocked.json().type).toBe("/problems/email-setup-required");
      expect((await status(adminCookies)).completed).toBe(false);
      const me = await harness.app.inject({
        method: "GET",
        url: "/api/v1/me",
        cookies: adminCookies,
      });
      expect(me.json().user.emailSetupRequired).toBe(true);
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
    expect(first.json().steps.review.done).toBe(false);
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
    harness.mailer.configured = false;
    try {
      const repeated = await harness.app.inject({
        method: "POST",
        url: "/api/v1/onboarding/complete",
        cookies: adminCookies,
      });
      expect(repeated.statusCode, repeated.body).toBe(200);
      const me = await harness.app.inject({
        method: "GET",
        url: "/api/v1/me",
        cookies: adminCookies,
      });
      expect(me.json().user.emailSetupRequired).toBe(false);
    } finally {
      harness.mailer.configured = true;
    }
  });

  it("refuses anonymous and non-Administrator review marks without changing state", async () => {
    const before = await harness.db.select().from(orgSettings);
    for (const [cookies, code] of [
      [undefined, 401],
      [staffCookies, 403],
    ] as const) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/onboarding/reviewed",
        cookies,
      });
      expect(response.statusCode, response.body).toBe(code);
      expect(response.headers["content-type"]).toBe(PROBLEM_CONTENT_TYPE);
      const detail = code === 401 ? "Authentication required." : NO_PERMISSION;
      expect(response.json()).toMatchObject({
        type: UNNAMED_PROBLEM_TYPE,
        status: code,
        title: detail,
        detail,
        instance: "/api/v1/onboarding/reviewed",
      });
    }
    expect(await harness.db.select().from(orgSettings)).toEqual(before);
  });

  it("marks Review once, including concurrent retries, without editing settings or completing", async () => {
    // This fixture reopens the wizard so review and completion can be tested separately.
    await harness.db.update(orgSettings).set({ onboardingCompletedAt: null });
    const [before] = await harness.db.select().from(orgSettings);
    const auditBefore = await settingsAuditRows(harness.db);
    expect((await status(adminCookies)).steps.review.done).toBe(false);
    const mark = () =>
      harness.app.inject({
        method: "POST",
        url: "/api/v1/onboarding/reviewed",
        cookies: adminCookies,
      });
    // Both first marks start while the column is still NULL, so the
    // route's `WHERE onboarding_reviewed_types_at IS NULL` guard is what
    // decides which write lands; a sequential first call would only
    // prove idempotency, never the first-write race.
    const firsts = await Promise.all([mark(), mark()]);
    for (const first of firsts) {
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({ completed: false, steps: { review: { done: true } } });
    }
    const [after] = await harness.db.select().from(orgSettings);
    expect(after?.onboardingReviewedTypesAt).toBeInstanceOf(Date);
    expect(after).toEqual({
      ...before,
      onboardingReviewedTypesAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    const repeat = await mark();
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(await harness.db.select().from(orgSettings)).toEqual([after]);
    expect(await settingsAuditRows(harness.db)).toEqual(auditBefore);
    expect((await status(adminCookies)).steps.review.done).toBe(true);
    const completed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/onboarding/complete",
      cookies: adminCookies,
    });
    expect(completed.json()).toMatchObject({ completed: true, steps: { review: { done: true } } });
    const markedAfterCompletion = await mark();
    expect(markedAfterCompletion.statusCode, markedAfterCompletion.body).toBe(200);
    expect(markedAfterCompletion.json()).toMatchObject({ completed: true });
    expect(await status(adminCookies)).toMatchObject({
      completed: true,
      steps: { review: { done: true } },
    });
  });
});

/** The eight catalog lists as the API lists them, with the skeleton
 * each keeps (SET-004, Start blank). */
const CATALOG_LISTS = [
  ["/api/v1/matter-types", "matterTypes", ["other", "default"]],
  ["/api/v1/matter-statuses", "matterStatuses", ["open", "closed"]],
  ["/api/v1/contract-types", "contractTypes", ["other", "default"]],
  [
    "/api/v1/contract-statuses",
    "contractStatuses",
    ["draft", "partially_signed", "active", "expired"],
  ],
  ["/api/v1/entity-types", "entityTypes", ["other"]],
  ["/api/v1/officer-roles", "officerRoles", ["other"]],
  ["/api/v1/knowledge/types", "knowledgeTypes", []],
  ["/api/v1/request-types", "requestTypes", []],
] as const;

/** Every slug a list holds, archived rows included, in display order. */
async function listSlugs(path: string, key: string): Promise<string[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `${path}?includeArchived=true`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const rows = (res.json() as Record<string, { slug: string }[]>)[key]!;
  return rows.map((row) => row.slug);
}

async function catalogSlugs(): Promise<Record<string, string[]>> {
  return Object.fromEntries(
    await Promise.all(
      CATALOG_LISTS.map(async ([path, key]) => [key, await listSlugs(path, key)] as const),
    ),
  );
}

const clearedRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "settings.catalog_cleared"))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** `null` is the anonymous call; omitted is the Administrator's. */
const startBlank = (cookies: Record<string, string> | null = adminCookies) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/onboarding/start-blank",
    cookies: cookies ?? undefined,
  });

describe("Start blank (POST /api/v1/onboarding/start-blank)", () => {
  it("is an Administrator-only surface", async () => {
    expect((await startBlank(null)).statusCode).toBe(401);
    expect((await startBlank(staffCookies)).statusCode).toBe(403);
  });

  it("refuses once onboarding is complete, and removes nothing", async () => {
    // The suite above finished the wizard; an existing installation
    // never sees the action (SET-004).
    expect((await status(adminCookies)).completed).toBe(true);
    const before = await catalogSlugs();
    const refused = await startBlank();
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().type).toBe("/problems/onboarding-complete");
    expect(await catalogSlugs()).toEqual(before);
    expect(await clearedRows()).toEqual([]);
  });

  it("refuses a list that already holds a user-created row, and names the list", async () => {
    // Reopened so the remaining cases run against a first run.
    await harness.db.update(orgSettings).set({ onboardingCompletedAt: null });
    const before = await catalogSlugs();
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "Regional" },
    });
    expect(created.statusCode, created.body).toBe(201);
    try {
      const refused = await startBlank();
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        type: "/problems/catalog-has-custom-rows",
        detail:
          "Matter types already holds 1 row you added. Remove them first, or keep the seeded lists.",
        list: "matter_type",
      });
      expect(await catalogSlugs()).toEqual({
        ...before,
        matterTypes: [...before.matterTypes!, "regional"],
      });
      expect(await clearedRows()).toEqual([]);
    } finally {
      const deleted = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/matter-types/${created.json().matterType.id}`,
        cookies: adminCookies,
      });
      expect(deleted.statusCode, deleted.body).toBe(204);
    }
  });

  it("refuses a removable row in use, names the list, and rolls every list back", async () => {
    const before = await catalogSlugs();
    const [admin] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, TEST_ADMIN.email));
    const [employment] = await harness.db
      .select({ id: matterTypes.id })
      .from(matterTypes)
      .where(eq(matterTypes.slug, "employment"));

    // A matter template points at a seed matter type through an FK the
    // type's pane does not count; the delete would fail on it.
    const [template] = await harness.db
      .insert(matterTemplates)
      .values({ matterTypeId: employment!.id, name: "Onboarding template" })
      .returning({ id: matterTemplates.id });
    try {
      const refused = await startBlank();
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        type: "/problems/catalog-in-use",
        detail:
          "Matter types has 1 seeded row in use. Move those records first, or keep the seeded lists.",
        list: "matter_type",
      });
    } finally {
      await harness.db.delete(matterTemplates).where(eq(matterTemplates.id, template!.id));
    }

    // Knowledge types come seventh: six lists are emptied inside the
    // transaction before this refusal, and all six must come back.
    const template_ = await listSlugs("/api/v1/knowledge/types", "knowledgeTypes");
    expect(template_).toContain("template");
    const [item] = await harness.db
      .insert(knowledgeItems)
      .values({
        title: "Board minutes template",
        knowledgeTypeId: (
          await harness.app
            .inject({ method: "GET", url: "/api/v1/knowledge/types", cookies: adminCookies })
            .then((res) => res.json().knowledgeTypes as { id: string; slug: string }[])
        ).find((row) => row.slug === "template")!.id,
        createdBy: admin!.id,
        updatedBy: admin!.id,
      })
      .returning({ id: knowledgeItems.id });
    try {
      const refused = await startBlank();
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        type: "/problems/catalog-in-use",
        detail:
          "Knowledge types has 1 seeded row in use. Move those records first, or keep the seeded lists.",
        list: "knowledge_type",
      });
    } finally {
      await harness.db.delete(knowledgeItems).where(eq(knowledgeItems.id, item!.id));
    }
    expect(await catalogSlugs()).toEqual(before);
    expect(await clearedRows()).toEqual([]);
    expect((await status(adminCookies)).completed).toBe(false);
  });

  it("hard-deletes the catalog, keeps the skeleton, marks Review, and logs one row per list", async () => {
    // A per-type Field attachment on a catalog row goes with the row;
    // the Field itself stays.
    const contractTypesBefore = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
    });
    const nda = (contractTypesBefore.json().contractTypes as { id: string; slug: string }[]).find(
      (row) => row.slug === "nda",
    )!;
    const [governingLaw] = await harness.db
      .select({ id: fields.id })
      .from(fields)
      .where(eq(fields.slug, "governing_law"));
    const attached = await saveFieldRow(harness, {
      typeUrl: `/api/v1/contract-types/${nda.id}`,
      cookies: adminCookies,
      payload: { fieldId: governingLaw!.id },
    });
    expect(attached.statusCode, attached.body).toBe(200);
    expect(await harness.db.select().from(contractTypeFields)).toHaveLength(1);

    const offsetsBefore = (
      await harness.app.inject({
        method: "GET",
        url: "/api/v1/org/reminder-offsets",
        cookies: adminCookies,
      })
    ).json();
    const fieldsBefore = await harness.db.select().from(fields).orderBy(asc(fields.slug));
    // The earlier suite marked Review; clear it so this call's mark is its own.
    await harness.db.update(orgSettings).set({ onboardingReviewedTypesAt: null });
    expect((await status(adminCookies)).steps.review.done).toBe(false);

    const cleared = await startBlank();
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({ completed: false, steps: { review: { done: true } } });

    // The skeleton, and nothing else.
    expect(await catalogSlugs()).toEqual(
      Object.fromEntries(CATALOG_LISTS.map(([, key, keep]) => [key, keep])),
    );
    expect(await harness.db.select().from(contractTypeFields)).toEqual([]);
    // Default Fields, the intake defaults, and every other Field stay.
    expect(await harness.db.select().from(fields).orderBy(asc(fields.slug))).toEqual(fieldsBefore);
    expect(fieldsBefore.filter((row) => row.isSystemDefault).map((row) => row.slug)).toEqual([
      "governing_law",
      "jurisdiction",
      "our_position",
    ]);
    // The reminder offsets are a global setting, not vocabulary.
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/org/reminder-offsets",
          cookies: adminCookies,
        })
      ).json(),
    ).toEqual(offsetsBefore);

    const [after] = await harness.db.select().from(orgSettings);
    expect(after?.onboardingReviewedTypesAt).toBeInstanceOf(Date);
    expect(after?.onboardingCompletedAt).toBeNull();

    // One admin_only row per emptied list, in the order the lists were
    // emptied, each naming the list and the removed count.
    expect(
      (await clearedRows()).map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
        visibility: row.visibility,
        actor: row.actorId !== null,
        payload: row.payload,
      })),
    ).toEqual(
      [
        ["matter_type", 8],
        ["matter_status", 2],
        ["contract_type", 7],
        ["contract_status", 5],
        ["entity_type", 4],
        ["officer_role", 4],
        ["knowledge_type", 4],
        ["request_type", 3],
      ].map(([list, removed]) => ({
        entityType: "system",
        entityId: null,
        visibility: "admin_only",
        actor: true,
        payload: { list, removed },
      })),
    );
  });

  it("answers 200 and logs nothing once the catalog is already empty", async () => {
    const before = await catalogSlugs();
    const logged = (await clearedRows()).length;
    const again = await startBlank();
    expect(again.statusCode, again.body).toBe(200);
    expect(await catalogSlugs()).toEqual(before);
    expect(await clearedRows()).toHaveLength(logged);
    // Finish still works after Start blank.
    const completed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/onboarding/complete",
      cookies: adminCookies,
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json()).toMatchObject({ completed: true, steps: { review: { done: true } } });
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
