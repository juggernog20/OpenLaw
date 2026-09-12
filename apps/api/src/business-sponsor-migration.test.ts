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

it("moves the retired sponsor into an empty Business Owner and deletes the duplicate Field and values", async () => {
  const db = await freshDb(container, "retire_business_sponsor");
  try {
    await migrateThrough(db, "0110_portal_comment_reads", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('sponsor', 'sponsor@example.com', 'Sponsor', 'business_user'),
      ('owner', 'owner@example.com', 'Owner', 'business_user')`);
    await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag) values
      ('sponsor-field', 'business_sponsor', 'Business sponsor', 'contract', 'user', 'business'),
      ('other-field', 'sponsor_notes', 'Sponsor notes', 'contract', 'text', 'business')`);
    await db.execute(sql`insert into contract_type_fields (contract_type_id, field_id, display_order, is_required)
      select id, 'sponsor-field', 99, true from contract_types limit 1`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, business_owner_id, custom_fields, analysis_human_fields)
      select fixture.id, fixture.id, ct.id, cs.id, fixture.owner_id,
        jsonb_build_object('business_sponsor', fixture.sponsor_id, 'sponsor_notes', 'Keep this'), '["business_sponsor", "value"]'::jsonb
      from (values ('empty', null, 'sponsor'), ('assigned', 'owner', 'sponsor'), ('orphan', null, 'missing')) fixture(id, owner_id, sponsor_id)
      cross join (select id from contract_types limit 1) ct
      cross join (select id from contract_statuses limit 1) cs`);
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select id, business_owner_id, custom_fields, analysis_human_fields from contracts order by id`,
        )
      ).rows,
    ).toEqual([
      {
        id: "assigned",
        business_owner_id: "owner",
        custom_fields: { sponsor_notes: "Keep this" },
        analysis_human_fields: ["value"],
      },
      {
        id: "empty",
        business_owner_id: "sponsor",
        custom_fields: { sponsor_notes: "Keep this" },
        analysis_human_fields: ["value"],
      },
      {
        id: "orphan",
        business_owner_id: null,
        custom_fields: { sponsor_notes: "Keep this" },
        analysis_human_fields: ["value"],
      },
    ]);
    expect(
      (await db.execute(sql`select id from fields where slug = 'business_sponsor'`)).rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select * from contract_type_fields where field_id = 'sponsor-field'`))
        .rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select * from contract_team where user_id = 'sponsor'`)).rows,
    ).toEqual([]);
    await db.execute(sql`update contracts set business_owner_id = null where id = 'empty'`);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select business_owner_id from contracts where id = 'empty'`)).rows[0],
    ).toEqual({ business_owner_id: null });
  } finally {
    await db.$client.end();
  }
});
