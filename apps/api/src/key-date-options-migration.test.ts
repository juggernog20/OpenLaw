// SPDX-License-Identifier: AGPL-3.0-only

/** Existing Key dates retain their content and use the global reminder defaults after upgrade. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("adds empty reminder settings without altering existing Contract or Matter Key dates", async () => {
  const db = await freshDb(container, "key_date_options_upgrade");
  try {
    await migrateThrough(db, "0098_distinct_key_date_reminders", migrationEntries());
    await db.execute(
      sql`insert into users (id,email,display_name) values ('author','author@example.com','Author')`,
    );
    await db.execute(sql`insert into contracts (id,title,contract_type_id,status_id)
      select 'contract','Existing Contract',t.id,s.id from contract_types t cross join contract_statuses s limit 1`);
    await db.execute(sql`insert into matters (id,title,matter_type_id,status_id,created_by)
      select 'matter','Existing Matter',t.id,s.id,'author' from matter_types t cross join matter_statuses s limit 1`);
    await db.execute(sql`insert into contract_key_dates (id,contract_id,date,label,note)
      values ('contract-date','contract','2027-02-03','Renewal','Call the broker')`);
    await db.execute(sql`insert into matter_key_dates (id,matter_id,date,label,note)
      values ('matter-date','matter','2027-02-03','Filing','Attach exhibits')`);
    const beforeContract = await db.execute(
      sql`select to_jsonb(d) as row from contract_key_dates d`,
    );
    const beforeMatter = await db.execute(sql`select to_jsonb(d) as row from matter_key_dates d`);
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select to_jsonb(d) - 'reminder_offset_days' - 'reminder_recipient_ids' as row from contract_key_dates d`,
        )
      ).rows,
    ).toEqual(beforeContract.rows);
    expect(
      (
        await db.execute(
          sql`select to_jsonb(d) - 'reminder_offset_days' - 'reminder_recipient_ids' as row from matter_key_dates d`,
        )
      ).rows,
    ).toEqual(beforeMatter.rows);
    expect(
      (
        await db.execute(sql`select reminder_offset_days,reminder_recipient_ids from contract_key_dates
      union all select reminder_offset_days,reminder_recipient_ids from matter_key_dates`)
      ).rows,
    ).toEqual([
      { reminder_offset_days: [], reminder_recipient_ids: [] },
      { reminder_offset_days: [], reminder_recipient_ids: [] },
    ]);
  } finally {
    await db.$client.end();
  }
});
