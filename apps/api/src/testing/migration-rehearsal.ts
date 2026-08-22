// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rehearsing an upgrade against a real database.
 *
 * Every other suite starts from a migrated empty database, so a
 * migration that fixes up rows — a backfill, a de-duplication, a guard
 * that refuses — never runs on a row in any of them. The only way to
 * assert one is to put an install into the state a real one is in
 * *before* the migration, and then upgrade it.
 *
 * These are the three moves that takes: a database of its own per
 * scenario, migrations applied only as far as a past release had them,
 * and the message the database gave when it refused. They live here
 * rather than in one suite because two suites now need them
 * (`account-issuer-migration.test.ts` was the first, #340).
 *
 * This is in apps/api for the reason `migration-journal.test.ts` gives:
 * this is where the Postgres harness is, and packages/db has no test
 * runner.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  readMigrationJournal,
  runMigrations,
  sql,
  type Db,
  type JournalEntry,
} from "@openlaw/db";

export const MIGRATIONS = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

export function migrationEntries(): JournalEntry[] {
  return readMigrationJournal(MIGRATIONS);
}

export async function freshDb(container: StartedPostgreSqlContainer, name: string): Promise<Db> {
  const admin = createDb(container.getConnectionUri());
  await admin.execute(sql.raw(`create database "${name}"`));
  await admin.$client.end();
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  return createDb(url.toString());
}

/**
 * Applies migrations up to and including `tag`, the way a past release
 * did.
 *
 * The tag is checked before anything runs. A tag the journal does not
 * hold — a typo, or a file renamed since the suite was written — would
 * otherwise walk the whole journal and hand back a **fully** migrated
 * database, and every rehearsal built on it would pass while testing
 * nothing: the migration under test would already have run before the
 * suite wrote its first row.
 */
export async function migrateThrough(db: Db, tag: string, entries: JournalEntry[]): Promise<void> {
  if (!entries.some((entry) => entry.tag === tag)) {
    throw new Error(
      `No migration is tagged ${tag}. A rehearsal that starts from a tag the journal ` +
        "does not hold would migrate the whole way and assert nothing.",
    );
  }
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key, hash text not null, created_at bigint)`);
  for (const entry of entries) {
    // One statement per round trip rather than one joined string: a
    // multi-statement query runs in an implicit transaction, and 0054's
    // `CREATE INDEX CONCURRENTLY` cannot.
    const statements = readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await db.execute(sql.raw(statement));
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${entry.hash}, ${entry.when})`,
    );
    if (entry.tag === tag) return;
  }
}

/**
 * What the database said when the migration refused.
 *
 * Drizzle's own message is the SQL it sent, which quotes the `RAISE`
 * text verbatim — asserting on that would pass whether or not the
 * statement ever ran. The substituted message is on the cause, and it is
 * the only place the offending rows are actually named.
 */
export async function refusal(db: Db): Promise<string> {
  try {
    await runMigrations(db);
  } catch (error) {
    return String((error as { cause?: unknown }).cause ?? error);
  }
  throw new Error("the migration was expected to refuse this install, and did not");
}
