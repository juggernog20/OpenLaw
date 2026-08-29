// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Erasing an external signer (CTR-013 M15/7, DD-017,
 * [#280](https://github.com/juggernog20/OpenLaw/issues/280)). The
 * Administrator-only route behind a lawful-erasure request from a
 * person who is only ever a signer.
 *
 * The act itself, and every argument for its shape, is in
 * `lib/signer-erasure.ts`. What this file adds is who may ask, what they
 * ask with, and the one refusal.
 *
 * The request is an address, because that is what an erasure request
 * arrives as: somebody writes to the operator and gives the address the
 * invitation reached. It is not an envelope id or a contract number.
 * The person asking has neither, and the request is about them rather
 * than about one round of signature.
 *
 * Administrator-only. It rewrites the audit log, which is the
 * Administrator's own surface (DD-017 layer 2), and it is not a thing to
 * do on somebody's behalf without being the person accountable for it.
 *
 * An address that belongs to a user of this install is refused. That
 * address is in payloads that are about them as a colleague — invited,
 * role changed, added to a team — and those have a different answer
 * (DD-013's archival). Erasing only their signer appearances would
 * half-answer a request in a way nobody could reason about afterwards.
 *
 * An address that was never a signer's answers 200 with zeros. The
 * request is satisfied either way: there was nothing to erase. Refusing
 * it would make the seam a way to ask whether an address is in the
 * record.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, sql, users } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { eraseSigner } from "../../lib/signer-erasure.js";

const ErasureBody = z.object({
  /** The address the invitation went to. Bounded exactly as a signer's
   * address is on the send. */
  email: z.email().max(320),
});

const ErasureEnvelope = z.object({
  erasure: z.object({
    /** `envelope.sent` entries whose signer array was rewritten. */
    entriesRedacted: z.int(),
    /** Envelope signer rows deleted. */
    signerRowsDeleted: z.int(),
  }),
});

export const signerErasureRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/signer-erasures",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "eraseSigner",
        summary:
          "Erase an external signer's name and address (CTR-013, " +
          "DD-017). Every `envelope.sent` activity entry naming this " +
          "address has that name and address rewritten to a tombstone, " +
          "in place, and the envelope's signer rows for it are deleted. " +
          "The entry keeps its shape: how many people were asked, and " +
          "in what order, is about the contract rather than about the " +
          "person. The erasure is itself appended to the log, carrying " +
          "counts and no address. Refused for an address that belongs " +
          "to a user of this install — their erasure is a different " +
          "act. An address that was never a signer's answers with " +
          "zeros. Copies already shipped to a SIEM are outside this " +
          "install and are the operator's to purge",
        tags: ["signing-connector"],
        body: ErasureBody,
        response: { 200: ErasureEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const email = request.body.email.trim();
      const erasure = await app.db.transaction(async (tx) => {
        const [account] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
          .limit(1);
        if (account) {
          throw httpError(
            409,
            "That address belongs to a user of this install. Erasing a user is a " +
              "different act — archive the account instead. This route is for a person " +
              "who only ever appears as a signer.",
          );
        }

        const done = await eraseSigner(tx, email);
        // Appended inside the same transaction, so the log cannot say
        // an erasure happened that rolled back, or stay silent about
        // one that did not. No address: see `lib/signer-erasure.ts`.
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "signer.erased",
          visibility: "admin_only",
          payload: done,
        });
        return done;
      });
      return { erasure };
    },
  );
};
