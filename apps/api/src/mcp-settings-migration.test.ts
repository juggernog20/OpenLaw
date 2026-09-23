// SPDX-License-Identifier: AGPL-3.0-only
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";
let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => {
  await container?.stop();
});
it("leaves MCP off on upgrade and gives new Organization settings the same defaults", async () => {
  const db = await freshDb(container, "mcp_upgrade");
  try {
    await migrateThrough(db, "0159_retire-legacy-fields", migrationEntries());
    await db.execute(sql`update org_settings set name = 'Existing organization'`);
    await runMigrations(db);
    const read = () =>
      db.execute(sql`select mcp_enabled, mcp_legal_api_keys_enabled, mcp_business_api_keys_enabled,
      mcp_toolset_ceiling, mcp_read_only, mcp_api_key_lifetime_days from org_settings`);
    const expected = {
      mcp_enabled: false,
      mcp_legal_api_keys_enabled: false,
      mcp_business_api_keys_enabled: false,
      mcp_toolset_ceiling: [
        "workspace",
        "contracts",
        "matters",
        "tasks",
        "requests",
        "comments",
        "documents",
        "auto-docs",
        "entities",
        "knowledge",
        "people",
        "team",
        "administration",
      ],
      mcp_read_only: false,
      mcp_api_key_lifetime_days: 90,
    };
    expect((await read()).rows).toEqual([expected]);
    expect((await db.execute(sql`select name from org_settings`)).rows).toEqual([
      { name: "Existing organization" },
    ]);
    for (const days of [0, 366])
      await expect(
        db.execute(sql`update org_settings set mcp_api_key_lifetime_days = ${days}`),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.execute(sql`delete from org_settings`);
    await db.execute(sql`insert into org_settings (id) values ('fresh')`);
    expect((await read()).rows).toEqual([expected]);
  } finally {
    await db.$client.end();
  }
});
