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

it("upgrades existing notification rows, admits push preferences, and passes the boot guard again", async () => {
  const db = await freshDb(container, "push_upgrade");
  try {
    await migrateThrough(db, "0152_conversion-draft-notice", migrationEntries());
    await db.execute(
      sql`insert into users (id, email, display_name) values ('push-user', 'push@example.com', 'Reader')`,
    );
    await db.execute(
      sql`insert into notifications (id, user_id, event_type, entity_type, entity_id, email_owed, emailed_at) values ('old-row', 'push-user', 'approval.requested', 'contract', 'record', true, now())`,
    );
    await db.execute(
      sql`insert into notification_preferences (user_id, event_group, channel, enabled) values ('push-user', 'assigned_to_you', 'email', false)`,
    );
    await runMigrations(db);
    await runMigrations(db);
    const row = await db.execute(
      sql`select push_owed, pushed_at, push_skipped_at, email_owed, emailed_at is not null as sent from notifications where id = 'old-row'`,
    );
    expect(row.rows).toEqual([
      { push_owed: false, pushed_at: null, push_skipped_at: null, email_owed: true, sent: true },
    ]);
    expect(
      (await db.execute(sql`select show_record_names_on_devices from users where id = 'push-user'`))
        .rows,
    ).toEqual([{ show_record_names_on_devices: true }]);
    await db.execute(
      sql`insert into notification_preferences (user_id, event_group, channel, enabled) values ('push-user', 'assigned_to_you', 'push', false)`,
    );
    await expect(
      db.execute(
        sql`insert into notification_preferences (user_id, event_group, channel, enabled) values ('push-user', 'briefing.dates', 'push', true)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update notifications set pushed_at = now() where id = 'old-row'`),
    ).rejects.toThrow();
    await db.execute(
      sql`update notifications set push_owed = true, pushed_at = now() where id = 'old-row'`,
    );
    await expect(
      db.execute(sql`update notifications set push_skipped_at = now() where id = 'old-row'`),
    ).rejects.toThrow();
  } finally {
    await db.$client.end();
  }
});
