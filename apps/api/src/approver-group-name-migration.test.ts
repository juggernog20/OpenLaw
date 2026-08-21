// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Migration 0064, the approver-group name de-duplication (#391),
 * against a real database.
 *
 * CTR-012's #391 addendum makes the name unique among live groups. The
 * name is the only identity the apply picker shows, and nothing stopped
 * two rows from sharing one until now — so an install really can be
 * carrying a pair, and the index cannot be created until the pair is
 * resolved.
 *
 * The resolution is a rename rather than a refusal, which is the
 * difference between this migration and 0060's: an unresolvable account
 * left nobody able to sign in, and a duplicate group name is a cosmetic
 * clash between two rows that both work. Stopping a self-hoster's
 * upgrade over one would be the worse answer.
 *
 * Every other suite starts from a migrated empty database, so the
 * rename never runs on a row in any of them. It can only be asserted by
 * putting an install into the state a real one is in and upgrading it —
 * the rehearsal `testing/migration-rehearsal.ts` exists for, and which
 * `account-issuer-migration.test.ts` is the prior art for.
 *
 * 0065's envelope-signer index has no suite here on purpose. Its guard
 * only refuses, and no install can reach it: the send route has refused
 * a repeated address since the day the table shipped, in the same
 * commit. The constraint itself is asserted at the HTTP seam, in
 * `modules/contract-envelopes/send.test.ts`.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, sql, type Db, type JournalEntry } from "@openlaw/db";
import {
  freshDb as freshDatabase,
  migrateThrough as migrateThroughTag,
  migrationEntries,
} from "./testing/migration-rehearsal.js";

/** The last migration before the one under test. */
const BEFORE = "0063_keyset_id_tiebreak";

let container: StartedPostgreSqlContainer;
let entries: JournalEntry[];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  entries = migrationEntries();
});

afterAll(async () => {
  await container?.stop();
});

/** An install from before the index: migrated to 0063, groups free to clash. */
async function installBefore(name: string): Promise<Db> {
  const db = await freshDatabase(container, name);
  await migrateThroughTag(db, BEFORE, entries);
  return db;
}

/**
 * One group row. `created_at` is given explicitly, because the rename
 * keeps the oldest row's name and a row's age is the whole input to
 * that choice — rows written in one statement would otherwise share the
 * transaction's `now()`.
 */
async function group(db: Db, id: string, name: string, createdAt: string, archived = false) {
  await db.execute(sql`insert into approver_groups (id, name, created_at, updated_at, archived_at)
    values (${id}, ${name}, ${createdAt}::timestamptz, ${createdAt}::timestamptz,
            ${archived ? createdAt : null}::timestamptz)`);
}

/** Every group's name, keyed by id. */
async function names(db: Db): Promise<Record<string, string>> {
  const rows = await db.execute<{ id: string; name: string }>(
    sql`select id, name from approver_groups`,
  );
  return Object.fromEntries(rows.rows.map((row) => [row.id, row.name]));
}

describe("the 0064 de-duplication", () => {
  it("keeps the oldest group's name and suffixes the rest", async () => {
    const db = await installBefore("groups_duplicate");
    try {
      await group(db, "g-1", "Commercial sign-off", "2026-01-01T09:00:00Z");
      await group(db, "g-2", "Commercial sign-off", "2026-02-01T09:00:00Z");
      await group(db, "g-3", "Commercial sign-off", "2026-03-01T09:00:00Z");

      await runMigrations(db);

      expect(await names(db)).toEqual({
        "g-1": "Commercial sign-off",
        "g-2": "Commercial sign-off (2)",
        "g-3": "Commercial sign-off (3)",
      });
    } finally {
      await db.$client.end();
    }
  });

  it("reads two names as the same when only their case differs", async () => {
    // The index compares `lower(name)`, so the fix-up has to as well —
    // otherwise the migration would leave behind exactly the rows the
    // index is about to refuse.
    const db = await installBefore("groups_case");
    try {
      await group(db, "g-1", "Commercial sign-off", "2026-01-01T09:00:00Z");
      await group(db, "g-2", "COMMERCIAL SIGN-OFF", "2026-02-01T09:00:00Z");

      await runMigrations(db);

      expect(await names(db)).toEqual({
        "g-1": "Commercial sign-off",
        "g-2": "COMMERCIAL SIGN-OFF (2)",
      });
    } finally {
      await db.$client.end();
    }
  });

  it("steps past a suffix a live group already carries", async () => {
    const db = await installBefore("groups_taken_suffix");
    try {
      await group(db, "g-1", "Commercial sign-off", "2026-01-01T09:00:00Z");
      await group(db, "g-2", "Commercial sign-off", "2026-02-01T09:00:00Z");
      // Somebody had already renamed by hand, and took the name the
      // rename would have reached for first.
      await group(db, "g-3", "Commercial sign-off (2)", "2026-03-01T09:00:00Z");

      await runMigrations(db);

      expect(await names(db)).toEqual({
        "g-1": "Commercial sign-off",
        "g-2": "Commercial sign-off (3)",
        "g-3": "Commercial sign-off (2)",
      });
    } finally {
      await db.$client.end();
    }
  });

  it("leaves an archived group's name alone, clash or not", async () => {
    // The index is partial on the live rows, so an archived group is not
    // in the clash and has nothing to be renamed for. Renaming it would
    // edit a record nobody is reading.
    const db = await installBefore("groups_archived");
    try {
      await group(db, "g-1", "Commercial sign-off", "2026-01-01T09:00:00Z", true);
      await group(db, "g-2", "Commercial sign-off", "2026-02-01T09:00:00Z");

      await runMigrations(db);

      expect(await names(db)).toEqual({
        "g-1": "Commercial sign-off",
        "g-2": "Commercial sign-off",
      });
    } finally {
      await db.$client.end();
    }
  });

  it("completes an install that has nothing to fix", async () => {
    const db = await installBefore("groups_clean");
    try {
      await group(db, "g-1", "Commercial sign-off", "2026-01-01T09:00:00Z");
      await group(db, "g-2", "Finance sign-off", "2026-02-01T09:00:00Z");

      await runMigrations(db);

      expect(await names(db)).toEqual({
        "g-1": "Commercial sign-off",
        "g-2": "Finance sign-off",
      });
      // And the index the rename existed for is really there, so the
      // next duplicate is refused rather than renamed.
      await expect(
        db.execute(
          sql`insert into approver_groups (id, name) values ('g-3', 'commercial sign-off')`,
        ),
      ).rejects.toMatchObject({ cause: { code: "23505" } });
    } finally {
      await db.$client.end();
    }
  });
});
