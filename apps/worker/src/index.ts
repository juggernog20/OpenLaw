// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The OpenLaw background worker (TECH-007).
 *
 * It is the application image started with a different command, not a
 * second program. Everything it needs — the schema, the storage adapter,
 * the doc engine, the job handlers — is imported from the API package,
 * so a handler is written once and the process that runs it is a
 * deployment choice. The API sends; this works.
 *
 * What it does today is text extraction (DOC-005, M12/3), display
 * conversion (M12/4), the executed-copy fetch that files a signed
 * envelope's PDF back onto the record (M15/5, CTR-014), and the two
 * boot sweeps that recover work whose queue send was lost (M12/6). AI
 * analysis, search indexing, notification digests, and reminders each
 * arrive with their own milestone and register beside them.
 *
 * It runs no migrations. The API is the one process that migrates
 * (TECH-005), and a worker that migrated too would race it on every
 * deploy. A worker started against a database the API has not reached
 * yet finds no work and waits, which is the right answer.
 */

import { createDb } from "@openlaw/db";
import {
  createConsoleLogger,
  createDocEngineFromEnv,
  createSigningResolver,
  createStorageFromEnv,
  runBackfillSweep,
  runExecutedCopySweep,
  startPipeline,
} from "@openlaw/api/pipeline";

const log = createConsoleLogger();

/** What went wrong, in one line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log.error({ variable: name }, "missing a required environment variable");
    process.exit(1);
  }
  return value;
}

/** A configuration fault stops the boot rather than being defaulted
 * around, exactly as it does in the API: a worker told to reach the
 * engine somewhere specific must not quietly call somewhere else. */
function orExit<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    log.error({ reason: reasonOf(error) }, "the worker is misconfigured");
    process.exit(1);
  }
}

const databaseUrl = requireEnv("DATABASE_URL");
const db = createDb(databaseUrl);
const storage = orExit(() => createStorageFromEnv(process.env));
const docEngine = orExit(() => createDocEngineFromEnv(process.env));
// The signing connector is org data, not deployment environment
// (CTR-013), so there is nothing to read from `process.env` and nothing
// to fail at boot over: an install with no connector row resolves to
// nothing, and an executed-copy job records that plainly.
const resolveSigningProvider = createSigningResolver(db);

// A database that cannot be reached is fatal here, as it is in the API.
// Caught rather than left to the runtime so the operator reads one line
// saying what failed, not a stack trace from inside pg-boss.
const pipeline = await startPipeline({
  connectionString: databaseUrl,
  handlers: { db, storage, docEngine, resolveSigningProvider, log },
  log,
}).catch((error: unknown) => {
  log.error({ reason: reasonOf(error) }, "the worker could not start the job queue");
  process.exit(1);
});

log.info({}, "OpenLaw worker started");

/** How long a shutdown waits for the sweep to notice it was stopped. */
const SWEEP_SHUTDOWN_GRACE_MS = 5_000;

/** Waits, without holding the event loop open on its own. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

// The two boot sweeps. They run after the handlers are registered, so
// the worker is already taking jobs while they walk their tables — an
// install with a large back catalogue must not wait for a sweep before
// its next upload is derived.
//
// They are started rather than awaited, and neither raises: a sweep is
// best effort, and a worker that refused to run because it could not
// finish one would be a worse answer than a boot that tries again. What
// they missed is still owed, because the rows are the record.
const sweeping = new AbortController();
const swept = Promise.all([
  runBackfillSweep({ db, log }, pipeline, { signal: sweeping.signal }).then(
    (summary) => {
      log.info({ ...summary }, "the backfill sweep finished");
    },
    (error: unknown) => {
      log.error({ reason: reasonOf(error) }, "the backfill sweep did not finish");
    },
  ),
  // The same recovery for the executed copies (M15/5). A signed
  // envelope whose copy is still owed is a job that was lost between
  // the transition's commit and the queue send, and the row is what
  // still says so. It runs beside the backfill rather than after it:
  // neither derives anything, both only ask, and the executed copy is
  // the one a person is waiting on.
  runExecutedCopySweep({ db, log }, pipeline, { signal: sweeping.signal }).then(
    (summary) => {
      log.info({ ...summary }, "the executed-copy sweep finished");
    },
    (error: unknown) => {
      log.error({ reason: reasonOf(error) }, "the executed-copy sweep did not finish");
    },
  ),
]);

// A container is stopped by a signal, and a job in hand must not be
// lost to it. Stopping waits for what is running and leaves what has
// not started in the queue, so the next worker picks it up.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "stopping the OpenLaw worker");
    void (async () => {
      try {
        // The sweep first, and waited for: it is only asking, so there
        // is nothing to lose by cutting it short, and a query still in
        // flight when the pool closes would report a failure that is
        // really just the shutdown. The next boot sweeps again.
        //
        // The wait is bounded, because the sweep notices the abort
        // between versions and not inside one. A page query or a queue
        // send that has already gone out must not be what holds the
        // container past its grace period, so after a few seconds the
        // shutdown carries on without it.
        sweeping.abort();
        await Promise.race([swept, delay(SWEEP_SHUTDOWN_GRACE_MS)]);
        await pipeline.stop();
      } catch (error) {
        log.error({ reason: reasonOf(error) }, "the worker did not stop cleanly");
        process.exitCode = 1;
      } finally {
        // Closed even when the drain above failed. An open pool keeps
        // the event loop alive, so a worker that skipped this would
        // hang until the grace period kills it — and the exit code the
        // failure just set would be lost with it.
        await db.$client.end().catch((error: unknown) => {
          log.error({ reason: reasonOf(error) }, "the worker did not close its database pool");
          process.exitCode = 1;
        });
      }
    })();
  });
}
