// SPDX-License-Identifier: AGPL-3.0-only

/** Browser-independent provider status recovery (CTR-013, TECH-007).
 * The five-minute job checks only due rows. Drafts, sent Envelopes and
 * discarded preparations share the durable 15-minute provider-read allowance
 * with browser returns and Resume. Discarded rows remain observable because
 * they can be restored outside OpenLaw. Interrupted creation uses its recovery
 * claim. Every observation passes through the same transactional status writer.
 */

import {
  and,
  asc,
  contractEnvelopes,
  envelopeLaunches,
  gt,
  inArray,
  ne,
  or,
  sql,
  type Db,
  type SigningProviderKey,
} from "@openlaw/db";
import { recoverEnvelope, recoveryDue } from "../lib/signing/recovery.js";
import { requestExecutedCopy } from "../lib/signing/completion.js";
import {
  checkEnvelopeStatus,
  CREATION_READ_GRACE_MINUTES,
  LAUNCH_LIFETIME_MINUTES,
  LAUNCH_RETURN_GRACE_MINUTES,
  reconciliationDue,
} from "../lib/signing/status-check.js";
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

/** The worker checks for due Envelopes every five minutes. Each Envelope
 * has a durable 15-minute minimum between provider calls. */
export const RECONCILIATION_SWEEP_CRON = "*/5 * * * *";

/**
 * Which drafts the sweep asks about (#1170 §7, #1172).
 *
 * Two bounded graces, each one read interval long, and no lock:
 *
 * - Not one created less than `CREATION_READ_GRACE_MINUTES` ago. Its
 *   creation response is the evidence that it is a draft, and its first
 *   launch usually follows within moments, so a read now would learn
 *   nothing while spending the allowance the first return needs. Once the
 *   grace passes the draft is polled whether or not anybody launched it:
 *   a preparation can be sent through the provider account with no
 *   browser session, and in Polling mode nothing else would learn it.
 * - Not one launched less than `LAUNCH_RETURN_GRACE_MINUTES` ago with its
 *   correlation still unconsumed. The return usually arrives inside the
 *   interval and spends the first eligible read itself. An unconsumed
 *   correlation is not proof that the editor is open — a sender can send
 *   and close the browser, or the return can be lost — so once the grace
 *   passes the draft is polled however long the correlation stays valid.
 *
 * Neither a correlation's existence nor the confirmation flag decides
 * whether a live draft is ever polled; only the clock does. A later
 * launch may therefore find the allowance already spent by a poll, and
 * its return then waits for the next allowed check, which #1170 §7 allows.
 *
 * A `sent` row is never deferred: a verified notification may have moved
 * it while a correlation was still open, and its completion polling must
 * carry on.
 */
const pollableDraft = () =>
  or(
    ne(contractEnvelopes.status, "draft"),
    and(
      sql`${contractEnvelopes.createdAt} <= clock_timestamp() - make_interval(mins => ${CREATION_READ_GRACE_MINUTES})`,
      sql`not exists (
        select 1 from ${envelopeLaunches}
        where ${envelopeLaunches.envelopeId} = ${contractEnvelopes.id}
          and ${envelopeLaunches.consumedAt} is null
          and ${envelopeLaunches.expiresAt} - make_interval(mins => ${LAUNCH_LIFETIME_MINUTES})
              > clock_timestamp() - make_interval(mins => ${LAUNCH_RETURN_GRACE_MINUTES})
      )`,
    ),
  );

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
  providerEnvelopeId: string | null;
  status: string;
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
  let recoveries = 0;

  for (;;) {
    if (options.signal?.aborted) {
      summary.stopped = true;
      return summary;
    }
    const page: LiveEnvelope[] = await deps.db
      .select({
        id: contractEnvelopes.id,
        provider: contractEnvelopes.provider,
        status: contractEnvelopes.status,
        providerEnvelopeId: contractEnvelopes.providerEnvelopeId,
      })
      .from(contractEnvelopes)
      .where(
        and(
          // Discarded drafts remain observable for external restoration.
          or(
            recoveryDue(),
            and(
              inArray(contractEnvelopes.status, ["draft", "sent", "discarded"]),
              reconciliationDue(),
              pollableDraft(),
            ),
          ),
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
      if (envelope.status === "preparing") {
        if (options.signal?.aborted) {
          summary.stopped = true;
          return summary;
        }
        if (recoveries >= RECONCILIATION_REFUSAL_LIMIT) continue;
        recoveries += 1;
        await recoverEnvelope(
          { ...deps, resolveSigningProvider: async () => signing },
          jobs,
          envelope.id,
        );
        continue;
      }
      if (!envelope.providerEnvelopeId) continue;
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
        const checked = await checkEnvelopeStatus(deps.db, signing, envelope.id);
        if (!checked) continue;
        state = checked;
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

      // One funnel, its own transaction, no wrapper around it — and no
      // actor, which is what attributes the entry to the integration
      // rather than to somebody who happened to be logged in.
      const applied = await applyEnvelopeStatus(deps.notifier, {
        provider: envelope.provider,
        providerEnvelopeId: envelope.providerEnvelopeId,
        status: state.status,
        ...(state.scheduled !== undefined ? { scheduled: state.scheduled } : {}),
        ...(state.sentAt !== undefined ? { sentAt: state.sentAt } : {}),
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
        if (state.status === envelope.status) summary.live += 1;
        else summary.alreadyEnded += 1;
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
