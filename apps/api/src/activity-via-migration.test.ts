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

it("leaves old activity unattributed, enforces the via kinds and survives a restart", async () => {
  const db = await freshDb(container, "activity_via");
  try {
    await migrateThrough(db, "0165_mcp-tool-calls", migrationEntries());
    await db.execute(sql`insert into activity_log (id, entity_type, action, visibility)
      values ('old-entry', 'system', 'legacy.action', 'admin_only')`);
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
    // Validated in place: the constraint guards every row from the first boot.
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
    // A second boot finds nothing pending and does not trip on the column or the constraint.
    await runMigrations(db);
  } finally {
    await db.$client.end();
  }
});
