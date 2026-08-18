// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The morning round, run on demand — a harness seam for the E2E gate
 * (TECH-018), and nothing a deployment carries.
 *
 * The round is a pg-boss cron on the hour (NOT-003, `morning-round.ts`).
 * That is what an install wants and what a browser suite cannot wait
 * for: the deployment-fidelity gate drives the built images over HTTP,
 * so it has no way to reach a scheduled handler and no hour to spend
 * waiting for the next tick. The M18 demo therefore asks the running
 * stack to run a round now.
 *
 * **The round's own rules are untouched, and that is the whole design.**
 * This route takes no parameters at all — no clock, no person, no date.
 * It runs exactly the round the cron runs, on the real clock, with the
 * real notifier, the real mailer resolver, and the real queue. Every one
 * of the round's gates still decides for itself: whose morning it is
 * (`localMoment` against each person's profile zone), which dates are at
 * an offset, whether a briefing has already gone today, and the dedup
 * identity that makes a second round a no-op. A suite makes the round
 * fire by arranging the *world* — a reader in a zone whose morning has
 * arrived, a deadline exactly one offset away — which is the same thing
 * an install does by waiting until tomorrow.
 *
 * **It is registered only when the dev/E2E overlay says so** — the
 * `AUTH_RATE_LIMIT=off` shape (TECH-018's addenda): one variable, read
 * once at the entrypoint, warned about at boot, and set nowhere but
 * `compose.dev.yml`. On every real install the route does not exist, so
 * the 404 is the same one any unknown path answers rather than a refusal
 * that admits there is something here.
 *
 * **And it is Administrator-only even then** (SET-002). A round sends
 * other people's briefings, so the belt is the overlay and the braces
 * are the role.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { runMorningRound, type MorningRoundSummary } from "../../pipeline/morning-round.js";

/**
 * What one round did, as the operator's log records it. Answered so a
 * suite can say the round ran rather than inferring it from silence.
 *
 * `satisfies` holds both ends of it: a counter added to
 * {@link MorningRoundSummary} — or renamed out of it — stops compiling
 * here, so the answer cannot quietly drift from the round's own report.
 */
const RoundSummary = z.object({
  served: z.number().int().nonnegative(),
  reminders: z.number().int().nonnegative(),
  digests: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  reasked: z.number().int().nonnegative(),
  stopped: z.boolean(),
}) satisfies z.ZodType<MorningRoundSummary>;

export const morningRoundTriggerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/notifications/morning-round",
    {
      preHandler: requireRole("administrator"),
      schema: {
        // Kept out of the OpenAPI document: it is not part of the API
        // surface, and no real install answers it (TECH-018).
        hide: true,
        response: { 200: RoundSummary, default: problemResponse },
      },
    },
    async () =>
      await runMorningRound(
        {
          db: app.db,
          log: app.log,
          notifier: app.notifier,
          resolveMailer: app.resolveMailer,
          baseUrl: app.baseUrl,
        },
        app.jobs,
      ),
  );
};
