// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw API server entry — wires real dependencies (DATABASE_URL,
 * auth secret), runs migrations (TECH-005: migrate on container start),
 * builds the app (see app.ts), and listens.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, runMigrations } from "@openlaw/db";
import { buildApp } from "./app.js";
import { createMailerResolver } from "./lib/mailer.js";
import { createDocEngineFromEnv } from "./lib/doc-engine/config.js";
import { createStorageFromEnv } from "./lib/storage/config.js";
import { createSigningResolver } from "./lib/signing/resolver.js";
import { maxUploadBytes } from "./lib/uploads.js";
import { startPipeline } from "./pipeline/pg-boss.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");
const db = createDb(databaseUrl);
await runMigrations(db);

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
const resolveSigningProvider = createSigningResolver(db);

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
    maxUploadBytes: uploadCeiling,
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
