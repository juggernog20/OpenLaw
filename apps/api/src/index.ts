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
import { createSmtpMailer, createUnconfiguredMailer } from "./lib/mailer.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const db = createDb(requireEnv("DATABASE_URL"));
await runMigrations(db);

// TECH-011: SMTP is the universal default; the SET-004 wizard surface for
// configuring it ships later, so env vars carry it until then.
const mailer =
  process.env.SMTP_URL && process.env.SMTP_FROM
    ? createSmtpMailer(process.env.SMTP_URL, process.env.SMTP_FROM)
    : createUnconfiguredMailer();

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
    mailer,
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
