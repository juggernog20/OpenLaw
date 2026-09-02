// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses the M29 Home substrate migration from a populated M28 install. */
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

describe("the M29 Home substrate migration", () => {
  it("widens the preference vocabulary and lands the five mine indexes without touching a row", async () => {
    const db: Db = await freshDb(container, "home_m28_upgrade");
    try {
      await migrateThrough(db, "0083_wide_inhumans", entries);
      await db.execute(sql`
        insert into users (id, email, display_name, role)
        values ('home-existing-user', 'home-existing@example.com', 'Existing User', 'legal_team_member')
      `);
      await db.execute(sql`
        insert into notification_preferences (user_id, event_group, channel, enabled)
        values ('home-existing-user', 'assigned_to_you', 'email', false)
      `);
      await db.execute(sql`
        insert into contracts (id, title, contract_type_id, status_id, manager_id)
        select 'home-existing-contract', 'Existing Contract', ct.id, cs.id, 'home-existing-user'
        from contract_types ct cross join contract_statuses cs
        where ct.slug = 'other' and cs.slug = 'draft'
      `);
      await db.execute(sql`
        insert into contract_tasks
          (id, contract_id, title, assignee_id, due_date, display_order)
        values ('home-existing-contract-task', 'home-existing-contract', 'Existing Contract Task',
          'home-existing-user', '2026-09-01', 0)
      `);
      await db.execute(sql`
        insert into contract_approvals
          (id, contract_id, approver_id, source, status, requested_by)
        values ('home-existing-approval', 'home-existing-contract', 'home-existing-user',
          'manual', 'pending', 'home-existing-user')
      `);
      await db.execute(sql`
        insert into matters (id, title, matter_type_id, status_id, manager_id, created_by)
        select 'home-existing-matter', 'Existing Matter', mt.id, ms.id,
          'home-existing-user', 'home-existing-user'
        from matter_types mt cross join matter_statuses ms
        where mt.slug = 'other' and ms.slug = 'open'
      `);
      await db.execute(sql`
        insert into matter_tasks
          (id, matter_id, title, assignee_id, due_date, display_order)
        values ('home-existing-matter-task', 'home-existing-matter', 'Existing Matter Task',
          'home-existing-user', '2026-09-02', 0)
      `);
      const before = await existingRows(db);

      await runMigrations(db);

      expect(await existingRows(db)).toEqual(before);

      for (const group of [
        "briefing.approvals",
        "briefing.tasks",
        "briefing.dates",
        "briefing.obligations",
        "briefing.intake",
      ]) {
        await expect(
          db.execute(sql`
            insert into notification_preferences (user_id, event_group, channel, enabled)
            values ('home-existing-user', ${group}, 'email', true)
            on conflict (user_id, event_group, channel) do update set enabled = excluded.enabled
          `),
        ).resolves.toBeDefined();
      }
      await expect(
        db.execute(sql`
          insert into notification_preferences (user_id, event_group, channel, enabled)
          values ('home-existing-user', 'briefing.approvals', 'in_app', true)
        `),
      ).rejects.toThrow();

      const indexes = await db.execute<{ indexname: string }>(sql`
        select indexname from pg_indexes
        where schemaname = 'public' and indexname in (
          'contract_tasks_assignee_due_idx',
          'matter_tasks_assignee_due_idx',
          'contract_approvals_approver_status_idx',
          'contracts_manager_idx',
          'matters_manager_idx'
        ) order by indexname
      `);
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "contract_approvals_approver_status_idx",
        "contract_tasks_assignee_due_idx",
        "contracts_manager_idx",
        "matter_tasks_assignee_due_idx",
        "matters_manager_idx",
      ]);
    } finally {
      await db.$client.end();
    }
  });
});

async function existingRows(db: Db): Promise<unknown> {
  const snapshot = await db.execute<{ rows: unknown }>(sql`
    select jsonb_build_object(
      'preference', (select to_jsonb(p.*) from notification_preferences p
        where user_id = 'home-existing-user' and event_group = 'assigned_to_you'),
      'contract', (select to_jsonb(c.*) - 'search_vector' - 'ai_unverified' from contracts c
        where id = 'home-existing-contract'),
      'contractTask', (select to_jsonb(t.*) from contract_tasks t
        where id = 'home-existing-contract-task'),
      'approval', (select to_jsonb(a.*) from contract_approvals a
        where id = 'home-existing-approval'),
      'matter', (select to_jsonb(m.*) - 'search_vector' from matters m
        where id = 'home-existing-matter'),
      'matterTask', (select to_jsonb(t.*) from matter_tasks t
        where id = 'home-existing-matter-task')
    ) as rows
  `);
  return snapshot.rows[0]?.rows;
}
