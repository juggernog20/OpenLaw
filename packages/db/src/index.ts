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
import * as activitySchema from "./schema/activity.js";
import * as authSchema from "./schema/auth.js";
import * as contractStatusesSchema from "./schema/contract-statuses.js";
import * as contractTypesSchema from "./schema/contract-types.js";
import * as fieldsSchema from "./schema/fields.js";
import * as orgSchema from "./schema/org.js";

export * from "./schema/activity.js";
export * from "./schema/auth.js";
export * from "./schema/contract-statuses.js";
export * from "./schema/contract-types.js";
export * from "./schema/fields.js";
export * from "./schema/org.js";
export const schema = {
  ...activitySchema,
  ...authSchema,
  ...contractStatusesSchema,
  ...contractTypesSchema,
  ...fieldsSchema,
  ...orgSchema,
};

// Query operators re-exported so consumers use this package's drizzle-orm
// instance — a second copy (peer-variant split) makes SQL types incompatible.
export { and, asc, count, desc, eq, inArray, isNull, lt, gt, ne, or, sql } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(databaseUrl: string): Db {
  // pg's default connect wait is unbounded; a cap keeps failed attempts
  // (e.g. readiness probes against a down database) from dangling.
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  // Idle pooled connections surface server-side terminations (a Postgres
  // restart, pg_terminate_backend) as pool 'error' events; with no
  // listener that is an uncaught exception crashing a process no request
  // ever touched. The client is already discarded when this fires — the
  // next checkout dials a fresh connection — so noting it is enough.
  pool.on("error", (error) => {
    console.error(`postgres: idle client error (${error.message})`);
  });
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
  /** Held across an SSO provider update's delete + re-register (TECH-008). */
  ssoProviderUpdate: 4101003,
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
  let unlockFailure: Error | undefined;
  try {
    await holder.query("select pg_advisory_lock($1)", [key]);
    try {
      return await fn();
    } finally {
      try {
        await holder.query("select pg_advisory_unlock($1)", [key]);
      } catch (error) {
        // Swallowed deliberately: destroying the client (below) ends the
        // session, which releases the lock anyway — `fn`'s outcome stands.
        unlockFailure = error as Error;
      }
    }
  } finally {
    // A connection that may still hold the lock must not return to the
    // pool — a session-level lock outlives the query, not the session.
    // Passing the error makes pg destroy the client, ending the session.
    holder.release(unlockFailure);
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
  let unlockFailure: Error | undefined;
  try {
    const locked = await holder.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock($1) as acquired",
      [key],
    );
    if (!locked.rows[0]?.acquired) return { acquired: false };
    try {
      return { acquired: true, result: await fn() };
    } finally {
      try {
        await holder.query("select pg_advisory_unlock($1)", [key]);
      } catch (error) {
        unlockFailure = error as Error;
      }
    }
  } finally {
    // Same as withAdvisoryLock: never pool a possibly-still-locked session.
    holder.release(unlockFailure);
  }
}

/**
 * Bounded connectivity probe for readiness checks: resolves iff the
 * database answers within `timeoutMs`. The bound rides the query itself
 * (pg honors a per-query `query_timeout`, falling back to the client's
 * — see pg/lib/client.js), so a hung server can't strand the probe on
 * the pool; @types/pg only declares the client-level option, hence the
 * widened config type.
 */
export async function pingDb(db: Db, timeoutMs = 2000): Promise<void> {
  const probe: pg.QueryConfig & { query_timeout: number } = {
    text: "select 1",
    query_timeout: timeoutMs,
  };
  await db.$client.query(probe);
}

/** Applies committed drizzle-kit migrations. Called on API boot (TECH-005). */
export async function runMigrations(db: Db): Promise<void> {
  await withAdvisoryLock(db, ADVISORY_LOCK.migrations, () =>
    migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    }),
  );
}
