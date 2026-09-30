// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Migration 0185 (ENT-012) against an install that holds both kinds of
 * Holding: the rows a person typed and the rows a share register
 * projected. The typed rows go, the projected rows stay as they were,
 * and the schema can no longer hold a Holding without a register holder.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("deletes typed Holdings, keeps the register's, and drops the source column", async () => {
  const db = await freshDb(container, "holdings_register_only");
  try {
    await migrateThrough(db, "0184_runtime-metrics", migrationEntries());
    await db.execute(sql`
      insert into entities (id, legal_name, entity_type_id)
      select name, name, (select id from entity_types where slug = 'other')
      from unnest(array['issuer', 'typed-owner', 'register-owner']) as name
    `);
    await db.execute(sql`
      insert into entity_shareholders (id, entity_id, kind, holder_entity_id, name) values
        ('holder-entity', 'issuer', 'entity', 'register-owner', null),
        ('holder-person', 'issuer', 'individual', null, 'Ada Register')
    `);
    await db.execute(sql`
      insert into entity_holdings (owner_entity_id, owned_entity_id, ownership_percent, source) values
        ('typed-owner', 'issuer', 25, 'manual'),
        ('register-owner', 'issuer', 60, 'register')
    `);
    await db.execute(sql`
      insert into individual_holdings (id, owned_entity_id, name, ownership_percent, source, shareholder_id) values
        ('typed-person', 'issuer', 'Ada Register', 15, 'manual', null),
        ('register-person', 'issuer', 'Ada Register', 40, 'register', 'holder-person')
    `);

    await runMigrations(db);

    expect(
      (
        await db.execute(
          sql`select owner_entity_id, ownership_percent from entity_holdings order by 1`,
        )
      ).rows,
    ).toEqual([{ owner_entity_id: "register-owner", ownership_percent: "60.00" }]);
    expect(
      (
        await db.execute(
          sql`select id, shareholder_id, ownership_percent from individual_holdings order by 1`,
        )
      ).rows,
    ).toEqual([
      { id: "register-person", shareholder_id: "holder-person", ownership_percent: "40.00" },
    ]);
    expect(
      (
        await db.execute(sql`
          select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'source'
            and table_name in ('entity_holdings', 'individual_holdings')
        `)
      ).rows,
    ).toEqual([]);
    await expect(
      db.execute(sql`
        insert into individual_holdings (id, owned_entity_id, name, ownership_percent)
        values ('no-holder', 'issuer', 'Nobody', 5)
      `),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`
        insert into individual_holdings (id, owned_entity_id, name, ownership_percent, shareholder_id)
        values ('second-row', 'issuer', 'Ada Register', 5, 'holder-person')
      `),
    ).rejects.toThrow();
  } finally {
    await db.$client.end();
  }
});
