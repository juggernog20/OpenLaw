// SPDX-License-Identifier: AGPL-3.0-only

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
}, 180_000);
afterAll(async () => container?.stop());

it("renames the Request column without losing titles, search or saved Inbox layout", async () => {
  const db = await freshDb(container, "request_title");
  try {
    await migrateThrough(db, "0112_contract_overview_classification", migrationEntries());
    await db.execute(
      sql`insert into users (id, email, display_name, role) values ('requester', 'requester@example.com', 'Requester', 'business_user')`,
    );
    await db.execute(sql`insert into requests (id, request_type_id, requester_id, summary, urgency)
      select 'request', id, 'requester', 'Original evaluation terms', 'medium' from request_types limit 1`);
    await db.execute(sql`insert into list_views (id, user_id, surface, name, config) values
      ('inbox-view', 'requester', 'inbox', 'My view', '{"columns":[{"key":"number","width":120},{"key":"summary","width":420}],"filters":{"urgency":"high"},"sort":{"key":"summary","dir":"desc"}}'::jsonb)`);
    const before = (
      await db.execute(
        sql`select id, number, requester_id, request_type_id, summary as title, created_at, updated_at from requests where id = 'request'`,
      )
    ).rows;
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select id, number, requester_id, request_type_id, title, created_at, updated_at from requests where id = 'request'`,
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.execute(
          sql`select column_name from information_schema.columns where table_name = 'requests' and column_name = 'summary'`,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.execute(
          sql`select indexname from pg_indexes where indexname = 'requests_search_vector_idx'`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.execute(
          sql`select search_vector @@ plainto_tsquery('english', 'evaluation') as matched from requests where id = 'request'`,
        )
      ).rows[0],
    ).toEqual({ matched: true });
    expect(
      (await db.execute(sql`select config from list_views where id = 'inbox-view'`)).rows[0],
    ).toEqual({
      config: {
        columns: [
          { key: "number", width: 120 },
          { key: "title", width: 420 },
        ],
        filters: { urgency: "high" },
        sort: { key: "title", dir: "desc" },
      },
    });
    await db.execute(sql`update requests set title = 'Revised terms' where id = 'request'`);
    expect(
      (
        await db.execute(
          sql`select search_vector @@ plainto_tsquery('english', 'revised') as fresh, search_vector @@ plainto_tsquery('english', 'evaluation') as stale from requests where id = 'request'`,
        )
      ).rows[0],
    ).toEqual({ fresh: true, stale: false });
    await runMigrations(db);
    expect(
      (await db.execute(sql`select title from requests where id = 'request'`)).rows[0],
    ).toEqual({ title: "Revised terms" });
  } finally {
    await db.$client.end();
  }
});
