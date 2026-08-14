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
 * What it does today is text extraction (DOC-005, M12/3). Display
 * conversion (M12/4), the upgrade backfill sweep (M12/6), AI analysis,
 * search indexing, notification digests, and reminders each arrive with
 * their own milestone and register beside it.
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
  createStorageFromEnv,
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

// A database that cannot be reached is fatal here, as it is in the API.
// Caught rather than left to the runtime so the operator reads one line
// saying what failed, not a stack trace from inside pg-boss.
const pipeline = await startPipeline({
  connectionString: databaseUrl,
  handlers: { db, storage, docEngine, log },
  log,
}).catch((error: unknown) => {
  log.error({ reason: reasonOf(error) }, "the worker could not start the job queue");
  process.exit(1);
});

log.info({}, "OpenLaw worker started");

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
