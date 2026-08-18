// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The reconciliation sweep (M15/6, CTR-013, TECH-007): the fallback feed
 * that makes an install the provider cannot reach converge anyway.
 *
 * DocuSign Connect needs a publicly reachable address, and many
 * self-hosted installs have none. Connect is still the **primary** feed —
 * it is immediate, and it costs nothing when it works. This sweep is the
 * **fallback**: every so often it asks the provider where each live
 * envelope stands and applies what it is told. A deployer behind a
 * firewall therefore loses latency and nothing else.
 *
 * **Neither feed knows about the other, and both are safe together.**
 * They funnel into `applyEnvelopeStatus`, which locks the row, refuses
 * to move an envelope that has already ended, and writes the row and its
 * narration in one transaction. A status the webhook already delivered
 * answers `unchanged` here and writes nothing — no second row, no second
 * entry on the feed. That one property is what lets this run beside
 * Connect with no coordination between them at all.
 *
 * It also recovers a delivery that was **dropped rather than retried**.
 * A Connect delivery that arrives before the send transaction commits
 * names an envelope this install does not hold yet, and the route
 * acknowledges it — refusing would make our own log the provider's retry
 * queue. Nothing more is coming for that envelope, so without this sweep
 * it would sit `sent` for ever while the provider held a signed one.
 *
 * Four rules shape it, three of them M12/6's applied to a feed rather
 * than to a queue.
 *
 * **It asks; it never decides.** The provider's answer is the whole
 * input, and the funnel is the only writer. There is no second path for
 * a status that arrived this way, so a swept envelope ends exactly as a
 * webhooked one does — the same row, the same entry, the same
 * executed-copy fetch hanging off the same `applied` result.
 *
 * **A provider that cannot be reached is the moment's, not the
 * envelope's.** An outage is logged and nothing is marked: no row is
 * failed, no envelope is given up on, and the next round asks again. The
 * bound below is what keeps a sweep from spending minutes learning the
 * same thing once per envelope.
 *
 * **A live envelope is not a change.** The provider saying "still out"
 * is the record's own answer already, so the funnel is not called for
 * it. The funnel is for changes, and a transaction per unchanged
 * envelope per round would be a lock taken to write nothing.
 *
 * **It reads the record, never a cursor it kept.** Whatever one round
 * misses — a stopped container, a provider outage, a page it never
 * reached — is still `sent` at the next round, so there is no progress
 * to persist and nothing to get wrong about resuming.
 *
 * **A round belongs to the install, not to a process.** The other two
 * sweeps ask for work the rows already say is owed, so a second worker
 * replica walks the same table and finds nothing left to ask for. This
 * one asks a third party the same question every round, so an in-process
 * timer meant that replica count multiplied the provider requests — and
 * this is the endpoint DocuSign rate-limits hardest. It is therefore a
 * scheduled pg-boss job on {@link RECONCILIATION_SWEEP_CRON}, the shape
 * the backfill sweep already has: pg-boss elects one cron worker per
 * queue, so N replicas produce one round. The queue is a singleton, so a
 * tick that lands while a round is still going waits for it rather than
 * joining it.
 *
 * The cost of that move is named rather than hidden: **there is no round
 * at boot any more.** A worker that has just restarted waits for the
 * next tick. That is the right trade for a fallback feed measured in
 * minutes, and a boot round per replica would have put the duplication
 * straight back on every rolling deploy.
 */

import { and, asc, contractEnvelopes, eq, gt, type Db, type SigningProviderKey } from "@openlaw/db";
import { requestExecutedCopy } from "../lib/signing/completion.js";
import {
  isTerminalSigningError,
  SigningConfigError,
  type EnvelopeState,
} from "../lib/signing/provider.js";
import type { SigningResolver } from "../lib/signing/resolver.js";
import type { Notifier } from "../lib/notifications/notifier.js";
import { applyEnvelopeStatus } from "../lib/signing/transitions.js";
import { reasonOf } from "./derivations.js";
import type { JobQueue } from "./jobs.js";
import type { PipelineLogger } from "./logger.js";

/**
 * How many live envelopes are read at a time.
 *
 * The executed-copy sweep's page, for its reason: the set is the
 * envelopes that are still out, not every row an install holds.
 */
export const RECONCILIATION_PAGE_SIZE = 100;

/**
 * How many envelopes in a row may be unreachable before the sweep gives
 * up on this round.
 *
 * A provider answering nothing several times in a row is down, not busy,
 * and asking once per live envelope costs a round trip each to be told
 * the same thing. The bound is small because the recovery is free: every
 * envelope is still `sent`, so the next round asks again.
 */
export const RECONCILIATION_REFUSAL_LIMIT = 5;

/**
 * How often a round runs.
 *
 * Five minutes is chosen from what it is for. It is the fallback feed,
 * so it is measured against "somebody signed and nobody has told us",
 * not against Connect's seconds — and an install that has Connect never
 * notices it at all, because the webhook gets there first and every
 * round then finds nothing to do. Shorter would ask a third party for
 * the same answer more often; longer would leave a firewalled install
 * watching a stale record over a coffee.
 *
 * It is a cron rather than a timer because the round belongs to the
 * install and not to a process: pg-boss elects one cron worker, so two
 * worker replicas produce one round's worth of provider requests rather
 * than two. Read in UTC, which is pg-boss's default and the only
 * timezone this install agrees on.
 */
export const RECONCILIATION_SWEEP_CRON = "*/5 * * * *";

/** What the sweep is built from: the rows, the connector, somewhere to
 * ask for follow-on work, and somewhere to say what it did. */
export interface ReconciliationDeps {
  db: Db;
  log: PipelineLogger;
  /** The connector, read live per page (CTR-013's mailer-resolver
   * pattern), so a key an Administrator rotated during a round is the
   * key the round's next page uses. */
  resolveSigningProvider: SigningResolver;
  /** The notification seam (NOT-001), which owns the transaction the
   * status funnel writes in. A round that converges an envelope tells
   * the record's people the outcome, with no actor — this round is the
   * integration speaking. */
  notifier: Notifier;
}

/** What a caller may vary about one round. */
export interface ReconciliationOptions {
  /** Envelopes read at a time. Defaults to
   * {@link RECONCILIATION_PAGE_SIZE}. */
  pageSize?: number;
  /**
   * Stops the sweep between pages and between envelopes.
   *
   * A container is stopped by a signal, and a round that is waiting on
   * somebody else's network must not be what keeps the process alive
   * past its grace period. Whatever it did not reach is picked up by the
   * next round, because the sweep reads the record.
   */
  signal?: AbortSignal;
}

/** What one round did, for the operator's log. */
export interface ReconciliationSummary {
  /** Live envelopes looked at. */
  scanned: number;
  /** Endings this round applied — the convergence, and the whole point. */
  converged: number;
  /** Envelopes the provider says are still out. */
  live: number;
  /** Endings the record already held. The webhook got there first, and
   * the funnel wrote nothing. */
  alreadyEnded: number;
  /** Envelopes the provider refused to speak about — an id it does not
   * hold, a request it will not answer. Nothing is marked: a reader of
   * the record is better served by a live round it can void than by a
   * status this sweep invented. */
  unreadable: number;
  /** Envelopes the provider could not be asked about. Transient by
   * definition: nothing is marked and the next round asks again. */
  unreachable: number;
  /** Whether the round stopped before it reached the end — a shutdown, a
   * connector that is gone, or a provider that is down. */
  stopped: boolean;
}

/** One live envelope, as the sweep needs it described. */
interface LiveEnvelope {
  id: string;
  provider: SigningProviderKey;
  providerEnvelopeId: string;
}

/**
 * Asks the provider about every live envelope and applies what it says.
 *
 * Answers what it did rather than throwing, the M12/6 rule: a round is
 * best effort, and the scheduler above it must not stop because one
 * envelope could not be asked about.
 */
export async function runReconciliationSweep(
  deps: ReconciliationDeps,
  jobs: JobQueue,
  options: ReconciliationOptions = {},
): Promise<ReconciliationSummary> {
  const pageSize = options.pageSize ?? RECONCILIATION_PAGE_SIZE;
  const summary: ReconciliationSummary = {
    scanned: 0,
    converged: 0,
    live: 0,
    alreadyEnded: 0,
    unreadable: 0,
    unreachable: 0,
    stopped: false,
  };
  // Keyset paging on the envelope id, which is a uuidv7 and so sorts by
  // the moment it was minted. It also survives the set changing
  // underneath the round, which this one does by design: an envelope
  // this sweep converges leaves the `sent` set immediately, and an
  // offset would then step over the row after it.
  let after: string | undefined;
  // One line per kind of trouble per round. A provider that is down
  // would otherwise write one line per live envelope.
  const reported = { unreachable: false, unreadable: false };
  // Unreachable answers back to back, which is what an outage looks
  // like from here. Reset by any answer at all.
  let unreachable = 0;

  for (;;) {
    if (options.signal?.aborted) {
      summary.stopped = true;
      return summary;
    }
    const page: LiveEnvelope[] = await deps.db
      .select({
        id: contractEnvelopes.id,
        provider: contractEnvelopes.provider,
        providerEnvelopeId: contractEnvelopes.providerEnvelopeId,
      })
      .from(contractEnvelopes)
      .where(
        and(
          // The only status anything can move out of. An ending is an
          // ending (see `transitions.ts`), so a finished envelope has
          // nothing left for this sweep to learn.
          eq(contractEnvelopes.status, "sent"),
          after === undefined ? undefined : gt(contractEnvelopes.id, after),
        ),
      )
      .orderBy(asc(contractEnvelopes.id))
      .limit(pageSize);
    if (page.length === 0) return summary;

    // Read live, per page: the connector is org data that changes while
    // the process runs, and a round can take a while — a key an
    // Administrator rotates mid-round applies from the next page. Not
    // per envelope, because the driver caches its minted token and its
    // account discovery on the instance, and a fresh driver per row
    // would pay the provider's token grant once per envelope instead of
    // once per page — against the token endpoint the provider rate
    // limits. A resolver that raises is a stored row that cannot be
    // built into a driver, which is install-wide — every envelope after
    // it would fail the same way.
    const signing = await deps.resolveSigningProvider().catch((error: unknown) => {
      deps.log.error(
        { reason: reasonOf(error) },
        "the reconciliation sweep could not build the signing connector",
      );
      return null;
    });
    if (!signing) {
      // No connector, or one that will not build. There is nobody to
      // ask, and asking again for the next page would read the same
      // row and answer the same nothing.
      summary.stopped = true;
      return summary;
    }

    for (const envelope of page) {
      if (options.signal?.aborted) {
        summary.stopped = true;
        return summary;
      }
      summary.scanned += 1;

      // A record sent through one adapter is never asked about through
      // another: the row keeps the adapter that carried it precisely so
      // a connector swapped since the send cannot answer for somebody
      // else's envelope by id collision. Skipped rather than stopped —
      // the envelopes beside it may well match.
      if (signing.provider !== envelope.provider) {
        summary.unreadable += 1;
        if (!reported.unreadable) {
          reported.unreadable = true;
          deps.log.warn(
            { envelopeId: envelope.id, sentThrough: envelope.provider },
            "the reconciliation sweep skipped an envelope sent through another connector",
          );
        }
        continue;
      }

      let state: EnvelopeState;
      try {
        state = await signing.readEnvelope(envelope.providerEnvelopeId);
        unreachable = 0;
      } catch (error) {
        // The taxonomy's own split, and the whole of this sweep's
        // failure handling: terminal means the provider will not answer
        // however often we ask, transient means the moment was wrong.
        // **Neither marks anything on the record** — this sweep is a
        // reader, and a status it could not read is not a status it may
        // invent.

        // Credentials the provider refuses are install-wide: every
        // envelope after this one would be refused the same way, so the
        // round ends here rather than asking each in turn. It counts as
        // unreachable because that is what it is from the record's
        // side — nothing was learned about any envelope.
        if (error instanceof SigningConfigError) {
          summary.unreachable += 1;
          deps.log.error(
            { reason: reasonOf(error) },
            "the reconciliation sweep's credentials were refused",
          );
          summary.stopped = true;
          return summary;
        }
        // One envelope the provider will not speak about — an id it does
        // not hold, a request it refuses. The envelopes beside it may
        // still be answerable, so the round carries on.
        if (isTerminalSigningError(error)) {
          summary.unreadable += 1;
          unreachable = 0;
          if (!reported.unreadable) {
            reported.unreadable = true;
            deps.log.warn(
              { envelopeId: envelope.id, reason: reasonOf(error) },
              "the reconciliation sweep could not read an envelope's status",
            );
          }
          continue;
        }
        summary.unreachable += 1;
        unreachable += 1;
        if (!reported.unreachable) {
          reported.unreachable = true;
          deps.log.warn(
            { envelopeId: envelope.id, reason: reasonOf(error) },
            "the reconciliation sweep could not reach the signing provider",
          );
        }
        if (unreachable >= RECONCILIATION_REFUSAL_LIMIT) {
          summary.stopped = true;
          return summary;
        }
        continue;
      }

      // Still out. The record already says so, and the funnel is for
      // changes.
      if (state.status === "sent") {
        summary.live += 1;
        continue;
      }

      // One funnel, its own transaction, no wrapper around it — and no
      // actor, which is what attributes the entry to the integration
      // rather than to somebody who happened to be logged in.
      const applied = await applyEnvelopeStatus(deps.notifier, {
        provider: envelope.provider,
        providerEnvelopeId: envelope.providerEnvelopeId,
        status: state.status,
        ...(state.reason !== undefined ? { reason: state.reason } : {}),
        ...(state.completedAt !== undefined ? { completedAt: state.completedAt } : {}),
      });
      if (applied.outcome === "applied") {
        summary.converged += 1;
        deps.log.info(
          { envelopeId: envelope.id, status: state.status },
          "the reconciliation sweep converged an envelope",
        );
      } else if (applied.outcome === "unchanged") {
        // The webhook got here first, or another worker's round did.
        // Nothing was written, which is exactly what makes the two feeds
        // safe together.
        summary.alreadyEnded += 1;
      }
      // The completion's follow-on work, hung off the commit (M15/5).
      // Only an `applied` signature asks for anything, so the sweep
      // never asks for a copy the webhook's transition already asked
      // for — one path for both feeds, and it decides.
      await requestExecutedCopy(jobs, deps.log, applied);
    }

    after = page[page.length - 1]!.id;
    // A short page is the last one. Asking for another would cost a
    // round trip to be told the same thing.
    if (page.length < pageSize) return summary;
  }
}
