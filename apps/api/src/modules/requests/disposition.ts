// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Disposition (INT-007): the one guarded act every triage outcome is,
 * and the refusal the loser of a race is answered with.
 *
 * INT-007 removed the claim step and the parked state. Acting on a
 * Request means choosing its outcome then and there — Convert, Resolve,
 * or Decline — and the Inbox row's Assign button is an entry to that
 * choice rather than a write. Cancelling the flow returns the Request to
 * the queue untouched, because nothing was written when it opened.
 *
 * That decision has a cost, and this module is where it is paid. With no
 * claim, two triagers open the same Request and both press. So:
 *
 * **A disposition transitions a Request only from `new`, under the
 * Request's own row lock.** The lock is taken before the status is read,
 * so the status a route branches on is the status the transition writes
 * against — the contract renewal's rule (CTR-006), for the same reason.
 * Everything the outcome writes happens inside that same transaction,
 * which is what makes one Request produce one event, one activity entry,
 * and one email.
 *
 * **The loser is answered the recorded outcome, not a second decline.**
 * A Request that is no longer `new` refuses with
 * {@link REQUEST_DISPOSITIONED_PROBLEM_TYPE} at 409, carrying the
 * outcome as an RFC 9457 extension member — the soft gate's house style
 * (TECH-020). A client branches on the type and reads `outcome`; it
 * never parses the sentence, because the sentence is copy. So the second
 * triager is told what happened rather than being handed a second
 * decision, and one Request never becomes two records. A conversion
 * carries `convertedContract` beside it, because "somebody converted
 * this" without the C-### is news the loser cannot act on (M21/9).
 *
 * **The three outcomes are three routes over one scaffold.** Decline
 * (M21/7), Resolve (M21/8), and Convert (M21/9) each hang their own work
 * on {@link dispositionOf} rather than restating the lock, the guard,
 * the refusal, and the envelope read. What differs between them is what
 * they write and which event they raise, and that is all a route should
 * have to say. Convert is the one that made the scaffold say more: it
 * added the second extension member above, and nothing else.
 *
 * **The envelope is read back inside the transaction.** A disposition
 * answers the same `StaffRequestSchema` the staff detail answers — the
 * house shape for a write, and the shape Convert needs, because the
 * record a conversion made is part of what it did. Reading it inside the
 * transaction is what makes the reply describe what this act wrote
 * rather than what a concurrent one left behind.
 */

import { and, eq, isNull, requests, type RequestStatus, type Transaction } from "@openlaw/db";
import { z } from "zod";
import {
  REQUEST_DISPOSITIONED_PROBLEM_TYPE,
  REQUEST_OUTCOMES,
  type RequestOutcome,
} from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import { httpError, problemTypeResponse } from "../../lib/problem.js";
import { NO_REQUEST, staffRequestRow, toStaffRequest } from "./projection.js";

/** INT-006: Member+ triages, and there are no routing rules to narrow
 * that further. Every disposition route wears it. */
export const REQUIRE_TRIAGER = ["administrator", "legal_team_member"] as const;

/** The R-### a disposition is addressed by, as every route takes it. */
export const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/**
 * The Request one disposition holds, read under its own row lock.
 *
 * Narrow on purpose: a route writing an outcome needs the row's identity
 * and its reference, and everything else it wants to say about the
 * Request comes back in the envelope the act answers.
 */
export interface HeldRequest {
  id: string;
  /** INT-002's global reference, for the payload a narration writes. */
  number: number;
}

/**
 * What the seam says when somebody already decided (INT-007, TECH-020).
 *
 * The `outcome` is on the wire as an extension member rather than in the
 * sentence, because it is the one fact the losing client acts on: it
 * closes its dialog, says what happened, and re-reads the Request.
 */
const REFUSALS: Record<RequestOutcome, string> = {
  converted: "This request has already been converted. Read it again to see the record it became.",
  resolved: "This request has already been resolved. Read it again to see the outcome.",
  declined: "This request has already been declined. Read it again to see the reason.",
};

/**
 * The 409 vocabulary every disposition route declares (TECH-020).
 *
 * One helper rather than three copies: the three routes answer the same
 * refusal for the same reason, and a document that spelled it three ways
 * would invite a client to branch three ways.
 *
 * **Two extension members, because a lost race has two facts in it**
 * (the INT-006 M21/2 addendum: "an RFC 9457 problem type carrying the
 * outcome and, for a conversion, the record it became"). `outcome` says
 * what was decided and `convertedContract` says what it produced, and
 * the second is only ever set on a conversion. It is `null` on every
 * other outcome and on a conversion into a record this caller may not
 * reach — the same DD-014 rule the envelope's own link obeys, so a
 * refusal never hands a client a reference the read would have withheld.
 */
export function dispositionedResponse(unnamed: string) {
  return problemTypeResponse(
    "The named type says somebody has already dispositioned this Request (INT-007) — " +
      "there is no claim step, so two triagers can open one Request and only the first " +
      "press writes. The refusal carries `outcome`: the recorded decision, which the " +
      "loser's client states instead of asking again; and, where that decision was a " +
      "conversion this caller may reach, `convertedContract`: the record it became. " +
      unnamed,
    [REQUEST_DISPOSITIONED_PROBLEM_TYPE],
    {
      // From the shared list, never retyped: the document's vocabulary
      // and the refusal's are one wire contract, and a copy that drifted
      // would document an outcome the seam never sends.
      outcome: z
        .enum(REQUEST_OUTCOMES)
        .optional()
        .describe(
          "What was recorded, on the named refusal alone. A client branches on this, " +
            "never on `detail` — `detail` is copy, and copy is rewritten.",
        ),
      convertedContract: z
        .object({ number: z.number().int() })
        .nullable()
        .optional()
        .describe(
          "The contract the winning conversion made, by its C-### number — null on " +
            "every other outcome, and null on a record this caller cannot reach " +
            "(DD-014). The matter arm lands with M22.",
        ),
    },
  );
}

/**
 * Runs one disposition against one Request, or refuses it.
 *
 * The whole act — the lock, the `new` guard, whatever the outcome writes,
 * its narration, its notification, and the envelope read — happens in
 * one notifying transaction. So a decline that fails part-way leaves no
 * status, no entry, and no email, and a decline that commits produces
 * exactly one of each.
 *
 * `decide` is the only part that differs between the three outcomes. It
 * is handed the locked Request and the transaction, and it writes the
 * status, the narration, and the event. Everything around it is the same
 * sentence for all three, which is why it is here rather than in each
 * route.
 */
export async function dispositionOf(
  app: { notifier: Notifier },
  user: AuthenticatedUser,
  number: number,
  decide: (tx: NotifyingTransaction, held: HeldRequest) => Promise<void>,
) {
  return app.notifier.notifying(async (tx) => {
    const held = await lockUndecided(tx, user, number);
    await decide(tx, held);
    // Read back inside the transaction, so the reply states what this
    // act wrote. The join is the detail read's own, under this viewer's
    // reach (DD-014) — a disposition answers no more than the screen
    // that opened the Request could already see.
    return { request: toStaffRequest(await staffRequestRow(tx, user, number)) };
  });
}

/**
 * Takes the Request's row lock and answers it only while it is
 * undecided.
 *
 * `FOR UPDATE` before the status is read, not after: an unlocked read
 * lets a concurrent disposition commit between the check and the write,
 * and both triagers then believe they decided. With the lock, the second
 * transaction blocks until the first commits and then reads the status
 * the first wrote — which is what turns the race into a refusal that can
 * name what happened.
 *
 * An archived Request is absent rather than undecided, by the house rule
 * that NULL means live, and it answers the read's own 404 so a stale
 * bookmark says the same thing on the write as it does on the read.
 */
async function lockUndecided(
  tx: Transaction,
  user: AuthenticatedUser,
  number: number,
): Promise<HeldRequest> {
  const [row] = await tx
    .select({ id: requests.id, number: requests.number, status: requests.status })
    .from(requests)
    .where(and(eq(requests.number, number), isNull(requests.archivedAt)))
    .limit(1)
    .for("update");
  if (!row) throw httpError(404, NO_REQUEST);
  const outcome = outcomeOf(row.status);
  if (outcome) {
    // The record the winner made, read through the envelope's own join
    // so the refusal and the read apply one reach rule (DD-014). Read
    // only on the refusal path: the winning triager never pays for it,
    // and the loser is about to be told something the plain `outcome`
    // cannot say — which C-### to open.
    const { convertedContract } = toStaffRequest(await staffRequestRow(tx, user, number));
    throw httpError(409, REFUSALS[outcome], {
      type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
      extensions: { outcome, convertedContract },
    });
  }
  return { id: row.id, number: row.number };
}

/** The recorded decision, or null while the Request is still undecided.
 * Written as a narrowing rather than a `!== "new"` test, so an arm added
 * to the lifecycle stops compiling here until somebody has decided
 * whether it is an outcome. */
function outcomeOf(status: RequestStatus): RequestOutcome | null {
  switch (status) {
    case "new":
      return null;
    case "converted":
    case "resolved":
    case "declined":
      return status;
  }
}
