// SPDX-License-Identifier: AGPL-3.0-only

/**
 * pg-boss behind the pipeline seam (TECH-007).
 *
 * The queue is a set of tables in its own schema on the Postgres the
 * install already runs. There is no Redis, no broker, and no fourth
 * service — the decision's whole argument is that a ten-person legal
 * team never generates load that needs one, and a self-hoster should not
 * run a second datastore to have a background job.
 *
 * **One start, two shapes.** The same call brings up a process that only
 * sends and a process that also works. The API sends: it asks for a
 * derivation after an upload commits and never runs one, so a slow OCR
 * pass cannot touch a request. The worker container works: it registers
 * the handlers and does the reading. Which one a process is depends only
 * on whether handler dependencies were passed.
 *
 * **Queue maintenance belongs to the worker.** pg-boss's own upkeep —
 * archiving finished jobs, failing expired ones — runs in the process
 * that works the queue, so an install running several API replicas has
 * one maintainer rather than one per replica.
 */

import { PgBoss, type JobWithMetadata } from "pg-boss";
import type { MailerResolver } from "../lib/mailer.js";
import type { SigningResolver } from "../lib/signing/resolver.js";
import type { AiResolver } from "../lib/ai/resolver.js";
import { requestAutomaticContractAnalysis } from "./automatic-contract-analysis.js";
import { runBackfillSweep } from "./backfill.js";
import { handleContractAnalysis } from "./contract-analysis.js";
import type { DerivationDeps } from "./derivations.js";
import { handleDisplayConversion } from "./display-conversion.js";
import { createNotifier } from "../lib/notifications/notifier.js";
import { handleExecutedCopyFetch } from "./executed-copy.js";
import { handleNotificationEmail } from "./notification-email.js";
import {
  JOB_QUEUES,
  type ContractAnalysisJob,
  type DisplayConversionJob,
  type ExecutedCopyFetchJob,
  type JobQueue,
  type NotificationEmailJob,
  type TextExtractionJob,
} from "./jobs.js";
import { createConsoleLogger, type PipelineLogger } from "./logger.js";
import { MORNING_ROUND_CRON, runMorningRound } from "./morning-round.js";
import { RECONCILIATION_SWEEP_CRON, runReconciliationSweep } from "./reconciliation.js";
import { handleTextExtraction } from "./text-extraction.js";

/**
 * How long a job may run, and how often it is tried.
 *
 * The bounds are the pipeline's answer to "a conversion that hangs
 * LibreOffice is killed and retried". They are the queue's own settings,
 * so they apply to a job whoever sent it — the upload path, or the M12/6
 * backfill sweep.
 */
export const TEXT_EXTRACTION_QUEUE_OPTIONS = {
  /**
   * How long one attempt may run before the queue takes the job back.
   *
   * It has to be longer than the work it bounds, or a job that is
   * genuinely running is killed and retried for ever. Text extraction
   * makes **two** engine calls in the worst case — read the text layer,
   * find nothing, then OCR the pages — and each one is bounded by
   * `DOC_ENGINE_TIMEOUT_MS`, five minutes by default. Fifteen minutes
   * leaves room for both plus the reads around them, and still notices a
   * wedged worker inside a quarter of an hour.
   *
   * This budget is why `DOC_ENGINE_TIMEOUT_MS` has a ceiling
   * (`MAX_DOC_ENGINE_TIMEOUT_MS`): two bounds plus a minute for the
   * reads and the writes have to fit inside it, or a job that is
   * genuinely working loses its lease and a second worker starts the
   * same version. The configuration refuses a bound this cannot hold,
   * at boot, rather than letting the two drift apart in service.
   */
  expireInSeconds: 900,
  /**
   * Three attempts in all, which is what a transient failure needs: a
   * sidecar restarting during a deploy is back well inside the third.
   */
  retryLimit: 2,
  /** The base delay before a retry. Long enough that a restarting
   * sidecar has come back, short enough that a person who uploaded a
   * scan is still looking at the record. */
  retryDelay: 30,
  /**
   * Each retry waits longer than the last, with jitter: roughly half a
   * minute to a minute before the second attempt, and one to two minutes
   * before the third. A doc engine that is down is usually down for
   * minutes, hammering it does not bring it back sooner, and the jitter
   * keeps a backlog of jobs from returning together.
   */
  retryBackoff: true,
} as const;

/**
 * The same bounds for display conversion (M12/4), stated separately
 * because they bound different work.
 *
 * A conversion makes **two** engine calls in the worst case — convert
 * the source to a PDF, then read that PDF's text — so the ceiling is the
 * extraction queue's, for the same arithmetic: each call is bounded by
 * `DOC_ENGINE_TIMEOUT_MS`, and fifteen minutes leaves room for both plus
 * the reads and the write around them.
 *
 * They are a copy rather than a shared constant on purpose. The two
 * queues bound two different pieces of work, and an install that finds
 * LibreOffice slow on a 300-page deed should be able to raise this one
 * without also telling every OCR pass it may run for longer.
 */
export const DISPLAY_CONVERSION_QUEUE_OPTIONS = {
  /** The same fifteen minutes, and the same ceiling on
   * `DOC_ENGINE_TIMEOUT_MS` holds it — see the queue above. */
  expireInSeconds: 900,
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
} as const;

/**
 * The same bounds for the executed-copy fetch (M15/5), stated
 * separately because they bound different work again.
 *
 * The job makes **one** call to somebody else's network — the provider
 * hands back a finished PDF — and then stores it. There is no engine
 * pass in it, so the ceiling is smaller than the two above: five
 * minutes is generous for a download and still notices a wedged worker
 * quickly. The retries are the same three attempts, because the failure
 * a retry heals is the same one — a provider that was unreachable for a
 * moment.
 */
export const EXECUTED_COPY_QUEUE_OPTIONS = {
  expireInSeconds: 300,
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
} as const;

/**
 * The same bounds for one notification's immediate email (M18/1),
 * stated separately because they bound different work again.
 *
 * The job hands one message to somebody else's relay. The transport's
 * own socket bounds are tens of seconds (see `createSmtpMailer`), so two
 * minutes is generous for a send and its two small writes, and it
 * notices a wedged worker quickly — which matters here more than
 * elsewhere, because somebody has been asked to do something and is
 * waiting to hear about it.
 *
 * Three attempts on the same ladder every other queue uses: half a
 * minute, then a minute. The failure a retry heals is the same one — a
 * relay that was unreachable for a moment — and an unconfigured install
 * is not that failure and is never retried (see the handler).
 */
export const NOTIFICATION_EMAIL_QUEUE_OPTIONS = {
  expireInSeconds: 120,
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
} as const;

/** One provider call, with the pipeline's three-attempt backoff. */
export const CONTRACT_ANALYSIS_QUEUE_OPTIONS = {
  expireInSeconds: 300,
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
} as const;

/**
 * Everything a process that works the queue is built from.
 *
 * The derivation jobs need the database, storage, and the doc engine;
 * the executed-copy fetch needs the signing connector instead of the
 * engine; the notification email needs the mailer and the address this
 * install answers on. One type rather than one per queue, because a
 * worker is one process and its dependencies are chosen once at boot.
 */
export interface PipelineHandlers extends DerivationDeps {
  /** The connector, read live per call (CTR-013). An install with no
   * connector resolves to nothing, and an executed-copy job then
   * records a terminal failure rather than waiting for one. */
  resolveSigningProvider: SigningResolver;
  /** The AI connector, read live for each future analysis run (TECH-012). */
  resolveAiProvider: AiResolver;
  /**
   * The mailer, resolved per send (TECH-011, #37) exactly as the API
   * resolves it — so a relay saved in the wizard reaches the very next
   * notification email with no restart, and an install with none
   * records the skip rather than waiting for one.
   */
  resolveMailer: MailerResolver;
  /** Where this install answers (BASE_URL), so an emailed notification
   * can deep-link to the record it is about (NOT-005). */
  baseUrl: string;
  /** The size ceiling the executed-copy fetch files under — the API's
   * upload ceiling, asked of the provider's answer for the same reason.
   * Optional: unset, the job takes the same default the API does. */
  maxUploadBytes?: number;
}

/**
 * When the backfill sweep runs on its own, and how long it may take.
 *
 * Daily, in the small hours: the sweep exists so that an upgrade reaches
 * the paper uploaded before it, and a day is soon enough for work
 * nobody is waiting on. It also asks for nothing that is already done,
 * so on a swept install the run is one keyset walk and no jobs at all.
 * The cron is read in UTC, which is pg-boss's default and the only
 * timezone this install agrees on.
 */
export const BACKFILL_SWEEP_CRON = "0 4 * * *";

/** Bounds on one scheduled sweep. */
export const BACKFILL_SWEEP_QUEUE_OPTIONS = {
  /**
   * An hour, because the sweep's cost is the size of the library rather
   * than the size of one file, and the first run on a large install
   * walks every version there has ever been. It reads a page at a time
   * and holds nothing open between pages, so a long run is slow rather
   * than heavy.
   */
  expireInSeconds: 3600,
  /**
   * Never retried. A sweep that failed part way through asked for some
   * of what was owed and not the rest, and the derivation rows still
   * say what the rest is — so the next run picks it up, and a retry
   * would only bring the same failure forward.
   */
  retryLimit: 0,
} as const;

/** Bounds on one scheduled reconciliation round. */
export const RECONCILIATION_SWEEP_QUEUE_OPTIONS = {
  /**
   * Ten minutes. The round's cost is the number of envelopes still out
   * — a much smaller set than the whole library, because an ending is
   * an ending — but each one is a call to somebody else's network, and
   * the refusal bound only cuts a round short once the provider stops
   * answering altogether. Ten minutes is generous for the set and still
   * notices a wedged worker inside two intervals.
   */
  expireInSeconds: 600,
  /**
   * Never retried, for the backfill sweep's reason and one of its own.
   * A round that failed part way through learned some of what was owed
   * and not the rest, and the envelope rows still say what the rest is
   * — so the next tick picks it up. A retry would only bring the same
   * failure forward, and this sweep's usual failure is a provider that
   * is down, which a retry cannot heal.
   */
  retryLimit: 0,
} as const;

/** Bounds on one scheduled morning round. */
export const MORNING_ROUND_QUEUE_OPTIONS = {
  /**
   * Ten minutes, the reconciliation round's ceiling and for a similar
   * shape of work: the cost is the people being served and the dates due
   * for them, both small sets, plus one message each handed to somebody
   * else's relay. Ten minutes is generous for that and still notices a
   * wedged worker well inside the hour before the next tick.
   */
  expireInSeconds: 600,
  /**
   * Never retried, for the other two sweeps' reason. A round that failed
   * part way through wrote some of the reminders and sent some of the
   * briefings, and the rows say what the rest is — so the next tick
   * picks it up, and a retry would only bring the same failure forward.
   */
  retryLimit: 0,
} as const;

/** What a process needs to bring the pipeline up. */
export interface PipelineOptions {
  /**
   * The Postgres pg-boss keeps its queue in — the same database
   * everything else uses, which is the decision.
   */
  connectionString: string;
  /**
   * Passed by a process that works the queue, left out by one that only
   * sends to it. The API sends; the worker works.
   */
  handlers?: PipelineHandlers;
  /** Where the pipeline's own lines go. Defaults to stdout as JSON. */
  log?: PipelineLogger;
}

/** A running pipeline: what to ask it for, and how to put it down. */
export interface Pipeline extends JobQueue {
  /**
   * Stops working, waits for the jobs already in hand, and closes the
   * connections. A job that is still running when this is called
   * finishes; one that has not started goes back to the queue for the
   * next process that asks.
   */
  stop(): Promise<void>;
}

/**
 * Brings the pipeline up: installs or migrates pg-boss's schema,
 * declares the queues, and — when handlers were passed — starts working
 * them.
 *
 * Declaring the queues on both shapes is deliberate. A queue must exist
 * before anything may be sent to it, and an API replica that booted
 * before the worker must still be able to record a request. Declaring
 * one twice is harmless; the options are then reapplied, so an upgrade
 * that changes a bound reaches a queue that already exists.
 */
export async function startPipeline(options: PipelineOptions): Promise<Pipeline> {
  const log = options.log ?? createConsoleLogger();
  const working = options.handlers !== undefined;
  const boss = new PgBoss({
    connectionString: options.connectionString,
    // Upkeep runs where the work does. A send-only process that
    // supervised the queue would have every replica doing it.
    supervise: working,
    // A worker listens, so a job starts the moment it is sent rather
    // than at the next poll. Somebody who has just uploaded a scan is
    // watching the record, and a couple of seconds of nothing is what
    // makes a background pipeline feel broken. It costs the worker one
    // dedicated connection, and polling stays underneath it as the
    // correctness floor — a dropped listener slows the pipeline down and
    // never stops it.
    useListenNotify: working,
    // The clock runs where the work does, for the reason `supervise`
    // does: pg-boss elects one cron worker per queue, and a send-only
    // API replica has no business standing for election. The election is
    // also what makes a scheduled sweep run **once** on an install with
    // several workers, which is why the reconciliation sweep is on this
    // clock rather than on a timer of its own (#277). The backfill sweep
    // was the first thing here; reminders and digests (NOT-003,
    // ENT-006) join them with the milestone that needs them.
    schedule: working,
  });
  // pg-boss reports what it cannot fix rather than throwing: a slow
  // query, a queue that is filling up. With no listener these are lost,
  // and on `error` an EventEmitter throws instead.
  boss.on("error", (error) => {
    log.error(
      { reason: error instanceof Error ? error.message : String(error) },
      "job queue error",
    );
  });
  boss.on("warning", (warning) => {
    log.warn({ reason: warning.message }, "job queue warning");
  });

  const handlers = options.handlers;
  /**
   * The sending half, built before the working half needs it.
   *
   * Two handlers on this process send. The scheduled sweep walks the
   * versions and asks for what each one is owed, through the very same
   * two methods an upload uses. The executed-copy handler asks for the
   * appended round's own derivations once its transaction commits
   * (M15/5). Either way a handler has to be able to reach the queue it
   * is running on, and building the sender first and closing over it is
   * what breaks that circle — there is still one object, and it is the
   * one this call returns.
   */
  const queue: JobQueue = {
    async requestTextExtraction(versionId: string): Promise<void> {
      const job: TextExtractionJob = { versionId };
      // The version is the key the `short` policy collapses on, so
      // asking twice for a version nobody has started yet costs one job.
      await boss.send(JOB_QUEUES.textExtraction, job, { singletonKey: versionId });
    },
    async requestDisplayConversion(versionId: string): Promise<void> {
      const job: DisplayConversionJob = { versionId };
      await boss.send(JOB_QUEUES.displayConversion, job, { singletonKey: versionId });
    },
    async requestExecutedCopyFetch(envelopeId: string): Promise<void> {
      const job: ExecutedCopyFetchJob = { envelopeId };
      // The envelope is the collapsing key here, for the version's
      // reason: a webhook delivery and the boot sweep naming the same
      // envelope leave one job rather than two.
      await boss.send(JOB_QUEUES.executedCopyFetch, job, { singletonKey: envelopeId });
    },
    async requestNotificationEmail(notificationId: string): Promise<void> {
      const job: NotificationEmailJob = { notificationId };
      // The notification row is the collapsing key, for the version's
      // reason: the Notifier's own wake-up and the round that re-asks
      // for owed-and-unsent rows can name the same row, and they should
      // leave one job between them rather than two messages.
      await boss.send(JOB_QUEUES.notificationEmail, job, { singletonKey: notificationId });
    },
    async requestContractAnalysis(contractId: string, runId: string): Promise<boolean> {
      const job: ContractAnalysisJob = { contractId, runId };
      const jobId = await boss.send(JOB_QUEUES.contractAnalysis, job, {
        singletonKey: contractId,
      });
      // A short queue reports a waiting singleton collision with `null`.
      // The caller removes the row it made for a job the queue did not take.
      return jobId !== null;
    },
  };

  // Cut short when the process is stopping. Both scheduled sweeps
  // notice between rows, so this is what stops a run that began at
  // 04:00 from holding a container's shutdown open while it walks the
  // rest of the library — and what stops a reconciliation round from
  // holding it open on somebody else's network. What neither reached is
  // still owed, because the rows are the record, and the next tick
  // reaches it.
  const sweeping = new AbortController();

  // Everything from here holds a connection pool, so a failure part way
  // through has to put it back. A boot that raised past this and left
  // pg-boss connected would leak the pool into a process that is about
  // to report it could not start.
  try {
    await boss.start();
    // `short` is what makes a repeated request collapse: the policy puts
    // a unique index on (queue, singleton key) over jobs that are still
    // waiting, so an upload and the M12/6 sweep naming the same version
    // leave one job rather than two. A version whose job is already
    // running is not covered by it, and that is right — the handler is
    // idempotent, and refusing there would lose a request that arrived
    // because something changed.
    await boss.createQueue(JOB_QUEUES.textExtraction, {
      policy: "short",
      notify: true,
      ...TEXT_EXTRACTION_QUEUE_OPTIONS,
    });
    // The queue may have been declared by an older version of this code.
    // Creating it again changes nothing, so the bounds are applied
    // separately — that is what carries a changed timeout or retry count
    // to an install that is upgrading.
    await boss.updateQueue(JOB_QUEUES.textExtraction, {
      notify: true,
      ...TEXT_EXTRACTION_QUEUE_OPTIONS,
    });
    await boss.createQueue(JOB_QUEUES.displayConversion, {
      policy: "short",
      notify: true,
      ...DISPLAY_CONVERSION_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.displayConversion, {
      notify: true,
      ...DISPLAY_CONVERSION_QUEUE_OPTIONS,
    });
    await boss.createQueue(JOB_QUEUES.executedCopyFetch, {
      policy: "short",
      notify: true,
      ...EXECUTED_COPY_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.executedCopyFetch, {
      notify: true,
      ...EXECUTED_COPY_QUEUE_OPTIONS,
    });
    await boss.createQueue(JOB_QUEUES.notificationEmail, {
      policy: "short",
      notify: true,
      ...NOTIFICATION_EMAIL_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.notificationEmail, {
      notify: true,
      ...NOTIFICATION_EMAIL_QUEUE_OPTIONS,
    });
    await boss.createQueue(JOB_QUEUES.contractAnalysis, {
      policy: "short",
      notify: true,
      ...CONTRACT_ANALYSIS_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.contractAnalysis, {
      notify: true,
      ...CONTRACT_ANALYSIS_QUEUE_OPTIONS,
    });
    // `singleton` allows one sweep to be running at a time. Two at once
    // would be correct — the sweep only asks, and the `short` policy
    // above collapses whatever they both asked for — but it would be two
    // walks of the same table for one walk's worth of answer. A tick
    // that lands while a sweep is still going waits for it rather than
    // joining it.
    await boss.createQueue(JOB_QUEUES.backfillSweep, {
      policy: "singleton",
      ...BACKFILL_SWEEP_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.backfillSweep, BACKFILL_SWEEP_QUEUE_OPTIONS);
    // The same singleton, for a stronger reason. The backfill sweep
    // reads its own rows, so two at once would be correct and merely
    // wasteful; this one asks a third party about every live envelope,
    // so two at once would be two sets of provider requests for one
    // set of answers.
    await boss.createQueue(JOB_QUEUES.reconciliationSweep, {
      policy: "singleton",
      ...RECONCILIATION_SWEEP_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.reconciliationSweep, RECONCILIATION_SWEEP_QUEUE_OPTIONS);
    // The same singleton, for a stronger reason again. The other two
    // rounds are idempotent asks, so two at once would be wasteful and
    // correct; this one sends a person a briefing, and NOT-003 promises
    // exactly one of those a day.
    await boss.createQueue(JOB_QUEUES.morningRound, {
      policy: "singleton",
      ...MORNING_ROUND_QUEUE_OPTIONS,
    });
    await boss.updateQueue(JOB_QUEUES.morningRound, MORNING_ROUND_QUEUE_OPTIONS);

    if (handlers) {
      /**
       * The notification seam, for the two handlers whose work the
       * record's people are owed a word about (NOT-002 group 2): the
       * executed-copy fetch files paper, and the reconciliation round
       * ends envelopes.
       *
       * It is built **here**, from the same `queue` the handlers send
       * on, rather than being passed in beside them. That is what
       * breaks the circle the sending half above breaks for its own
       * callers: the notifier needs a `JobQueue` to wake email work
       * with, and the only queue this process has is the one being
       * assembled. The API builds its own the same way — from the
       * pipeline it has already started — so the two processes hold the
       * same seam over the same queue.
       */
      const notifier = createNotifier({ db: handlers.db, jobs: queue, log });
      const onTextReady = (versionId: string) =>
        requestAutomaticContractAnalysis(
          {
            db: handlers.db,
            jobs: queue,
            resolveAiProvider: handlers.resolveAiProvider,
            log,
          },
          versionId,
        );

      // One at a time, with the job's own counters. The counters are
      // what let a handler tell "try again" from "this was the last
      // try", which is the difference between a derivation that is still
      // coming and one that is marked failed.
      //
      // One at a time is also what keeps the queue's expiry honest: a
      // job is active from the moment it is fetched, so a batch of two
      // would run the second one's fifteen-minute clock while the first
      // one's conversion was still going.
      //
      // A backlog is drained rather than polled through. While more than
      // one job is ready — which is what M12/6's sweep leaves behind on
      // an upgrading install — the worker fetches again the moment it
      // finishes rather than waiting for the next poll. A queue with one
      // job at a time, which is the ordinary upload, is untouched by it.
      //
      // And the poll underneath is a few seconds rather than pg-boss's
      // half a minute. It drops its backstop that far once a queue is
      // woken by notification, on the reasoning that the notification is
      // what delivers the job. That is too far apart to be the
      // correctness floor this pipeline leans on: notifications sent
      // while a worker is busy coalesce, so a second request arriving
      // during a job would wait half a minute for a poll — and the burst
      // above only engages once the backlog shows in pg-boss's own
      // cached statistics, which lag by up to a minute. Two seconds
      // costs one small query per queue while there is nothing to do.
      const oneAtATime = {
        batchSize: 1,
        includeMetadata: true,
        burstWhenReadyExceeds: 1,
        notifyPollingIntervalSeconds: 2,
      } as const;
      await boss.work(
        JOB_QUEUES.textExtraction,
        oneAtATime,
        async (jobs: JobWithMetadata<TextExtractionJob>[]) => {
          for (const job of jobs) {
            await handleTextExtraction(
              handlers,
              {
                versionId: job.data.versionId,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              },
              onTextReady,
            );
          }
        },
      );
      await boss.work(
        JOB_QUEUES.displayConversion,
        oneAtATime,
        async (jobs: JobWithMetadata<DisplayConversionJob>[]) => {
          for (const job of jobs) {
            await handleDisplayConversion(
              handlers,
              {
                versionId: job.data.versionId,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              },
              onTextReady,
            );
          }
        },
      );
      await boss.work(
        JOB_QUEUES.executedCopyFetch,
        oneAtATime,
        async (jobs: JobWithMetadata<ExecutedCopyFetchJob>[]) => {
          for (const job of jobs) {
            await handleExecutedCopyFetch(
              {
                ...handlers,
                jobs: queue,
                notifier,
                onExecutedVersionPinned: onTextReady,
              },
              {
                envelopeId: job.data.envelopeId,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              },
            );
          }
        },
      );
      await boss.work(
        JOB_QUEUES.notificationEmail,
        oneAtATime,
        async (jobs: JobWithMetadata<NotificationEmailJob>[]) => {
          for (const job of jobs) {
            await handleNotificationEmail(
              {
                db: handlers.db,
                resolveMailer: handlers.resolveMailer,
                baseUrl: handlers.baseUrl,
                log,
              },
              {
                notificationId: job.data.notificationId,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              },
            );
          }
        },
      );
      await boss.work(
        JOB_QUEUES.contractAnalysis,
        oneAtATime,
        async (jobs: JobWithMetadata<ContractAnalysisJob>[]) => {
          for (const job of jobs) {
            await handleContractAnalysis(
              { db: handlers.db, resolveAiProvider: handlers.resolveAiProvider, log },
              {
                runId: job.data.runId,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              },
            );
          }
        },
      );
      // The sweep gets its own worker rather than sharing the derivation
      // ones, so an hour-long walk of a large library cannot sit in front
      // of the OCR somebody is waiting on. It takes no metadata and no
      // burst: there is only ever one of it.
      await boss.work(JOB_QUEUES.backfillSweep, { batchSize: 1 }, async () => {
        const summary = await runBackfillSweep({ db: handlers.db, log }, queue, {
          signal: sweeping.signal,
        });
        log.info({ ...summary }, "the scheduled backfill sweep finished");
      });
      // The reconciliation sweep gets its own worker for the backfill
      // sweep's reason and one of its own: a round spends its time
      // waiting on somebody else's network, and a provider that is slow
      // must not sit in front of the executed copy a person is waiting
      // on. It takes the signing resolver, which is what makes it a
      // handler here rather than a timer in the worker entrypoint.
      await boss.work(JOB_QUEUES.reconciliationSweep, { batchSize: 1 }, async () => {
        const summary = await runReconciliationSweep(
          {
            db: handlers.db,
            log,
            resolveSigningProvider: handlers.resolveSigningProvider,
            notifier,
          },
          queue,
          { signal: sweeping.signal },
        );
        log.info({ ...summary }, "the scheduled reconciliation sweep finished");
      });
      // The morning round gets its own worker for the two sweeps'
      // reason: it spends its time on the relay's network, and a slow
      // relay must not sit in front of the executed copy or the
      // reconciliation round. It takes the notification seam and the
      // mailer resolver, which is what makes it a handler here rather
      // than a timer in the worker entrypoint.
      await boss.work(JOB_QUEUES.morningRound, { batchSize: 1 }, async () => {
        const summary = await runMorningRound(
          {
            db: handlers.db,
            log,
            notifier,
            resolveMailer: handlers.resolveMailer,
            baseUrl: handlers.baseUrl,
          },
          queue,
          { signal: sweeping.signal },
        );
        log.info({ ...summary }, "the scheduled morning round finished");
      });
      // Registering the schedule is an upsert keyed on the queue name, so
      // every worker that boots declares the same one and an install
      // running two of them still sweeps once — pg-boss elects a single
      // cron worker and creates one job per tick.
      await boss.schedule(JOB_QUEUES.backfillSweep, BACKFILL_SWEEP_CRON);
      // The same upsert, and the reason #277 moved this sweep here: an
      // in-process timer ran a full round per replica, and this round
      // asks a third party about every live envelope.
      await boss.schedule(JOB_QUEUES.reconciliationSweep, RECONCILIATION_SWEEP_CRON);
      // The same upsert, and the reason it is here at all: one round per
      // install, however many workers boot (NOT-003's one briefing a
      // day).
      await boss.schedule(JOB_QUEUES.morningRound, MORNING_ROUND_CRON);
      log.info(
        {
          queues: [
            JOB_QUEUES.textExtraction,
            JOB_QUEUES.displayConversion,
            JOB_QUEUES.executedCopyFetch,
            JOB_QUEUES.notificationEmail,
            JOB_QUEUES.backfillSweep,
            JOB_QUEUES.reconciliationSweep,
            JOB_QUEUES.morningRound,
            JOB_QUEUES.contractAnalysis,
          ],
          backfillSweepCron: BACKFILL_SWEEP_CRON,
          reconciliationSweepCron: RECONCILIATION_SWEEP_CRON,
          morningRoundCron: MORNING_ROUND_CRON,
        },
        "working the job queue",
      );
    }
  } catch (error) {
    // The original failure is what the operator needs; a tidy-up that
    // fails on the way out must not replace it.
    await boss.stop({ graceful: false }).catch(() => {});
    throw error;
  }

  return {
    ...queue,
    stop: async () => {
      // The sweep first, so that a graceful stop is not held open by a
      // walk of the library. It is only asking, so there is nothing to
      // lose by cutting it short.
      sweeping.abort();
      // Graceful by default: it stops taking work, waits for the jobs
      // already in hand, and then closes its connections. A job that
      // never started is still in the queue for the next process.
      await boss.stop();
    },
  };
}
