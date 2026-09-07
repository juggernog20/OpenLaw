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

it("refuses an unrecognized branch stamp without changing the schema", async () => {
  const db = await freshDb(container, "unknown_branch_upgrade");
  try {
    await migrateThrough(db, "0089_document-version-provenance-indexes", migrationEntries());
    await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at)
      values ('unrecognized-migration', 1788771065247)`);
    await expect(runMigrations(db)).rejects.toThrow("cannot apply the migrations it is missing");
    const columns = await db.execute(sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts' and column_name = 'issuer'`);
    expect(columns.rows).toEqual([{ column_name: "issuer" }]);
  } finally {
    await db.$client.end();
  }
});

it("repairs the Home branch history without losing existing Request assignments", async () => {
  const db = await freshDb(container, "home_branch_upgrade");
  try {
    await migrateThrough(db, "0089_document-version-provenance-indexes", migrationEntries());
    // This branch used its own 0090 and later UX migrations before merging dev.
    await db.execute(sql`alter table requests add column assignee_id text`);
    await db.execute(sql`alter table requests add constraint requests_assignee_id_users_id_fk
      foreign key (assignee_id) references users(id) on delete set null`);
    await db.execute(sql`create index requests_assignee_idx on requests(assignee_id)`);
    await db.execute(sql`insert into users (id, email, display_name, role)
      values ('branch-requester', 'branch@example.com', 'Requester', 'business_user')`);
    await db.execute(sql`insert into requests
      (id, request_type_id, requester_id, summary, urgency, assignee_id)
      select 'branch-request', id, 'branch-requester', 'Assigned Request', 'medium', 'branch-requester'
      from request_types limit 1`);
    await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values
      ('a74c7240bdfda1ef490996e0295d81f23f6d81e53a2d79b6f4b814f6ed12af19', 1788637394684),
      ('65218ed7fcce341502e52bbb3e0bf61609aa07389b9a58ecaa4af39795c8e6b0', 1788771065247)`);
    await runMigrations(db);
    const assigned = await db.execute(sql`select summary, assignee_id from requests
      where id = 'branch-request'`);
    expect(assigned.rows).toEqual([
      { summary: "Assigned Request", assignee_id: "branch-requester" },
    ]);
    const columns = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'accounts' and column_name = 'issuer') or
        (table_name = 'org_settings' and column_name = 'onboarding_reviewed_types_at'))`);
    expect(columns.rows).toEqual([
      { table_name: "org_settings", column_name: "onboarding_reviewed_types_at" },
    ]);
    await runMigrations(db);
  } finally {
    await db.$client.end();
  }
});

it("adds Request assignment after the existing onboarding and account migrations", async () => {
  const db = await freshDb(container, "request_assignment_upgrade");
  try {
    await migrateThrough(db, "0091_account_issuer_retired", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role)
      values ('existing-requester', 'requester@example.com', 'Requester', 'business_user')`);
    await db.execute(sql`insert into requests
      (id, request_type_id, requester_id, summary, urgency)
      select 'existing-request', id, 'existing-requester', 'Existing Request', 'medium'
      from request_types limit 1`);
    await runMigrations(db);
    const result = await db.execute(sql`select summary, assignee_id from requests
      where id = 'existing-request'`);
    expect(result.rows).toEqual([{ summary: "Existing Request", assignee_id: null }]);
    await db.execute(sql`update requests set assignee_id = 'existing-requester'
      where id = 'existing-request'`);
    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts' and column_name = 'issuer'`);
    expect(columns.rows).toEqual([]);
    await runMigrations(db);
    const assigned = await db.execute(sql`select assignee_id from requests
      where id = 'existing-request'`);
    expect(assigned.rows).toEqual([{ assignee_id: "existing-requester" }]);
  } finally {
    await db.$client.end();
  }
});
