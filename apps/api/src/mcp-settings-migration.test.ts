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
      mcp_legal_oauth_clients_enabled, mcp_business_oauth_clients_enabled,
      mcp_toolset_ceiling, mcp_read_only, mcp_api_key_lifetime_days from org_settings`);
    const expected = {
      mcp_enabled: false,
      mcp_legal_oauth_clients_enabled: false,
      mcp_business_oauth_clients_enabled: false,
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

it("rolls back a failed MCP upgrade in a multi-migration batch and permits a retry", async () => {
  const db = await freshDb(container, "mcp_rollback");
  try {
    await migrateThrough(db, "0158_matter-record-preparation", migrationEntries());
    await db.execute(
      sql`alter table org_settings add constraint org_settings_mcp_api_key_lifetime_check check (true)`,
    );
    await expect(runMigrations(db)).rejects.toMatchObject({ cause: { code: "42710" } });
    expect(
      (
        await db.execute(sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'org_settings' and column_name like 'mcp_%'`)
      ).rows,
    ).toEqual([]);
    await db.execute(
      sql`alter table org_settings drop constraint org_settings_mcp_api_key_lifetime_check`,
    );
    await runMigrations(db);
    expect(
      (await db.execute(sql`select mcp_enabled, mcp_api_key_lifetime_days from org_settings`)).rows,
    ).toEqual([{ mcp_enabled: false, mcp_api_key_lifetime_days: 90 }]);
  } finally {
    await db.$client.end();
  }
});

it("leaves existing MCP policy intact when adding the off-by-default OAuth Clients toggles", async () => {
  const db = await freshDb(container, "oauth_settings_upgrade");
  try {
    await migrateThrough(db, "0170_email-layout", migrationEntries());
    await db.execute(sql`update org_settings set mcp_enabled = true,
      mcp_legal_api_keys_enabled = true, mcp_business_api_keys_enabled = true,
      mcp_toolset_ceiling = '["contracts"]', mcp_read_only = true, mcp_api_key_lifetime_days = 30`);
    await runMigrations(db);
    expect(
      (
        await db.execute(sql`select mcp_enabled, mcp_legal_api_keys_enabled,
      mcp_business_api_keys_enabled, mcp_toolset_ceiling, mcp_read_only, mcp_api_key_lifetime_days,
      mcp_legal_oauth_clients_enabled, mcp_business_oauth_clients_enabled from org_settings`)
      ).rows,
    ).toEqual([
      {
        mcp_enabled: true,
        mcp_legal_api_keys_enabled: true,
        mcp_business_api_keys_enabled: true,
        mcp_toolset_ceiling: ["contracts"],
        mcp_read_only: true,
        mcp_api_key_lifetime_days: 30,
        mcp_legal_oauth_clients_enabled: false,
        mcp_business_oauth_clients_enabled: false,
      },
    ]);
  } finally {
    await db.$client.end();
  }
});

it.each([
  { ceiling: ["team", "contracts", "administration", "people"] },
  { ceiling: ["administration", "team"] },
  { ceiling: ["people", "contracts"] },
  { ceiling: [] },
])(
  "removes only Team and Administration from an M41 ceiling %j and changes the default",
  async ({ ceiling }) => {
    const db = await freshDb(container, `m42_ceiling_${ceiling.join("_") || "empty"}`);
    try {
      await migrateThrough(db, "0171_m41-oauth-clients", migrationEntries());
      await db.execute(sql`update org_settings set name = 'M41 organization',
      mcp_enabled = true, mcp_legal_api_keys_enabled = true,
      mcp_business_oauth_clients_enabled = true, mcp_read_only = true,
      mcp_api_key_lifetime_days = 17`);
      await db.execute(
        sql`update org_settings set mcp_toolset_ceiling = ${JSON.stringify(ceiling)}::jsonb`,
      );
      const before = (await db.execute(sql`select * from org_settings`)).rows[0]!;
      await runMigrations(db);
      expect((await db.execute(sql`select * from org_settings`)).rows).toEqual([
        {
          ...before,
          mcp_toolset_ceiling: ceiling.filter((id) => id !== "team" && id !== "administration"),
        },
      ]);
      await db.execute(sql`delete from org_settings`);
      await db.execute(sql`insert into org_settings (id) values ('m42-fresh')`);
      expect(
        (await db.execute(sql`select mcp_toolset_ceiling from org_settings`)).rows[0]!
          .mcp_toolset_ceiling,
      ).toEqual([
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
      ]);
    } finally {
      await db.$client.end();
    }
  },
);
