// SPDX-License-Identifier: AGPL-3.0-only

/** Resolve with a required explanation. The Full Thread comment, status,
 * activity and notifications are written in the same transaction. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, requests } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { problemResponse } from "../../lib/problem.js";
import { reachedThread } from "../comments/audience.js";
import { CommentBodySchema, postComment } from "../comments/post.js";
import {
  dispositionedResponse,
  dispositionOf,
  NumberParams,
  REQUIRE_TRIAGER,
} from "./disposition.js";
import { StaffRequestSchema } from "./projection.js";

export const requestResolveRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/requests/:number/resolve",
    {
      preHandler: requireRole(...REQUIRE_TRIAGER),
      schema: {
        operationId: "resolveRequest",
        summary:
          "Resolve a Request without converting it. Requires a nonblank reply explaining " +
          "the resolution, posted to the requester-visible thread. Records the comment, " +
          "closure and notifications atomically. Member+ only; already decided Requests return 409.",
        tags: ["requests"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          reply: CommentBodySchema,
        }),
        response: {
          200: z.object({ request: StaffRequestSchema }),
          409: dispositionedResponse(
            "There is no unnamed 409 on this route — an archived Request answers 404.",
          ),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const reply = request.body.reply;
      return dispositionOf(app, request.user, request.params.number, async (tx, held) => {
        // The answer first, then the closure — the order they happened
        // in, and the order the thread reads in afterwards.
        // The audience is resolved rather than assumed, on the same
        // snapshot the lock is held on: it re-reads the Request's own
        // id, so the comment cannot land on a record the client named.
        // A Member+ is in every room on a Request, so this never
        // refuses a triager — it is what says the check happened.
        const audience = await reachedThread(tx, request.user, {
          entityType: "request",
          entityId: held.id,
        });
        await postComment(tx, app.notifier, {
          audience,
          author: request.user,
          body: reply,
          // Never the triager's choice. A closing reply the requester
          // cannot read is an internal note, and the thread's own
          // composer is where those are written (DD-016).
          visibility: "full_thread",
        });

        await tx.update(requests).set({ status: "resolved" }).where(eq(requests.id, held.id));

        // DD-017's narration, in the transaction that wrote the status,
        // so no resolution exists without the entry that says who made
        // it. INT-007 calls that the audit datum the dropped
        // `assigned_to` column was never going to carry.
        await recordActivity(tx, {
          entityType: "request",
          entityId: held.id,
          actorId: request.user.id,
          action: "request.resolved",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: held.number },
        });

        // The closure, as its own news. The audience, the actor
        // exclusion, the preferences, and the after-commit wake-up are
        // all the seam's; this route says which way the Request moved.
        await app.notifier.requestStatusChanged(tx, {
          requestId: held.id,
          actorId: request.user.id,
          actorName: request.user.displayName,
          from: "new",
          to: "resolved",
        });
      });
    },
  );
};
