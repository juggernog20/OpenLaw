// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What follows a `signed` transition (M15/5, CTR-014).
 *
 * `applyEnvelopeStatus` owns its own transaction — the lock, the move,
 * and the narration are one indivisible act, and there is no hook
 * inside it. So the executed-copy fetch is a **post-commit** act, and
 * this is the one place that decides when to ask for it. Every feed
 * that can report a signature calls it with the transition's result:
 * the Connect webhook today, the reconciliation sweep beside it.
 *
 * **Only a transition this call applied asks for anything.** An
 * `unchanged` result means the record already said what the feed came
 * to say — a replayed delivery, a sweep reading a status the webhook
 * already delivered — and the first transition already asked. Asking
 * again would be harmless (the queue collapses on the envelope id, and
 * the job re-reads the row before it writes) but it would also be
 * noise, and the rule that makes the harmless case harmless is worth
 * stating rather than leaning on.
 *
 * **A queue that cannot be reached never fails the caller.** The
 * envelope's `executed_fetch` state is the durable record of the work
 * owed; the queue send only wakes a worker. A refusal is logged and the
 * boot sweep asks again — the M12 rule, applied to the one artifact
 * that arrives from somebody else's system.
 */

import type { JobQueue } from "../../pipeline/jobs.js";
import type { EnvelopeTransition } from "./transitions.js";

/** Somewhere to say that a queue could not be reached. The Fastify log
 * and the pipeline's console logger both fit it. */
interface CompletionLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Asks for the executed copy when — and only when — this call is what
 * signed the envelope.
 *
 * Resolves whatever happened. It is the caller's follow-on work, not
 * the caller's answer: a webhook that raised because a queue was busy
 * would put this install into the provider's retry queue for a job the
 * boot sweep already recovers.
 */
export async function requestExecutedCopy(
  jobs: JobQueue,
  log: CompletionLogger,
  transition: EnvelopeTransition,
): Promise<void> {
  if (transition.outcome !== "applied") return;
  if (transition.envelope.status !== "signed") return;
  const envelopeId = transition.envelope.id;
  try {
    await jobs.requestExecutedCopyFetch(envelopeId);
  } catch (error) {
    log.error(
      { err: error, envelopeId },
      "could not ask the pipeline for an envelope's executed copy",
    );
  }
}
