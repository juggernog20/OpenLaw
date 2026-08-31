// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses the Matter Tasks migration from the complete M23/3 schema. */
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

describe("the Matter Tasks migration", () => {
  it("adds the accepted checklist and ordering index without changing an existing Matter", async () => {
    const db: Db = await freshDb(container, "matter_tasks_m23_3");
    try {
      await migrateThrough(db, "0073_shocking_raider", entries);
      await db.execute(sql`insert into users (id, email, display_name, role)
        values ('user-before-tasks', 'before-tasks@example.com', 'Before Tasks', 'legal_team_member')`);
      await db.execute(sql`insert into matters
        (id, title, matter_type_id, status_id, priority, created_by)
        select 'matter-before-tasks', 'Matter before tasks', mt.id, ms.id, 'high', 'user-before-tasks'
        from matter_types mt cross join matter_statuses ms
        where mt.slug = 'other' and ms.slug = 'open'`);
      const before = await db.execute<{ title: string; priority: string; status_id: string }>(
        sql`select title, priority, status_id from matters where id = 'matter-before-tasks'`,
      );

      await runMigrations(db);

      const after = await db.execute<{ title: string; priority: string; status_id: string }>(
        sql`select title, priority, status_id from matters where id = 'matter-before-tasks'`,
      );
      expect(after.rows).toEqual(before.rows);
      await db.execute(sql`insert into matter_tasks
        (id, matter_id, title, due_date, display_order)
        values ('task-after-migration', 'matter-before-tasks', 'Prepare response', '2026-08-30', 0)`);
      const indexes = await db.execute<{ indexname: string }>(
        sql`select indexname from pg_indexes where tablename = 'matter_tasks' order by indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "matter_tasks_assignee_due_idx",
        "matter_tasks_matter_order_idx",
        "matter_tasks_pkey",
      ]);
    } finally {
      await db.$client.end();
    }
  });
});
