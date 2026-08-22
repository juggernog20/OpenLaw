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
 * envelope's PDF back onto the record (M15/5, CTR-014), the two boot
 * sweeps that recover work whose queue send was lost (M12/6), and two
 * scheduled sweeps that pg-boss holds the clock for — the nightly
 * backfill (M12/6) and the reconciliation round that asks the signing
 * provider where every live envelope stands (M15/6, CTR-013), the
 * fallback feed that makes an install DocuSign cannot reach converge
 * anyway. AI analysis, search indexing, notification digests, and
 * reminders each arrive with their own milestone and register beside
 * them.
 *
 * **What is at boot and what is on the schedule is not a style choice.**
 * A boot sweep recovers work the rows already say is owed, so a second
 * replica runs it, finds nothing, and costs one walk of a table we own.
 * A scheduled sweep repeats, and the reconciliation one asks a third
 * party every round — so a second replica would double the requests
 * against the endpoint DocuSign rate-limits hardest. Anything that
 * repeats belongs on pg-boss's clock, where the election gives an
 * install one round however many workers it runs (#277).
 *
 * It runs no migrations. The API is the one process that migrates
 * (TECH-005), and a worker that migrated too would race it on every
 * deploy. A worker started against a database the API has not reached
 * yet finds no work and waits, which is the right answer.
 */

import { createDb, readSecretKeys, useSecretKeys } from "@openlaw/db";
import {
  createConsoleLogger,
  createDocEngineFromEnv,
  createDocuSignDriverFactory,
  createMailerResolver,
  createSigningResolver,
  createStorageFromEnv,
  maxUploadBytes,
  readDocuSignBaseUrl,
  runBackfillSweep,
  runExecutedCopySweep,
  SIGNING_STANDIN_VARIABLE,
  startPipeline,
} from "@openlaw/api/pipeline";

const log = createConsoleLogger();

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

// TECH-022: the worker reads the same sealed credential columns the API
// does — the signing connector on every reconciliation round, the SMTP
// relay on every mail a job sends — so it needs the same key, and it
// refuses to boot without it for the same reason. It does not reseal:
// the API owns the boot pass, exactly as it owns the migrations.
useSecretKeys(orExit(() => readSecretKeys(process.env)));

const db = createDb(databaseUrl);
const storage = orExit(() => createStorageFromEnv(process.env));
const docEngine = orExit(() => createDocEngineFromEnv(process.env));
// The same ceiling the API enforces on an upload, read from the same
// variable. The executed copy arrives from a third party rather than
// from a person, and a file the API would have refused at the door must
// not reach the store through the back one. An unreadable value falls
// back to the default here exactly as it does there.
const uploadCeiling = maxUploadBytes(process.env.MAX_UPLOAD_MB);
// The signing connector is org data, not deployment environment
// (CTR-013), so there are no credentials to read from `process.env`: an
// install with no connector row resolves to nothing, and an
// executed-copy job records that plainly. Where those credentials are
// presented is read from the environment, exactly as the API reads it —
// unset on every real install, and pointed at a stand-in by the dev/E2E
// overlay so a test send can never reach a real account (TECH-018).
//
// The same call the API makes, which is what makes the two agree: it
// enforces the pairing of the address with SIGNING_STANDIN, so a stack
// that moved one process off DocuSign and not the other refuses to boot
// rather than sending to the stand-in and fetching from DocuSign.
const docusignBaseUrl = orExit(() => readDocuSignBaseUrl(process.env));
if (docusignBaseUrl) {
  log.warn(
    { baseUrl: docusignBaseUrl, declaredBy: SIGNING_STANDIN_VARIABLE },
    "signing is pointed at a stand-in instead of DocuSign (DOCUSIGN_BASE_URL) — the dev/E2E overlay only",
  );
}
const resolveSigningProvider = createSigningResolver(
  db,
  createDocuSignDriverFactory(docusignBaseUrl),
);

// A database that cannot be reached is fatal here, as it is in the API.
// Caught rather than left to the runtime so the operator reads one line
// saying what failed, not a stack trace from inside pg-boss.
// Mail, resolved per send exactly as the API resolves it (TECH-011,
// #37): the environment wins, and an install that saved a relay in the
// wizard has it read live on the next send. The notification email
// (M18/1) is the first job that sends anything, and it is why this
// process needs a mailer at all.
const resolveMailer = createMailerResolver(db, {
  url: process.env.SMTP_URL,
  from: process.env.SMTP_FROM,
});
// Where this install answers, so an emailed notification deep-links to
// the record it is about (NOT-005). The same variable and the same
// fallback the API reads, because a worker that linked somewhere else
// would send mail nobody could act on.
const baseUrl = process.env.BASE_URL || "http://localhost:3000";

// The API warns about this too, and until M18 that was enough: the app
// was the only process that sent mail. It is not any more — every
// notification email and every morning digest is rendered here — so an
// operator who set BASE_URL on the app alone would get briefings whose
// every link points at localhost, with nothing anywhere saying why.
if (!process.env.BASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "BASE_URL is not set; links in notification emails and the morning digest will point at http://localhost:3000.",
  );
}

const pipeline = await startPipeline({
  connectionString: databaseUrl,
  handlers: {
    db,
    storage,
    docEngine,
    resolveSigningProvider,
    resolveMailer,
    baseUrl,
    log,
    maxUploadBytes: uploadCeiling,
  },
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

// The sweeps. They run after the handlers are registered, so the worker
// is already taking jobs while they walk their tables — an install with
// a large back catalogue must not wait for a sweep before its next
// upload is derived.
//
// They are started rather than awaited, and none raises: a sweep is best
// effort, and a worker that refused to run because it could not finish
// one would be a worse answer than a boot that tries again. What they
// missed is still owed, because the rows are the record.
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
// The fallback status feed (M15/6) is not started here. It repeats
// rather than running once — the two sweeps above recover work the rows
// already say is owed, while that one waits for somebody to sign — and
// a repeating in-process timer ran a full round per replica, against
// the endpoint the provider rate-limits hardest. It is a scheduled
// pg-boss job instead (#277), declared by `startPipeline` above, so
// pg-boss's cron election gives an install one round however many
// workers it runs.

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
