// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw background worker (TECH-007: pg-boss on Postgres).
 * Placeholder entry — job handlers (OCR, conversion, AI analysis, search
 * indexing, notification digests, reminders) arrive with their modules.
 */

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set; worker cannot start.");
  process.exit(1);
}

console.log("OpenLaw worker placeholder — pg-boss wiring arrives with the schema step.");
