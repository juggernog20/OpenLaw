// SPDX-License-Identifier: AGPL-3.0-only

/** Upgrade preserves Key dates and enforces reminder JSON invariants on subsequent writes. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("preserves existing Key dates and constrains reminder settings after upgrade", async () => {
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

    for (const table of ["contract_key_dates", "matter_key_dates"]) {
      const validOffsets = [0, 730, ...Array.from({ length: 18 }, (_, index) => index + 1)];
      const validRecipients = ["author", "another-person"];
      await db.execute(sql`update ${sql.identifier(table)}
        set reminder_offset_days = ${JSON.stringify(validOffsets)}::jsonb,
            reminder_recipient_ids = ${JSON.stringify(validRecipients)}::jsonb`);

      for (const [column, constraint, invalidValues] of [
        [
          "reminder_offset_days",
          `${table}_reminder_offsets_check`,
          [
            null,
            {},
            60,
            "60",
            ["60"],
            [null],
            [true],
            [[60]],
            [{}],
            [-1],
            [731],
            [1.5],
            Array.from({ length: 21 }, (_, index) => index),
          ],
        ],
        [
          "reminder_recipient_ids",
          `${table}_reminder_recipients_check`,
          [null, {}, "author", [1], [null], [false], [["author"]], [{}], ["author", 1]],
        ],
      ] as const) {
        for (const value of invalidValues) {
          // Assert PostgreSQL's constraint refusal, rather than Drizzle's SQL text.
          await expect(
            db.execute(sql`update ${sql.identifier(table)}
              set ${sql.identifier(column)} = ${JSON.stringify(value)}::jsonb`),
          ).rejects.toMatchObject({ cause: { code: "23514", constraint } });
        }
      }
      expect(
        (
          await db.execute(sql`select reminder_offset_days, reminder_recipient_ids
          from ${sql.identifier(table)}`)
        ).rows,
      ).toEqual([{ reminder_offset_days: validOffsets, reminder_recipient_ids: validRecipients }]);
    }
  } finally {
    await db.$client.end();
  }
});
