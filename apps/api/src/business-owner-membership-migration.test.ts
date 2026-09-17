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

it("backfills current Business Owners once, including Confidential and archived records", async () => {
  const db = await freshDb(container, "business_owner_membership");
  try {
    await migrateThrough(db, "0137_custom-value-cadence", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('owner', 'owner@example.com', 'Business Owner', 'business_user'),
      ('member', 'member@example.com', 'Existing member', 'business_user')`);
    for (const module of ["contract", "matter"] as const) {
      await db.execute(
        sql.raw(`insert into ${module}s (id, title, ${module}_type_id, status_id, business_owner_id, is_confidential, archived_at, created_by)
        select fixture.id, fixture.id, t.id, s.id, fixture.owner, fixture.confidential, fixture.archived, 'member'
        from (values ('open', 'owner', false, null::timestamptz), ('private', 'owner', true, null::timestamptz),
          ('archived', 'owner', false, now()), ('already-on-team', 'owner', false, null::timestamptz),
          ('unassigned', null, false, null::timestamptz)) fixture(id, owner, confidential, archived)
        cross join (select id from ${module}_types limit 1) t
        cross join (select id from ${module}_statuses limit 1) s`),
      );
      await db.execute(
        sql.raw(`insert into ${module}_team (${module}_id, user_id) values
        ('already-on-team', 'owner'), ('open', 'member')`),
      );
    }
    await runMigrations(db);
    for (const module of ["contract", "matter"] as const) {
      const rows = await db.execute(
        sql.raw(
          `select ${module}_id as record, user_id from ${module}_team order by ${module}_id, user_id`,
        ),
      );
      expect(rows.rows).toEqual([
        { record: "already-on-team", user_id: "owner" },
        { record: "archived", user_id: "owner" },
        { record: "open", user_id: "member" },
        { record: "open", user_id: "owner" },
        { record: "private", user_id: "owner" },
      ]);
    }
    const readHistory = () =>
      db.execute(
        sql`select entity_type, entity_id, payload from activity_log where payload->>'reason' = 'Business Owner membership backfill' order by entity_type, entity_id`,
      );
    const history = await readHistory();
    expect(history.rows).toHaveLength(6);
    expect(
      history.rows.every((row) => (row.payload as { member: string }).member === "Business Owner"),
    ).toBe(true);
    await runMigrations(db);
    expect((await readHistory()).rows).toEqual(history.rows);
  } finally {
    await db.$client.end();
  }
});
