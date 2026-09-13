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

it("drops return estimates while preserving Requests, submitted dates, ownership and audit history", async () => {
  const db = await freshDb(container, "request_estimate_removal");
  try {
    await migrateThrough(db, "0114_request_title_preferences", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('requester', 'requester@example.com', 'Requester', 'business_user'),
      ('owner', 'owner@example.com', 'Owner', 'legal_team_member')`);
    await db.execute(sql`insert into requests (id, title, request_type_id, requester_id, assignee_id, urgency, expected_by, custom_fields)
      select 'request', 'Review the NDA', id, 'requester', 'owner', 'medium', '2026-10-01', '{"needed_by":"2026-09-30"}'::jsonb
      from request_types limit 1`);
    await db.execute(sql`insert into activity_log (id, entity_type, entity_id, actor_id, action, visibility, payload)
      values ('estimate-change', 'request', 'request', 'owner', 'request.expected_by_changed', 'working_team', '{"number":1,"from":null,"to":"2026-10-01"}'::jsonb)`);
    const before = (
      await db.execute(
        sql`select to_jsonb(r) - 'expected_by' as row from requests r where id = 'request'`,
      )
    ).rows;
    const history = (await db.execute(sql`select * from activity_log where id = 'estimate-change'`))
      .rows;
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'requests' and column_name = 'expected_by'`,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select to_jsonb(r) as row from requests r where id = 'request'`)).rows,
    ).toEqual(before);
    expect(
      (await db.execute(sql`select * from activity_log where id = 'estimate-change'`)).rows,
    ).toEqual(history);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select to_jsonb(r) as row from requests r where id = 'request'`)).rows,
    ).toEqual(before);
  } finally {
    await db.$client.end();
  }
});
