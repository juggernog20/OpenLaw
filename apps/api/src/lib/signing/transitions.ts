// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one status funnel every envelope feed goes through (M15/3,
 * CTR-013, TECH-013).
 *
 * An envelope's fate is told to OpenLaw by three different mouths: the
 * Connect webhook pushes it, the reconciliation sweep asks for it, and
 * the void route causes it. They arrive at different times, in any
 * order, and more than once each. That is exactly why there is one
 * function here and not one per caller: **a transition already applied
 * is a no-op**, and a rule that lives once cannot disagree with itself.
 *
 * Three promises make the callers safe together.
 *
 * - **The row is locked before it is read.** Two deliveries for one
 *   envelope serialize behind `for update`, so the second one reads the
 *   status the first one wrote rather than the status they both started
 *   from. A replay is then a no-op because the row says so, not because
 *   two racing readers happened to disagree in the caller's favour.
 * - **A terminal envelope never moves again.** Signed, declined, and
 *   voided are endings. A late `sent` delivery — Connect re-sends, a
 *   sweep that read a stale page — must not drag a finished record back
 *   into "out for signature", and a second ending must not overwrite
 *   the first one the record already narrated.
 * - **The row and its activity entry commit together.** The narration
 *   is written inside the same transaction as the move (DD-017), so a
 *   failed log write rolls the status back rather than leaving an
 *   ending nobody can read the story of.
 *
 * **An unknown envelope is not an error.** A delivery for an envelope
 * this install does not hold — another tenant's, a record that was
 * deleted, an id from a console somebody tested by hand — answers
 * `unknown`. The webhook route turns that into a plain acknowledgement:
 * refusing it would make an install's own error log the provider's
 * retry queue.
 *
 * **Attribution is the caller's.** A status the provider reported has
 * no human behind it, so the entry carries no actor and the feed reads
 * it as the integration speaking. A void somebody took on the record
 * carries the person who took it. Both are the same transition.
 */

import {
  and,
  contractEnvelopes,
  eq,
  type Db,
  type EnvelopeStatus,
  type SigningProviderKey,
} from "@openlaw/db";
import { MAX_ENVELOPE_REASON_LENGTH } from "@openlaw/shared";
import { recordActivity, RECORD_ACTIVITY_TIER, type ActivityAction } from "../activity.js";

/** One envelope, as a caller of this module sees it after the move. */
export interface TransitionedEnvelope {
  id: string;
  /** The record the envelope is about, so a caller can act on the
   * contract without reading the row a second time. */
  contractId: string;
  status: EnvelopeStatus;
  reason: string | null;
  completedAt: Date | null;
}

/**
 * What one feed says happened to one envelope.
 *
 * `provider` rides beside the id because the correlation key is the
 * pair (`contract_envelopes` unique index): two adapters may mint the
 * same id, and a delivery from one must never land on the other's row.
 */
export interface EnvelopeStatusChange {
  provider: SigningProviderKey;
  providerEnvelopeId: string;
  status: EnvelopeStatus;
  /** The signer's or the voider's own words. Kept only for a decline
   * or a void — the schema's own `reason_status` check says the same. */
  reason?: string;
  /** When the provider says it ended. Absent, the moment we were told
   * is the honest answer, and it is what the row records. */
  completedAt?: Date;
  /** The person who caused it, when a person did. Omitted for the
   * provider's own feeds, which is what attributes the entry to the
   * integration rather than to somebody who happened to be logged in. */
  actorId?: string;
}

/**
 * What became of one status change.
 *
 * `unchanged` and `applied` are both success. A caller distinguishes
 * them to decide whether there is follow-on work — the executed-copy
 * fetch, a status advance — not to decide whether it failed.
 */
export type EnvelopeTransition =
  | { outcome: "unknown" }
  | { outcome: "unchanged"; envelope: TransitionedEnvelope }
  | { outcome: "applied"; envelope: TransitionedEnvelope };

/** The endings. A row at any of these is finished with (see the module
 * note): nothing moves it again. */
const TERMINAL_STATUSES: ReadonlySet<EnvelopeStatus> = new Set(["signed", "declined", "voided"]);

/** The statuses that carry a reason, which is the schema's own rule
 * (`contract_envelopes_reason_status`) said once more where the value
 * is chosen rather than where it is stored. */
const REASONED_STATUSES: ReadonlySet<EnvelopeStatus> = new Set(["declined", "voided"]);

/**
 * The three verbs an ending is narrated with. Named, rather than left as
 * the whole vocabulary, so the entry below is one of three shapes rather
 * than one of a hundred — and so `envelope.sent`, which the send route
 * writes with a payload of its own, cannot be reached from here.
 */
type EnvelopeEndingAction = Extract<
  ActivityAction,
  "envelope.signed" | "envelope.declined" | "envelope.voided"
>;

/**
 * The verb each ending is narrated with (DD-017).
 *
 * `sent` has none on purpose: a row is born `sent` by the send route,
 * which narrates `envelope.sent` itself. Nothing here can ever move an
 * envelope *into* `sent`, so there is no entry to write for it.
 */
const TRANSITION_ACTION: Partial<Record<EnvelopeStatus, EnvelopeEndingAction>> = {
  signed: "envelope.signed",
  declined: "envelope.declined",
  voided: "envelope.voided",
};

/**
 * The reason as the row keeps it: trimmed, bounded, and only where it
 * belongs.
 *
 * Bounded because this text arrives over an internet-facing write path
 * and is drawn on the record's envelope row. Verification means only
 * the real provider can put it there, so the cap is not a guard against
 * an attacker — it is a guard against a row that cannot be read.
 */
function keptReason(status: EnvelopeStatus, reason: string | undefined): string | null {
  if (!REASONED_STATUSES.has(status)) return null;
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_ENVELOPE_REASON_LENGTH) return trimmed;
  const cut = trimmed.slice(0, MAX_ENVELOPE_REASON_LENGTH);
  // The bound counts UTF-16 units, so the cut can land between the two
  // halves of a surrogate pair. A stranded high half reaches the
  // database as U+FFFD, so the character is dropped whole instead.
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Moves one envelope to the status a feed reports, once.
 *
 * Answers `unknown` for an envelope this install does not hold,
 * `unchanged` when the row is already where it is being asked to go or
 * has already ended, and `applied` with the row as it now stands when
 * the move was this call's.
 *
 * The transaction is this function's own rather than the caller's: the
 * lock, the move, and the narration are one indivisible act, and a
 * caller that opened the transaction could hold it across a call to
 * somebody else's network.
 */
export async function applyEnvelopeStatus(
  db: Db,
  change: EnvelopeStatusChange,
): Promise<EnvelopeTransition> {
  return db.transaction(async (tx) => {
    // Locked before it is read, so a replay arriving at the same moment
    // waits and then reads what the first one wrote.
    const [row] = await tx
      .select({
        id: contractEnvelopes.id,
        contractId: contractEnvelopes.contractId,
        status: contractEnvelopes.status,
        reason: contractEnvelopes.reason,
        completedAt: contractEnvelopes.completedAt,
      })
      .from(contractEnvelopes)
      .where(
        and(
          eq(contractEnvelopes.provider, change.provider),
          eq(contractEnvelopes.providerEnvelopeId, change.providerEnvelopeId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) return { outcome: "unknown" };

    const held: TransitionedEnvelope = {
      id: row.id,
      contractId: row.contractId,
      status: row.status,
      reason: row.reason,
      completedAt: row.completedAt,
    };
    // An ending stands, and a status that is already the row's is
    // nothing to write. Both are the same answer to the caller: the
    // record already says what this feed came to say.
    if (TERMINAL_STATUSES.has(row.status) || row.status === change.status) {
      return { outcome: "unchanged", envelope: held };
    }

    const action = TRANSITION_ACTION[change.status];
    // Unreachable while `sent` is the only non-terminal status: the row
    // is `sent`, so the target is terminal and every terminal status has
    // a verb. It is a refusal rather than an assertion so that a fifth
    // status added without a verb cannot silently move a record with no
    // entry to say it happened.
    if (!action) return { outcome: "unchanged", envelope: held };

    const reason = keptReason(change.status, change.reason);
    // The moment we were told, when the provider named none. The column
    // is paired with a terminal status by a check constraint, so a
    // guess is not an option here — an ending has an ending time.
    const completedAt = change.completedAt ?? new Date();
    await tx
      .update(contractEnvelopes)
      .set({ status: change.status, reason, completedAt })
      .where(eq(contractEnvelopes.id, row.id));

    await recordActivity(tx, {
      entityType: "contract",
      entityId: row.contractId,
      // Absent for a provider-reported status, which is what makes the
      // feed read it as the integration rather than as a person.
      ...(change.actorId !== undefined ? { actorId: change.actorId } : {}),
      action,
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        envelopeId: row.id,
        provider: change.provider,
        providerEnvelopeId: change.providerEnvelopeId,
        status: change.status,
        ...(reason !== null ? { reason } : {}),
      },
    });

    return {
      outcome: "applied",
      envelope: { ...held, status: change.status, reason, completedAt },
    };
  });
}
