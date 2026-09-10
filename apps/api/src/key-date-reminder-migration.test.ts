// SPDX-License-Identifier: AGPL-3.0-only

/** Existing reminders keep their delivery state when Key date identity is widened. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { notifications, runMigrations, sql, type Db } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

function reminder(entityType: "contract" | "matter", keyDateId: string) {
  return {
    userId: "existing-reader",
    eventType: "date.key_date_approaching",
    entityType,
    entityId: "existing-record",
    payload: { keyDateId, label: "Existing deadline" },
    reminderDate: "2026-09-11",
    reminderOffsetDays: 1,
    emailOwed: true,
    emailedAt: new Date("2026-09-10T08:00:00Z"),
  };
}

async function insertOnce(db: Db, row: typeof notifications.$inferInsert) {
  return db
    .insert(notifications)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
}

it.each(["none", "valid", "swapped", "invalid"])(
  "preserves delivered reminders and distinguishes new Key dates, staged index=%s",
  async (stage) => {
    const db = await freshDb(container, `key_date_reminder_upgrade_${stage}`);
    try {
      await migrateThrough(db, "0097_currencies_in_use", migrationEntries());
      await db.execute(sql`insert into users (id, email, display_name)
      values ('existing-reader', 'existing@example.com', 'Existing reader')`);
      await db
        .insert(notifications)
        .values([
          reminder("contract", "contract-date"),
          reminder("matter", "matter-date"),
          { ...reminder("contract", "irrelevant-id"), eventType: "date.expiry_approaching" },
          { ...reminder("matter", "unused"), entityId: "legacy-record", payload: {} },
        ]);
      const before = await db.execute(
        sql`select to_jsonb(n) as row from notifications n order by id`,
      );

      let stagedOid: unknown;
      if (stage !== "none") {
        await db.execute(sql`create unique index notifications_reminder_idx_v3 on notifications
          (user_id, event_type, entity_type, entity_id, reminder_date, reminder_offset_days,
          coalesce(case when event_type = 'date.key_date_approaching' then payload ->> 'keyDateId' end, ''))
          where reminder_date is not null`);
        stagedOid = (
          await db.execute(sql`select 'notifications_reminder_idx_v3'::regclass::oid as oid`)
        ).rows[0]?.oid;
        if (stage === "swapped") {
          await db.execute(sql`drop index notifications_reminder_idx`);
        } else if (stage === "invalid") {
          // Rehearse the catalog state left by a failed concurrent index build.
          await db.execute(sql`update pg_index set indisvalid = false
            where indexrelid = 'notifications_reminder_idx_v3'::regclass`);
        }
      }
      await runMigrations(db);
      const finalOid = (
        await db.execute(sql`select 'notifications_reminder_idx'::regclass::oid as oid`)
      ).rows[0]?.oid;
      if (stage === "valid" || stage === "swapped") {
        // A retry must keep the valid guard, including after the old index was dropped.
        expect(finalOid).toEqual(stagedOid);
      } else if (stage === "invalid") {
        expect(finalOid).not.toEqual(stagedOid);
      }

      expect(
        (await db.execute(sql`select to_jsonb(n) as row from notifications n order by id`)).rows,
      ).toEqual(before.rows);
      for (const kind of ["contract", "matter"] as const) {
        expect(await insertOnce(db, reminder(kind, `${kind}-date`))).toEqual([]);
        expect(await insertOnce(db, reminder(kind, `${kind}-second-date`))).toHaveLength(1);
        expect(await insertOnce(db, reminder(kind, `${kind}-second-date`))).toEqual([]);
      }
      expect(
        await insertOnce(db, {
          ...reminder("contract", "another-irrelevant-id"),
          eventType: "date.expiry_approaching",
        }),
      ).toEqual([]);
      expect(
        await insertOnce(db, {
          ...reminder("matter", "unused"),
          entityId: "legacy-record",
          payload: { keyDateId: null },
        }),
      ).toEqual([]);
    } finally {
      await db.$client.end();
    }
  },
);
