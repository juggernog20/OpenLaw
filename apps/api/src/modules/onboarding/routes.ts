// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run onboarding state (SET-004). The "Welcome to OpenLaw" wizard
 * is a web flow over the settings routes it walks an Administrator
 * through. These two routes carry the two things no one of those routes
 * can answer: whether the wizard has been finished, and how far each of
 * its steps has got.
 *
 * **Step done-ness is derived, never stored.** Every entry below reads
 * the rows the step configures, so a step counts as done whether it was
 * completed in the wizard, completed later in its own Settings pane, or
 * pinned by the deployment environment. That is what lets the M33/5
 * setup checklist card drop a row without the wizard ever being run,
 * and it is why no step but Review gets a column of its own.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  aiConnector,
  AUTH_MODES,
  count,
  isNull,
  orgSettings,
  signingConnectors,
  users,
  type Db,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import type { MailerResolver } from "../../lib/mailer.js";
import { getOrgSettings } from "../../lib/org-settings.js";
import { problemResponse } from "../../lib/problem.js";

/**
 * The wizard's configuring steps, in the order the wizard walks them.
 *
 * The welcome splash is absent because it configures nothing. The
 * Review step is absent because its done-ness reads a column that
 * arrives with the step that writes it (#700, TECH-014).
 */
export const ONBOARDING_STEPS = [
  "organization",
  "authentication",
  "portal",
  "email",
  "invites",
  "e-signature",
  "ai-analysis",
] as const;

type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * The Settings pane that owns each step after the first run, so a
 * skipped step can name where it is finished (SET-001: one pane, one
 * address).
 *
 * Portal shares the Authentication pane's address. The DD-010 allowlist
 * and the magic-link toggle are two of that pane's controls, not a pane
 * of their own.
 *
 * **Email has no address**, and that is the honest answer rather than a
 * gap in this table. An SMTP relay is set by the deployment environment
 * or in the wizard's own email step (TECH-011, SET-004's #37 addendum).
 * No Settings pane edits one, and pointing at a neighbouring pane would
 * send an Administrator somewhere that cannot finish the job.
 */
const SETTINGS_PATHS: Record<OnboardingStep, string | null> = {
  organization: "/settings/general",
  authentication: "/settings/authentication",
  portal: "/settings/authentication",
  email: null,
  invites: "/settings/users",
  "e-signature": "/settings/integrations/e-signature",
  "ai-analysis": "/settings/ai-analysis",
};

const StepSchema = z.object({
  /** Whether the thing this step configures is configured, right now. */
  done: z.boolean(),
  /** The Settings pane that owns it, or null where none does. */
  settingsPath: z.string().nullable(),
});

const StatusSchema = z.object({
  /**
   * Whether the wizard has been finished or skipped out of. The
   * `/welcome` guard and the home redirect both branch on this before
   * they fetch anything else, so it stays on the envelope.
   */
  completed: z.boolean(),
  steps: z.object({
    organization: StepSchema,
    authentication: StepSchema,
    portal: StepSchema,
    email: StepSchema,
    invites: StepSchema,
    "e-signature": StepSchema,
    "ai-analysis": StepSchema,
  }),
});

/** The status envelope, for the suite that reads it over HTTP. */
export type OnboardingStatus = z.infer<typeof StatusSchema>;

/** Reads every step's state from the rows that step configures. */
async function readStatus(app: {
  db: Db;
  resolveMailer: MailerResolver;
}): Promise<OnboardingStatus> {
  const [settings, resolved, [userRows], [signing], [ai]] = await Promise.all([
    getOrgSettings(app.db),
    app.resolveMailer(),
    app.db.select({ value: count() }).from(users),
    app.db.select({ id: signingConnectors.id }).from(signingConnectors).limit(1),
    app.db.select({ id: aiConnector.id }).from(aiConnector).limit(1),
  ]);

  // Written out step by step rather than assembled from a list, so the
  // compiler checks that every step the schema names is answered.
  const state = (step: OnboardingStep, done: boolean) => ({
    done,
    settingsPath: SETTINGS_PATHS[step],
  });

  return {
    completed: settings.onboardingCompletedAt !== null,
    steps: {
      organization: state("organization", settings.name.trim() !== ""),
      // `auth_mode` is NOT NULL and defaults to built_in, so this is
      // always true. That is the honest answer: built-in sign-in works
      // on a fresh install and nothing about it is outstanding, so the
      // step never reaches the checklist card.
      authentication: state("authentication", AUTH_MODES.includes(settings.authMode)),
      // An empty allowlist admits nobody, so an untouched portal is not
      // a configured one.
      portal: state("portal", settings.allowedEmailDomains.length > 0),
      // The resolved mailer, so an environment-pinned relay counts
      // exactly as an app-saved one does (TECH-011: the environment
      // wins, and either way the instance can send).
      email: state("email", resolved.mailer.configured),
      // No user is seeded and setup creates the first Administrator, so
      // a second row is somebody who was invited, signed in or not.
      invites: state("invites", (userRows?.value ?? 0) > 1),
      "e-signature": state("e-signature", signing !== undefined),
      "ai-analysis": state("ai-analysis", ai !== undefined),
    },
  };
}

export const onboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/onboarding",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getOnboardingStatus",
        summary:
          "First-run onboarding state (SET-004): whether the wizard is " +
          "finished, and for each of its steps whether the thing it " +
          "configures is configured and which Settings pane owns it",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    () => readStatus(app),
  );

  app.post(
    "/onboarding/complete",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "completeOnboarding",
        summary:
          "Mark first-run onboarding finished (SET-004); idempotent, and " +
          "never reversed — the wizard is first-run only",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    async () => {
      // getOrgSettings throws if the seeded singleton is missing, so a
      // broken instance can never be reported as onboarded.
      const settings = await getOrgSettings(app.db);
      if (settings.onboardingCompletedAt === null) {
        // Only a NULL timestamp is written, so the recorded completion
        // time is always the first one — repeat calls change nothing.
        await app.db
          .update(orgSettings)
          .set({ onboardingCompletedAt: new Date() })
          .where(isNull(orgSettings.onboardingCompletedAt));
      }
      return readStatus(app);
    },
  );
};
