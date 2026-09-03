// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw API server entry — wires real dependencies (DATABASE_URL,
 * auth secret), runs migrations (TECH-005: migrate on container start),
 * builds the app (see app.ts), and listens.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDb,
  MigrationJournalError,
  readSecretKeys,
  rewrapSecrets,
  runMigrations,
  useSecretKeys,
  PREVIOUS_SECRET_KEY_VARIABLE,
} from "@openlaw/db";
import { buildApp } from "./app.js";
import { createMailerResolver } from "./lib/mailer.js";
import { createDocEngineFromEnv } from "./lib/doc-engine/config.js";
import { createStorageFromEnv } from "./lib/storage/config.js";
import {
  createDocuSignDriverFactory,
  readDocuSignBaseUrl,
  SIGNING_STANDIN_VARIABLE,
} from "./lib/signing/config.js";
import { createNotifier } from "./lib/notifications/notifier.js";
import { createPostgresEventHub } from "./lib/event-hub.js";
import { createConsoleLogger } from "./pipeline/logger.js";
import { createSigningResolver } from "./lib/signing/resolver.js";
import { createAiResolver } from "./lib/ai/resolver.js";
import { maxUploadBytes } from "./lib/uploads.js";
import { startPipeline } from "./pipeline/pg-boss.js";

/** A per-column count, as one readable clause. */
function summarize(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([column, rows]) => `${column} (${rows})`)
    .join(", ");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");

// TECH-022: the credential columns are sealed with a key that lives
// outside the database, so a database backup on its own opens nothing.
// Read here, before the first query, for the storage root's reason —
// startup reads the environment and no module below does — and the boot
// stops without it: an install that started with no key would write
// credentials nobody could read back.
useSecretKeys(
  (function readKeys() {
    try {
      return readSecretKeys(process.env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  })(),
);

const db = createDb(databaseUrl);
// The message is the point (#330). A migration fault used to surface as
// an unhandled rejection and a raw stack, unlike every other boot step
// here — and the fault this most often carries now is the journal guard
// refusing to start, whose whole value is that an operator can read it.
// Only the guard's own refusals get that treatment: any other failure —
// a migration's SQL failing against this database, say — keeps its stack
// and driver detail, which the crafted message deliberately omits.
try {
  await runMigrations(db);
} catch (error) {
  console.error(error instanceof MigrationJournalError ? error.message : error);
  process.exit(1);
}

// Beside the migrations, and for their reason (TECH-005: the API is the
// one process that changes the database on a deploy). This is what makes
// an upgrade from a plaintext-storing version, and a key rotation, take
// no manual re-entry — see rewrap.ts in @openlaw/db.
//
// Two lines rather than one, because they are two different pieces of
// news: resealing is routine, and an unreadable credential is something
// the operator has to act on. Reporting both in one sentence would put
// the instruction in front of every operator it does not apply to.
const rewrap = await rewrapSecrets(db);
if (Object.keys(rewrap.resealed).length > 0) {
  console.log(`Stored credentials resealed under the key in use: ${summarize(rewrap.resealed)}.`);
}
if (Object.keys(rewrap.unreadable).length > 0) {
  console.warn(
    `No configured key opens these stored credentials: ${summarize(rewrap.unreadable)}. ` +
      "They are left as they are, so they are still recoverable: boot once with the old key " +
      `in ${PREVIOUS_SECRET_KEY_VARIABLE}, or paste the credentials again in Settings.`,
  );
}

// TECH-011: SMTP is the universal default, carried by env vars or saved
// through the SET-004 wizard's email step (#37). Environment wins: with
// SMTP_URL set the instance is env-pinned and database values are ignored
// entirely. Under Compose the variables always exist (empty when unset in
// .env); empty is falsy, so empty means "not configured" here too.
const resolveMailer = createMailerResolver(db, {
  url: process.env.SMTP_URL,
  from: process.env.SMTP_FROM,
});

// DOC-009/TECH-014: the storage drivers are chosen here, at startup, and
// the adapter is injected — no module below ever reads the environment
// for it, or knows which driver it got. The local filesystem driver is
// the default; STORAGE_DRIVER points writes at an object store (`s3` or
// `azure-blob`), and reads route across every configured driver by the
// reference's prefix (DOC-014), so history survives a driver switch.
// A configuration fault stops the boot rather than silently falling back
// to a local disk nobody would think to look at.
const storage = (function readStorage() {
  try {
    return createStorageFromEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();

// TECH-010: the doc engine is chosen here too, and injected. Nothing is
// contacted at startup — building the client only parses its URL — so a
// sidecar that is still coming up does not hold the API's boot. A
// malformed DOC_ENGINE_URL is a configuration fault and stops the boot,
// for the storage driver's reason: an install told to reach the engine
// somewhere specific must not quietly call somewhere else.
const docEngine = (function readDocEngine() {
  try {
    return createDocEngineFromEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();

// CTR-013: the signing connector is org data, not environment, so the
// app is injected with a resolver that reads the stored row live rather
// than with a provider built at boot. An install with no connector
// resolves to nothing, the send affordance is absent, and the manual
// hand-off keeps working with zero configuration.
//
// Where those credentials are presented is a different question, and
// it is read here for the storage root's reason: startup reads the
// environment, and no module below does. Every real install leaves it
// unset and reaches DocuSign's own estate; the dev/E2E overlay points
// it at a stand-in on the host, so a test send can never reach a real
// account (TECH-018).
const docusignBaseUrl = (function readSigningHost() {
  try {
    return readDocuSignBaseUrl(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
if (docusignBaseUrl) {
  console.warn(
    `Signing is pointed at ${docusignBaseUrl} instead of DocuSign (DOCUSIGN_BASE_URL + ${SIGNING_STANDIN_VARIABLE}). This belongs to the dev/E2E overlay only — never run a real deployment this way.`,
  );
}
const resolveSigningProvider = createSigningResolver(
  db,
  createDocuSignDriverFactory(docusignBaseUrl),
);
// The AI connector is also Organization data. The resolver reads its
// singleton row live, and the provider adapter follows the stored protocol.
const resolveAiProvider = createAiResolver(db);

// The upload ceiling, in whole mebibytes, read here for the storage
// root's reason: startup reads the environment, and no module does. An
// unreadable value falls back to the default rather than refusing to
// boot (see maxUploadBytes).
const uploadCeiling = maxUploadBytes(process.env.MAX_UPLOAD_MB);

// BASE_URL anchors emailed links (set-password, magic links) and origin
// checks. The localhost default exists for development; a production
// deploy without it would email links nobody outside the host can open.
if (process.env.AUTH_RATE_LIMIT === "off") {
  console.warn(
    "Auth rate limiting is DISABLED (AUTH_RATE_LIMIT=off). This belongs to the dev/E2E overlay only — never run a real deployment this way.",
  );
}

// The E2E gate's one seam (TECH-018): the morning round is a cron on
// the hour, and a browser suite driving the built images has no way to
// reach a scheduled handler and no hour to wait for the next tick. Read
// here for the storage root's reason — startup reads the environment,
// and no module below does — and warned about for AUTH_RATE_LIMIT's:
// the image always runs NODE_ENV=production, so the variable is the only
// signal and this line is the guard rail.
const morningRoundTrigger = process.env.MORNING_ROUND_TRIGGER === "on";
if (morningRoundTrigger) {
  console.warn(
    "The morning round can be triggered over HTTP (MORNING_ROUND_TRIGGER=on). This belongs to the dev/E2E overlay only — never run a real deployment this way.",
  );
}

if (!process.env.BASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "BASE_URL is not set; emailed links and OIDC callbacks will point at http://localhost:3000.",
  );
}

// TECH-017: serve the built SPA same-origin when it exists — true in the
// container image and after a local `pnpm build`. Absent (API-only dev,
// where Vite serves the SPA and proxies /api) every non-API path 404s.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webDistPresent = existsSync(join(webDist, "index.html"));

// TECH-007: the queue lives on the database this process already has,
// so there is nothing extra to configure or run. This process only
// sends — a derivation is asked for after an upload commits and is run
// by the worker container — so it registers no handlers and leaves the
// queue's upkeep to the process that works it.
const jobs = await startPipeline({ connectionString: databaseUrl });

// The notification seam (NOT-001), built here for the reason the queue
// is: it is composed from two things this process already holds, and no
// route may reach past it to either of them.
// Its own lines go where the pipeline's do — one structured line per
// event on stdout — rather than to a bare `console.error`. The Fastify
// logger does not exist yet at this point (the app is built from this
// value), and a sink assigned afterwards would be a second thing to
// keep in step with it.
const notifier = createNotifier({ db, jobs, log: createConsoleLogger() });
const eventHub = createPostgresEventHub({ db, log: createConsoleLogger() });

const app = await buildApp(
  {
    db,
    config: {
      secret: requireEnv("AUTH_SECRET"),
      // `||`, not `??`: under Compose the variable always exists (empty
      // when unset in .env), and empty means "not configured".
      baseUrl: process.env.BASE_URL || "http://localhost:3000",
      // Set by the dev overlay only (TECH-018): the E2E suite would trip
      // sign-in rate limits that exist to slow humans down. The image
      // always runs NODE_ENV=production — fidelity is the point — so the
      // env var is the only signal; the warning below is the guard rail.
      disableRateLimit: process.env.AUTH_RATE_LIMIT === "off",
    },
    resolveMailer,
    storage,
    docEngine,
    jobs,
    resolveSigningProvider,
    resolveAiProvider,
    notifier,
    eventHub,
    maxUploadBytes: uploadCeiling,
    morningRoundTrigger,
    webDist: webDistPresent ? webDist : undefined,
  },
  { logger: true },
);

if (!webDistPresent) {
  app.log.info(`no web bundle at ${webDist}; serving the API only`);
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
