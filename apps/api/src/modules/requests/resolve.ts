// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolve (INT-006, INT-007, #419): the disposition for an ask that was
 * answered in the thread and is honestly done.
 *
 * **The closing reply is optional, and it is optional on purpose.**
 * INT-006's trivial question is answered in the conversation, so by the
 * time somebody presses Resolve the answer is often already on the
 * thread and a second copy of it would be noise. A substantive question
 * does not end here at all — it converts (INT-007, DD-018).
 *
 * **When it is given, it is an ordinary Full Thread comment.** It is
 * written through the same call `POST /comments` writes through
 * (`comments/post.ts`), so it lands on the thread, narrates as
 * `comment.posted` at its own tier, and raises `requestReplied` like any
 * other staff reply. Full Thread rather than a tier the triager picks: a
 * closing reply the requester cannot see is not a closing reply, it is
 * an internal note, and the composer on the same screen is where those
 * are written (DD-016).
 *
 * **The reply and the closure are different news, and both are sent.**
 * The reply is the answer and the status change is the closure, and a
 * requester may reasonably get both — that is what separates Resolve
 * from Decline, where `requestDeclined` fires *instead of* the status
 * change because the reason and the closure are one act (the M20/8
 * rule). Here there are two acts, so there are two events.
 *
 * **`requestStatusChanged` gets its first caller here**, completing the
 * catalogue M20/8 shipped with no callers at all.
 *
 * **The narration says who resolved, and not what they said.** DD-017's
 * entry carries the actor and the Request's number. The closing reply is
 * a comment, and the log is append-only — text that enters a payload can
 * never leave it (CMT-008), so what was said stays where a redact can
 * still reach it.
 *
 * The lock, the `new` guard, the race refusal, and the envelope read are
 * all `disposition.ts`'s. This module is what a resolution writes and
 * what it tells the requester.
 */

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
          "Close a Request that has been answered (INT-006). The second " +
          "of INT-007's three dispositions: it transitions the Request " +
          "from `new` to `resolved` under the Request's own row lock, so " +
          "two triagers racing one Request produce one resolution. The " +
          "loser is answered 409 with the recorded outcome rather than a " +
          "second resolution. `reply` is optional — the answer is often " +
          "already on the thread, and INT-006 asks for a closing reply " +
          "rather than requiring one. Given, it is posted as an ordinary " +
          "Full Thread comment: it lands on the conversation, narrates " +
          "as comment.posted, and notifies the Requester as any staff " +
          "reply does. Raises `requestStatusChanged` beside it, because " +
          "an answer and a closure are two pieces of news and the " +
          "requester may have both. Appends one request.resolved entry " +
          "naming the actor (DD-017, INT-007: who dispositioned is audit " +
          "data); what was said is on the thread, not in the payload. " +
          "Answers the Request as the staff detail reads it. Member+ only",
        tags: ["requests"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          /** The closing reply, or absent where the thread already holds
           * the answer. It takes exactly what the composer takes, from
           * the composer's own schema — one ceiling for one column. */
          reply: CommentBodySchema.optional(),
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
        if (reply !== undefined) {
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
        }

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
