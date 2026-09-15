// SPDX-License-Identifier: AGPL-3.0-only

/** SET-012 backfill rehearsal: reconcile case variants without rewriting original intake. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("canonicalizes legacy Regions and preserves original Request answers", async () => {
  const db = await freshDb(container, "region_backfill");
  try {
    await migrateThrough(db, "0134_authentication-methods", migrationEntries());
    await db.execute(sql`
      insert into users (id, email, display_name, role)
      values ('region-user', 'region@example.com', 'Region User', 'legal_team_member')
    `);
    for (const [id, region] of [
      ["region-a", " EMEA "],
      ["region-b", "emea"],
      ["region-c", ""],
    ]) {
      await db.execute(sql`
        insert into contracts (id, title, contract_type_id, status_id, manager_id, region)
        select ${id}, 'Legacy Region', ct.id, cs.id, 'region-user', ${region}
        from contract_types ct cross join contract_statuses cs
        where ct.slug = 'other' and cs.slug = 'draft'
      `);
    }
    await db.execute(sql`
      insert into requests (id, request_type_id, requester_id, title, urgency, custom_fields)
      select 'region-request', id, 'region-user', 'Original Region', 'medium', '{"region":"emEa"}'::jsonb
      from request_types limit 1
    `);
    await runMigrations(db);
    const catalog = await db.execute<{ display_name: string }>(
      sql`select display_name from regions`,
    );
    expect(catalog.rows).toEqual([{ display_name: "EMEA" }]);
    const contracts = await db.execute<{ region: string | null }>(sql`
      select region from contracts where id in ('region-a', 'region-b', 'region-c') order by id
    `);
    expect(contracts.rows).toEqual([{ region: "EMEA" }, { region: "EMEA" }, { region: null }]);
    const request = await db.execute<{ region: string }>(sql`
      select custom_fields->>'region' as region from requests where id = 'region-request'
    `);
    expect(request.rows).toEqual([{ region: "emEa" }]);
    await expect(
      db.execute(sql`
      insert into regions (id, slug, display_name, display_order) values ('duplicate', 'duplicate', 'eMeA', 99)
    `),
    ).rejects.toThrow();
    const constraints = await db.execute<{ convalidated: boolean }>(sql`
      select convalidated from pg_constraint
      where conname in ('contracts_region_regions_display_name_fk', 'matters_region_regions_display_name_fk')
    `);
    expect(constraints.rows).toEqual([{ convalidated: true }, { convalidated: true }]);
  } finally {
    await db.$client.end();
  }
});
