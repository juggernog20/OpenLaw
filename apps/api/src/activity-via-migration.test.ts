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

it.each(["0165_mcp-tool-calls", "0166_activity-via"])(
  "preserves old activity and completes via validation from %s",
  async (baseline) => {
    const db = await freshDb(container, `activity_via_${baseline.slice(0, 4)}`);
    try {
      await migrateThrough(db, baseline, migrationEntries());
      await db.execute(sql`insert into activity_log (id, entity_type, action, visibility)
        values ('old-entry', 'system', 'legacy.action', 'admin_only')`);
      if (baseline === "0166_activity-via") {
        expect(
          (
            await db.execute(sql`select convalidated from pg_constraint
          where conname = 'activity_log_via_kind_check'`)
          ).rows,
        ).toEqual([{ convalidated: false }]);
      }
      await runMigrations(db);
      expect(
        (
          await db.execute(sql`select action, via_kind, via_id, via_client_name
        from activity_log where id = 'old-entry'`)
        ).rows,
      ).toEqual([
        {
          action: "legacy.action",
          via_kind: null,
          via_id: null,
          via_client_name: null,
        },
      ]);
      expect(
        (
          await db.execute(sql`select convalidated from pg_constraint
        where conname = 'activity_log_via_kind_check'`)
        ).rows,
      ).toEqual([{ convalidated: true }]);
      await expect(
        db.execute(sql`insert into activity_log (id, entity_type, action, visibility, via_kind)
        values ('invalid-entry', 'system', 'legacy.action', 'admin_only', 'unknown')`),
      ).rejects.toMatchObject({
        cause: { code: "23514" },
      });
      await runMigrations(db);
    } finally {
      await db.$client.end();
    }
  },
);
