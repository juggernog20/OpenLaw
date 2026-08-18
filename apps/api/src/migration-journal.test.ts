// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The migration journal guard (#330), against a real database.
 *
 * The failure this guards is invisible by construction: Drizzle compares
 * one number, so a recorded stamp that is too high makes the migrator
 * skip everything behind it and report success. Nothing throws, nothing
 * logs, and the install finds out later as a missing table.
 *
 * So these tests do not assert on a mock of the migrator — they put a
 * database into the exact state a stranded install is in, run the boot
 * path, and read the tables back. The stranded state is built the way it
 * really arose: migrate up to `0049_contract_tasks`, then write the
 * stamp that shipped wrong, which is what an install that upgraded
 * before `fc91bae` is holding right now.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  findJournalDisorder,
  guardMigrationJournal,
  readMigrationJournal,
  runMigrations,
  sql,
  type Db,
  type JournalEntry,
} from "@openlaw/db";
import { fileURLToPath } from "node:url";

/** The committed migrations folder, resolved the way `runMigrations` resolves it. */
const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

/** The stamp `0049_contract_tasks` shipped with, and the one it should carry. */
const BAD_STAMP = 1787130000000;
const TAG = "0049_contract_tasks";

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

/** A database of its own per test — this suite writes migration bookkeeping. */
async function freshDb(name: string): Promise<Db> {
  const admin = createDb(container.getConnectionUri());
  await admin.execute(sql.raw(`create database "${name}"`));
  await admin.$client.end();
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  return createDb(url.toString());
}

/** Applies migrations up to and including `tag`, the way a past release did. */
async function migrateThrough(db: Db, entries: JournalEntry[], tag: string): Promise<void> {
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key, hash text not null, created_at bigint)`);
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const entry of entries) {
    await db.execute(
      sql.raw(
        readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), "utf8")
          .split("--> statement-breakpoint")
          .join(";"),
      ),
    );
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${entry.hash}, ${entry.when})`,
    );
    if (entry.tag === tag) return;
  }
}

async function recordedStamps(db: Db): Promise<Map<string, number>> {
  const rows = await db.execute<{ hash: string; created_at: string }>(
    sql`select hash, created_at from drizzle.__drizzle_migrations`,
  );
  return new Map(rows.rows.map((row) => [row.hash, Number(row.created_at)]));
}

describe("the committed journal", () => {
  it("is in order, so no install can be stranded by it", () => {
    expect(findJournalDisorder(readMigrationJournal(MIGRATIONS))).toEqual([]);
  });

  it("stamps 0049 earlier than the migrations that follow it", () => {
    const entries = readMigrationJournal(MIGRATIONS);
    const contractTasks = entries.find((entry) => entry.tag === TAG);
    expect(contractTasks).toBeDefined();
    expect(contractTasks?.when).toBeLessThan(BAD_STAMP);
    for (const entry of entries.filter((candidate) => candidate.idx > (contractTasks?.idx ?? 0))) {
      expect(entry.when).toBeGreaterThan(contractTasks?.when ?? 0);
    }
  });
});

describe("an install that upgraded before the correction", () => {
  let db: Db;
  let entries: JournalEntry[];

  beforeAll(async () => {
    entries = readMigrationJournal(MIGRATIONS);
    db = await freshDb("stranded");
    await migrateThrough(db, entries, TAG);
    // What that install is holding: 0049's row, stamped the way it
    // shipped rather than the way the journal now reads.
    const contractTasks = entries.find((entry) => entry.tag === TAG);
    await db.execute(
      sql`update drizzle.__drizzle_migrations set created_at = ${BAD_STAMP} where hash = ${contractTasks?.hash}`,
    );
  }, 120_000);

  afterAll(async () => {
    await db?.$client.end();
  });

  it("would skip every later migration if nothing intervened", async () => {
    // The state the guard exists to catch, asserted before it runs: the
    // newest recorded stamp is later than migrations still pending.
    const stamps = await recordedStamps(db);
    const newest = Math.max(...stamps.values());
    const pending = entries.filter((entry) => !stamps.has(entry.hash));
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((entry) => entry.when <= newest)).toBe(true);
  });

  it("is repaired by the guard, which names what it corrected", async () => {
    const outcome = await guardMigrationJournal(db, MIGRATIONS);
    expect(outcome.repaired).toEqual([TAG]);

    const contractTasks = entries.find((entry) => entry.tag === TAG);
    const stamps = await recordedStamps(db);
    expect(stamps.get(contractTasks?.hash ?? "")).toBe(contractTasks?.when);
  });

  it("then applies the migrations it had been skipping", async () => {
    await runMigrations(db);
    // The table 0052 creates — the one whose absence is how this was
    // found in the first place.
    const present = await db.execute<{ exists: boolean }>(
      sql`select to_regclass('public.notifications') is not null as exists`,
    );
    expect(present.rows[0]?.exists).toBe(true);
  }, 120_000);

  it("is a no-op on the second pass", async () => {
    const outcome = await guardMigrationJournal(db, MIGRATIONS);
    expect(outcome.repaired).toEqual([]);
  });
});

describe("a stranding the guard does not recognise", () => {
  let db: Db;

  beforeAll(async () => {
    const entries = readMigrationJournal(MIGRATIONS);
    db = await freshDb("unknown_stranding");
    await migrateThrough(db, entries, "0047_contract_key_dates");
    // A stamp from the future on a migration with no known-bad entry.
    // Nothing may quietly rewrite this — an operator decides.
    const keyDates = entries.find((entry) => entry.tag === "0047_contract_key_dates");
    await db.execute(
      sql`update drizzle.__drizzle_migrations set created_at = ${9_000_000_000_000} where hash = ${keyDates?.hash}`,
    );
  }, 120_000);

  afterAll(async () => {
    await db?.$client.end();
  });

  it("refuses to boot, naming the migrations that would be skipped", async () => {
    await expect(guardMigrationJournal(db, MIGRATIONS)).rejects.toThrow(
      /cannot apply the migrations it is missing/,
    );
    await expect(guardMigrationJournal(db, MIGRATIONS)).rejects.toThrow(/0048_contract_relations/);
  });

  it("leaves the recorded stamp alone rather than guessing", async () => {
    const stamps = await recordedStamps(db);
    expect([...stamps.values()]).toContain(9_000_000_000_000);
  });
});

describe("a database nobody has migrated", () => {
  it("passes the guard, having nothing recorded to be wrong", async () => {
    const db = await freshDb("empty_install");
    try {
      expect(await guardMigrationJournal(db, MIGRATIONS)).toEqual({ repaired: [] });
      // And the ordinary path still works from there.
      await runMigrations(db);
      const present = await db.execute<{ exists: boolean }>(
        sql`select to_regclass('public.notifications') is not null as exists`,
      );
      expect(present.rows[0]?.exists).toBe(true);
    } finally {
      await db.$client.end();
    }
  }, 180_000);
});
