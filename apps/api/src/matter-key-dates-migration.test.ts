// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses 0073 from the complete M22 schema with an existing Matter. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, sql, type Db, type JournalEntry } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
let entries: JournalEntry[];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  entries = migrationEntries();
}, 180_000);

afterAll(async () => container?.stop());

describe("the Matter Key-date migration", () => {
  it("adds the accepted table and index without changing an existing M22 Matter", async () => {
    const db: Db = await freshDb(container, "matter_key_dates_m22");
    try {
      await migrateThrough(db, "0072_hot_annihilus", entries);
      await db.execute(sql`insert into users (id, email, display_name, role)
        values ('user-before-0073', 'before@example.com', 'Before Upgrade', 'legal_team_member')`);
      await db.execute(sql`insert into matters
        (id, title, matter_type_id, status_id, priority, created_by)
        select 'matter-before-0073', 'Matter before upgrade', mt.id, ms.id, 'high', 'user-before-0073'
        from matter_types mt cross join matter_statuses ms
        where mt.slug = 'other' and ms.slug = 'open'`);
      const before = await db.execute<{ title: string; priority: string; status_id: string }>(
        sql`select title, priority, status_id from matters where id = 'matter-before-0073'`,
      );

      await runMigrations(db);

      const after = await db.execute<{ title: string; priority: string; status_id: string }>(
        sql`select title, priority, status_id from matters where id = 'matter-before-0073'`,
      );
      expect(after.rows).toEqual(before.rows);
      await db.execute(sql`insert into matter_key_dates (id, matter_id, date, label)
        values ('date-after-0073', 'matter-before-0073', '2026-08-23', 'Response due')`);
      const indexes = await db.execute<{ indexname: string }>(
        sql`select indexname from pg_indexes where tablename = 'matter_key_dates' order by indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "matter_key_dates_matter_date_idx",
        "matter_key_dates_pkey",
      ]);
    } finally {
      await db.$client.end();
    }
  });
});
