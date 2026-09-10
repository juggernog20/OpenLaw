// SPDX-License-Identifier: AGPL-3.0-only

/** Existing reminders keep their delivery state when Key date identity is widened. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { notifications, runMigrations, sql, type Db } from "@openlaw/db";
import {
  freshDb,
  migrateThrough,
  migrationEntries,
  MIGRATIONS,
} from "./testing/migration-rehearsal.js";

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

it("restores the transaction for its journal entry and following migrations", async () => {
  const db = await freshDb(container, "key_date_reminder_transaction");
  try {
    const entries = migrationEntries();
    await migrateThrough(db, "0097_currencies_in_use", entries);
    const entry = entries.find((item) => item.tag === "0098_distinct_key_date_reminders")!;
    const statements = readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await expect(
      db.transaction(async (tx) => {
        for (const statement of statements) await tx.execute(sql.raw(statement));
        await tx.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${entry.hash}, ${entry.when})`);
        await tx.execute(sql`create table following_migration_probe (id integer)`);
        throw new Error("a later migration failed");
      }),
    ).rejects.toThrow("a later migration failed");
    expect(
      (await db.execute(sql`select to_regclass('following_migration_probe') as probe`)).rows,
    ).toEqual([{ probe: null }]);
    expect(
      (
        await db.execute(
          sql`select id from drizzle.__drizzle_migrations where hash = ${entry.hash}`,
        )
      ).rows,
    ).toEqual([]);
    // Concurrent index work has committed; an ordinary retry must finish the upgrade.
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select id from drizzle.__drizzle_migrations where hash = ${entry.hash}`,
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    await db.$client.end();
  }
});

it.each(["none", "valid", "swapped", "invalid", "half-dropped", "renamed"])(
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
        } else if (stage === "half-dropped") {
          // The other concurrent statement that can be interrupted. A failed
          // DROP INDEX CONCURRENTLY leaves the old index in place and invalid,
          // and the retry still has to get past it.
          await db.execute(sql`update pg_index set indisvalid = false
            where indexrelid = 'notifications_reminder_idx'::regclass`);
        } else if (stage === "renamed") {
          // Every statement ran; only the journal row was lost. The final name
          // already holds the new definition and no staged index is left.
          await db.execute(sql`drop index notifications_reminder_idx`);
          await db.execute(
            sql`alter index notifications_reminder_idx_v3 rename to notifications_reminder_idx`,
          );
          stagedOid = undefined;
        }
      }
      await runMigrations(db);
      const finalOid = (
        await db.execute(sql`select 'notifications_reminder_idx'::regclass::oid as oid`)
      ).rows[0]?.oid;
      if (stage === "valid" || stage === "swapped" || stage === "half-dropped") {
        // A retry must keep the valid guard, including after the old index was
        // dropped or left half-dropped.
        expect(finalOid).toEqual(stagedOid);
      } else if (stage === "invalid") {
        expect(finalOid).not.toEqual(stagedOid);
      }
      // Whatever the retry found, one valid index is left under the final name.
      expect(
        (
          await db.execute(sql`select indisvalid from pg_index
            where indexrelid = 'notifications_reminder_idx'::regclass`)
        ).rows,
      ).toEqual([{ indisvalid: true }]);
      expect(
        (await db.execute(sql`select to_regclass('notifications_reminder_idx_v3') as staged`))
          .rows[0]?.staged,
      ).toBeNull();

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
