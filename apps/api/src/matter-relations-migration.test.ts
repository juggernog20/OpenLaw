// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses MTR-015's incremental migration from the complete M23/4 schema. */
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

describe("the Matter relationships migration", () => {
  it("adds the nullable parent and canonical pair table without changing an existing Matter", async () => {
    const db: Db = await freshDb(container, "matter_relations_m23_5");
    try {
      await migrateThrough(db, "0074_bored_felicia_hardy", entries);
      await db.execute(sql`insert into users (id, email, display_name, role)
        values ('user-before-relations', 'before-relations@example.com', 'Before Relations', 'legal_team_member')`);
      await db.execute(sql`insert into matters
        (id, title, matter_type_id, status_id, priority, created_by)
        select 'matter-before-relations', 'Matter before relations', mt.id, ms.id, 'high', 'user-before-relations'
        from matter_types mt cross join matter_statuses ms
        where mt.slug = 'other' and ms.slug = 'open'`);
      const before = await db.execute<{ title: string; priority: string; status_id: string }>(
        sql`select title, priority, status_id from matters where id = 'matter-before-relations'`,
      );

      await runMigrations(db);

      const after = await db.execute<{
        title: string;
        priority: string;
        status_id: string;
        parent_id: string | null;
      }>(
        sql`select title, priority, status_id, parent_id from matters where id = 'matter-before-relations'`,
      );
      expect(after.rows).toEqual(before.rows.map((row) => ({ ...row, parent_id: null })));

      await db.execute(sql`insert into matters
        (id, title, matter_type_id, status_id, created_by)
        select 'matter-after-relations', 'Matter after relations', mt.id, ms.id, 'user-before-relations'
        from matter_types mt cross join matter_statuses ms
        where mt.slug = 'other' and ms.slug = 'open'`);
      await db.execute(sql`insert into matter_relations (matter_a_id, matter_b_id, created_by)
        values ('matter-after-relations', 'matter-before-relations', 'user-before-relations')`);
      await expect(
        db.execute(sql`insert into matter_relations (matter_a_id, matter_b_id, created_by)
          values ('matter-before-relations', 'matter-after-relations', 'user-before-relations')`),
      ).rejects.toThrow();

      const indexes = await db.execute<{ indexname: string }>(
        sql`select indexname from pg_indexes
            where tablename in ('matters', 'matter_relations')
              and indexname in ('matters_parent_idx', 'matter_relations_b_idx', 'matter_relations_pkey')
            order by indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "matter_relations_b_idx",
        "matter_relations_pkey",
        "matters_parent_idx",
      ]);
      const parentConstraints = await db.execute<{ conname: string; convalidated: boolean }>(
        sql`select conname, convalidated from pg_constraint
            where conrelid = 'matters'::regclass
              and conname in ('matters_parent_id_matters_id_fk', 'matters_parent_self_check')
            order by conname`,
      );
      expect(parentConstraints.rows).toEqual([
        { conname: "matters_parent_id_matters_id_fk", convalidated: true },
        { conname: "matters_parent_self_check", convalidated: true },
      ]);
    } finally {
      await db.$client.end();
    }
  });
});
