// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Decline (INT-006, INT-007, #418): the first of the three dispositions,
 * and the one that says no.
 *
 * **The reason is required, and it is required by name.** INT-006 makes
 * "no" always arrive with a why, so a decline with an empty reason is
 * refused with the field named rather than accepted and left blank. The
 * reason is the whole of the answer the requester gets: it is stored on
 * the Request, carried into the decline email, and rendered verbatim on
 * the portal banner (the INT-003 M20/5 addendum's declined arm, which
 * this route is the first writer for).
 *
 * **`requestDeclined` fires instead of `requestStatusChanged`, never
 * beside it** (the M20/8 rule). A decline is a status change and it is
 * also the news that Legal said no with a reason, and those are one act.
 * Two events would be the same news at two volumes, and the bare status
 * change is the one that says less than the record does.
 *
 * **The narration says who declined, and not why.** DD-017's entry
 * carries the actor and the Request's number; the reason stays on the
 * Request, where a correction can still reach it. The log is append-only
 * (DD-017), so text that enters a payload can never leave it again —
 * CMT-008's rule about comment bodies, applied to a decline reason.
 *
 * The lock, the `new` guard, the race refusal, and the envelope read are
 * all `disposition.ts`'s. This module is what a decline writes and what
 * it tells the requester, which is all a disposition route should have
 * to say.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, requests } from "@openlaw/db";
import { MAX_DECLINE_REASON_LENGTH } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  dispositionedResponse,
  dispositionOf,
  NumberParams,
  REQUIRE_TRIAGER,
} from "./disposition.js";
import { StaffRequestSchema } from "./projection.js";

export const requestDeclineRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/requests/:number/decline",
    {
      preHandler: requireRole(...REQUIRE_TRIAGER),
      schema: {
        operationId: "declineRequest",
        summary:
          "Turn a Request down, with a reason (INT-006). The first of " +
          "INT-007's three dispositions: it transitions the Request from " +
          "`new` to `declined` under the Request's own row lock, so two " +
          "triagers racing one Request produce one decline. The loser is " +
          "answered 409 with the recorded outcome rather than a second " +
          "decline. The reason is required and refused by name without " +
          "one, because a decline is the whole of the answer the " +
          "requester gets: it is stored on the Request, carried into the " +
          "decline email, and rendered on the portal banner as written. " +
          "Raises `requestDeclined` — instead of the status change it " +
          "also is, never beside it — so the requester gets one bell item " +
          "and one immediate email. Appends one request.declined entry " +
          "naming the actor (DD-017, INT-007: who dispositioned is audit " +
          "data); the reason is not in the payload, because the log is " +
          "append-only and the reason lives on the record. Answers the " +
          "Request as the staff detail reads it. Member+ only",
        tags: ["requests"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          /** Why. Trimmed and then required, so a box of spaces is the
           * same refusal an empty one is. */
          reason: z.string().max(MAX_DECLINE_REASON_LENGTH),
        }),
        response: {
          200: z.object({ request: StaffRequestSchema }),
          409: dispositionedResponse(
            "There is no unnamed 409 on this route — an archived Request answers 404 and " +
              "a missing reason answers 400.",
          ),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // Trimmed here rather than in the schema, because the refusal has
      // to name the field and a schema refusal names a path. A reason of
      // spaces is a reason nobody wrote.
      const reason = request.body.reason.trim();
      if (reason === "") {
        throw httpError(400, "Fill Reason first — a decline is refused without one.");
      }
      return dispositionOf(app, request.user, request.params.number, async (tx, held) => {
        await tx
          .update(requests)
          .set({ status: "declined", declinedReason: reason })
          .where(eq(requests.id, held.id));

        // DD-017's narration, in the transaction that wrote the status,
        // so no decline exists without the entry that says who made it.
        // INT-007 calls that the audit datum the dropped `assigned_to`
        // column was never going to carry.
        await recordActivity(tx, {
          entityType: "request",
          entityId: held.id,
          actorId: request.user.id,
          action: "request.declined",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: held.number },
        });

        // The M20/8 rule as one line: the decline's own event, and not
        // the status change it also is. The audience, the actor
        // exclusion, the preferences, and the after-commit wake-up are
        // all the seam's — this route names what happened and carries
        // the reason, because a "no" without its why is the one status
        // move that says less than the record does.
        await app.notifier.requestDeclined(tx, {
          requestId: held.id,
          actorId: request.user.id,
          actorName: request.user.displayName,
          reason,
        });
      });
    },
  );
};
