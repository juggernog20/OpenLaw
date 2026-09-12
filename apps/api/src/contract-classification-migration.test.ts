// SPDX-License-Identifier: AGPL-3.0-only

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
}, 180_000);
afterAll(async () => container?.stop());

it("promotes Contract classification while retaining the shared Region Field and original Request answers", async () => {
  const db = await freshDb(container, "contract_classification");
  try {
    await migrateThrough(db, "0111_retire_business_sponsor", migrationEntries());
    await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag) values
      ('department-field', 'owning_department', 'Owning department', 'contract', 'single_select', 'business'),
      ('region-field', 'region', 'Region', 'global', 'single_select', 'business')`);
    await db.execute(sql`insert into contract_type_fields (contract_type_id, field_id, display_order, is_required)
      select ct.id, f.id, 99, true from (select id from contract_types limit 1) ct cross join fields f where f.id in ('department-field', 'region-field')`);
    await db.execute(sql`insert into matter_type_fields (matter_type_id, field_id, display_order, is_required)
      select id, 'region-field', 99, false from matter_types limit 1`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, custom_fields)
      select 'promote', 'Classification', ct.id, cs.id, '{"owning_department":"Engineering","region":"EMEA","payment_terms":"Net 30"}'::jsonb
      from (select id from contract_types limit 1) ct cross join (select id from contract_statuses limit 1) cs`);
    await db.execute(
      sql`insert into users (id, email, display_name, role) values ('requester', 'requester@example.com', 'Requester', 'business_user')`,
    );
    await db.execute(sql`insert into requests (id, summary, request_type_id, requester_id, urgency, custom_fields)
      select 'original', 'Original ask', id, 'requester', 'medium', '{"owning_department":"Engineering","region":"EMEA"}'::jsonb from request_types limit 1`);
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select owning_department, region, custom_fields from contracts where id = 'promote'`,
        )
      ).rows[0],
    ).toEqual({
      owning_department: "Engineering",
      region: "EMEA",
      custom_fields: { payment_terms: "Net 30" },
    });
    expect(
      (
        await db.execute(
          sql`select field_id from contract_type_fields where field_id in ('department-field', 'region-field')`,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.execute(
          sql`select field_id from matter_type_fields where field_id = 'region-field'`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.execute(sql`select custom_fields from requests where id = 'original'`)).rows[0],
    ).toEqual({ custom_fields: { owning_department: "Engineering", region: "EMEA" } });
    expect(
      (
        await db.execute(
          sql`select id from fields where id in ('department-field', 'region-field')`,
        )
      ).rows,
    ).toHaveLength(2);
    await db.execute(sql`update contracts set region = null where id = 'promote'`);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select region from contracts where id = 'promote'`)).rows[0],
    ).toEqual({ region: null });
  } finally {
    await db.$client.end();
  }
});
