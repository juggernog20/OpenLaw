// SPDX-License-Identifier: AGPL-3.0-only

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("backfills the close time of every closed Request and leaves open Requests null (#1322)", async () => {
  const db = await freshDb(container, "request_dispositioned_at");
  try {
    await migrateThrough(db, "0190_share_holder_users", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('requester', 'requester@example.com', 'Requester', 'business_user'),
      ('triager', 'triager@example.com', 'Triager', 'legal_team_member')`);
    await db.execute(sql`insert into requests (id, title, request_type_id, requester_id, urgency, status, updated_at)
      select v.id, v.id, t.id, 'requester', 'medium', v.status, '2026-09-20T00:00:00Z'
      from (values
        ('open-new', 'new'), ('open-read', 'read'), ('converted', 'converted'),
        ('resolved', 'resolved'), ('declined', 'declined'), ('no-entry', 'resolved')
      ) as v(id, status)
      cross join (select id from request_types limit 1) t`);
    await db.execute(sql`insert into activity_log (id, entity_type, entity_id, actor_id, action, visibility, payload, created_at) values
      ('a1', 'request', 'converted', 'triager', 'request.converted', 'working_team', '{}'::jsonb, '2026-09-02T10:00:00Z'),
      ('a2', 'request', 'resolved', 'triager', 'request.resolved', 'working_team', '{}'::jsonb, '2026-09-03T10:00:00Z'),
      ('a3', 'request', 'declined', 'triager', 'request.declined', 'working_team', '{}'::jsonb, '2026-09-05T10:00:00Z'),
      ('a4', 'request', 'declined', 'triager', 'request.declined', 'working_team', '{}'::jsonb, '2026-09-04T10:00:00Z'),
      ('a5', 'request', 'open-read', 'triager', 'request.assigned', 'working_team', '{}'::jsonb, '2026-09-01T10:00:00Z')`);

    await runMigrations(db);

    const rows = (
      await db.execute<{ id: string; at: string | null }>(
        sql`select id, to_char(dispositioned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as at
          from requests order by id`,
      )
    ).rows;
    expect(rows).toEqual([
      { id: "converted", at: "2026-09-02T10:00" },
      // The earliest entry wins when there are two.
      { id: "declined", at: "2026-09-04T10:00" },
      // A closed Request with no entry takes updated_at.
      { id: "no-entry", at: "2026-09-20T00:00" },
      { id: "open-new", at: null },
      { id: "open-read", at: null },
      { id: "resolved", at: "2026-09-03T10:00" },
    ]);

    await expect(
      db.execute(sql`update requests set status = 'resolved' where id = 'open-new'`),
    ).rejects.toMatchObject({ cause: { constraint: "requests_dispositioned_at_check" } });
  } finally {
    await db.$client.end();
  }
});
