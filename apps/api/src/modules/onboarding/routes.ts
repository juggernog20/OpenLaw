// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run onboarding state (SET-004). The "Welcome to OpenLaw" wizard
 * itself is a web flow built on the auth management routes; these two
 * routes carry only what it cannot learn elsewhere — whether onboarding
 * has been completed (org_settings) and whether outbound email is wired
 * (deployment env, TECH-011).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { isNull, orgSettings } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { getOrgSettings } from "../../lib/org-settings.js";
import { problemResponse } from "../../lib/problem.js";

const StatusSchema = z.object({
  completed: z.boolean(),
  /** Whether SMTP is wired (TECH-011); the wizard's email step shows it. */
  emailConfigured: z.boolean(),
});

export const onboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/onboarding",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getOnboardingStatus",
        summary: "First-run onboarding state (SET-004), plus whether email is configured",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    async () => {
      const settings = await getOrgSettings(app.db);
      return {
        completed: settings.onboardingCompletedAt !== null,
        emailConfigured: app.mailer.configured,
      };
    },
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
      return { completed: true, emailConfigured: app.mailer.configured };
    },
  );
};
