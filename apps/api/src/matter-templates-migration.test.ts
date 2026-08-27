// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses the complete M24 migration chain from a populated M23 install. */
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

describe("the Matter Templates migration chain", () => {
  it("adds template storage without changing an existing Matter, Task, or Key date", async () => {
    const db: Db = await freshDb(container, "matter_templates_m23");
    try {
      await migrateThrough(db, "0076_thankful_cerebro", entries);
      await db.execute(sql`insert into users (id, email, display_name, role)
        values ('user-before-m24', 'before-m24@example.com', 'Before M24', 'legal_team_member')`);
      await db.execute(sql`insert into matters
        (id, title, matter_type_id, status_id, priority, risk, description, created_by)
        select 'matter-before-m24', 'Matter before M24', mt.id, ms.id, 'high', 'medium',
          'The populated Matter must survive every template migration.', 'user-before-m24'
        from matter_types mt cross join matter_statuses ms
        where mt.slug = 'other' and ms.slug = 'open'`);
      await db.execute(sql`insert into matter_tasks
        (id, matter_id, title, is_done, assignee_id, due_date, display_order)
        values ('task-before-m24', 'matter-before-m24', 'Existing checklist row', true,
          'user-before-m24', '2026-09-10', 4)`);
      await db.execute(sql`insert into matter_key_dates
        (id, matter_id, date, label, note)
        values ('date-before-m24', 'matter-before-m24', '2026-09-15',
          'Existing filing date', 'This note predates templates.')`);

      const beforeMatter = await db.execute(sql`select id, number, title, matter_type_id,
        status_id, manager_id, priority, risk, description, custom_fields, is_confidential,
        opened_at, closed_at, archived_at, created_by, created_at, updated_at
        from matters where id = 'matter-before-m24'`);
      const beforeTask = await db.execute(sql`select id, matter_id, title, is_done, assignee_id,
        due_date, display_order, created_at, updated_at
        from matter_tasks where id = 'task-before-m24'`);
      const beforeDate = await db.execute(sql`select id, matter_id, date, label, note,
        created_at, updated_at from matter_key_dates where id = 'date-before-m24'`);

      await runMigrations(db);

      const afterMatter = await db.execute(sql`select id, number, title, matter_type_id,
        status_id, manager_id, priority, risk, description, custom_fields, is_confidential,
        opened_at, closed_at, archived_at, created_by, created_at, updated_at
        from matters where id = 'matter-before-m24'`);
      const afterTask = await db.execute(sql`select id, matter_id, title, is_done, assignee_id,
        due_date, display_order, created_at, updated_at
        from matter_tasks where id = 'task-before-m24'`);
      const afterDate = await db.execute(sql`select id, matter_id, date, label, note,
        created_at, updated_at from matter_key_dates where id = 'date-before-m24'`);
      expect(afterMatter.rows).toEqual(beforeMatter.rows);
      expect(afterTask.rows).toEqual(beforeTask.rows);
      expect(afterDate.rows).toEqual(beforeDate.rows);

      const templateTables = await db.execute<{ name: string }>(sql`select tablename as name
        from pg_tables where schemaname = 'public' and tablename in
          ('matter_templates', 'matter_template_tasks', 'matter_template_key_dates')
        order by tablename`);
      expect(templateTables.rows.map((row) => row.name)).toEqual([
        "matter_template_key_dates",
        "matter_template_tasks",
        "matter_templates",
      ]);
    } finally {
      await db.$client.end();
    }
  });
});
