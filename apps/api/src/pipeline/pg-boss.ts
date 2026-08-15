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
import type { DerivationDeps } from "./derivations.js";
import { handleDisplayConversion } from "./display-conversion.js";
import {
  JOB_QUEUES,
  type DisplayConversionJob,
  type JobQueue,
  type TextExtractionJob,
} from "./jobs.js";
import { createConsoleLogger, type PipelineLogger } from "./logger.js";
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
  handlers?: DerivationDeps;
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
    // Nothing here runs on a clock yet. Reminders and digests (NOT-003,
    // ENT-006) turn this on with the milestone that needs it.
    schedule: false,
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

    if (handlers) {
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
            await handleTextExtraction(handlers, {
              versionId: job.data.versionId,
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
            });
          }
        },
      );
      await boss.work(
        JOB_QUEUES.displayConversion,
        oneAtATime,
        async (jobs: JobWithMetadata<DisplayConversionJob>[]) => {
          for (const job of jobs) {
            await handleDisplayConversion(handlers, {
              versionId: job.data.versionId,
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
            });
          }
        },
      );
      log.info(
        { queues: [JOB_QUEUES.textExtraction, JOB_QUEUES.displayConversion] },
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
    stop: async () => {
      // Graceful by default: it stops taking work, waits for the jobs
      // already in hand, and then closes its connections. A job that
      // never started is still in the queue for the next process.
      await boss.stop();
    },
  };
}
