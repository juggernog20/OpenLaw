// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw API server entry — wires real dependencies (DATABASE_URL,
 * auth secret), runs migrations (TECH-005: migrate on container start),
 * builds the app (see app.ts), and listens.
 */

import { createDb, runMigrations } from "@openlaw/db";
import { buildApp } from "./app.js";

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

const app = await buildApp(
  {
    db,
    config: {
      secret: requireEnv("AUTH_SECRET"),
      baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
    },
  },
  { logger: true },
);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
