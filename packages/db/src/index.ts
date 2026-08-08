// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw database package (TECH-004 Postgres, TECH-006 Drizzle).
 * Everything connects through a DATABASE_URL; migrations are the only
 * schema channel (TECH-005: run on container start).
 */

import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as authSchema from "./schema/auth.js";
import * as orgSchema from "./schema/org.js";

export * from "./schema/auth.js";
export * from "./schema/org.js";
export const schema = { ...authSchema, ...orgSchema };

// Query operators re-exported so consumers use this package's drizzle-orm
// instance — a second copy (peer-variant split) makes SQL types incompatible.
export { and, asc, count, desc, eq, inArray, isNull, lt, gt, ne, or, sql } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}

/**
 * Advisory-lock keys for cross-process critical sections. Postgres
 * namespaces these per database; the numbers only need to be distinct.
 */
export const ADVISORY_LOCK = {
  /** Held while migrations run, so replicas booting together serialize. */
  migrations: 4101001,
  /** Held across the first-run setup check-and-create (TECH-008). */
  firstRunSetup: 4101002,
} as const;

/**
 * Runs `fn` while holding a session-level Postgres advisory lock, so the
 * critical section serializes across every process pointed at this
 * database — not just across requests in one Node instance. The lock is
 * taken on its own pooled connection because `fn` needs the pool for its
 * own queries, and it is always released, including when `fn` throws.
 *
 * This waits for the lock, parking a pooled connection while it does, so
 * it belongs in bounded, boot-shaped work. Anything a client can trigger
 * should use `tryWithAdvisoryLock` instead — waiters there would let one
 * slow critical section drain the pool.
 */
export async function withAdvisoryLock<T>(db: Db, key: number, fn: () => Promise<T>): Promise<T> {
  const holder = await db.$client.connect();
  try {
    await holder.query("select pg_advisory_lock($1)", [key]);
    try {
      return await fn();
    } finally {
      await holder.query("select pg_advisory_unlock($1)", [key]);
    }
  } finally {
    holder.release();
  }
}

/**
 * `withAdvisoryLock` that never waits: if another process holds the lock,
 * it reports `acquired: false` immediately instead of queueing. Callers
 * decide what losing means — for a once-ever operation, losing the lock
 * and finding the work already done are the same answer.
 */
export async function tryWithAdvisoryLock<T>(
  db: Db,
  key: number,
  fn: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const holder = await db.$client.connect();
  try {
    const locked = await holder.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock($1) as acquired",
      [key],
    );
    if (!locked.rows[0]?.acquired) return { acquired: false };
    try {
      return { acquired: true, result: await fn() };
    } finally {
      await holder.query("select pg_advisory_unlock($1)", [key]);
    }
  } finally {
    holder.release();
  }
}

/** Applies committed drizzle-kit migrations. Called on API boot (TECH-005). */
export async function runMigrations(db: Db): Promise<void> {
  await withAdvisoryLock(db, ADVISORY_LOCK.migrations, () =>
    migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    }),
  );
}
