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

it("preserves each distinct Owning department, shares repeated values, and keeps blanks null", async () => {
  const db = await freshDb(container, "departments_migration");
  try {
    await migrateThrough(db, "0114_request_title_preferences", migrationEntries());
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, owning_department)
      select data.id, data.id, ct.id, cs.id, data.name
      from (values ('a', 'Finance'), ('b', 'Finance'), ('c', 'Sales & marketing'), ('d', 'Sales marketing'), ('e', '営業'), ('f', ''), ('g', '   '), ('h', null)) data(id, name)
      cross join (select id from contract_types limit 1) ct cross join (select id from contract_statuses limit 1) cs`);
    await runMigrations(db);
    const rows = (
      await db.execute(
        sql`select c.id, c.owning_department_id, d.display_name from contracts c left join departments d on d.id = c.owning_department_id order by c.id`,
      )
    ).rows;
    expect(rows.map((row) => row.display_name)).toEqual([
      "Finance",
      "Finance",
      "Sales & marketing",
      "Sales marketing",
      "営業",
      null,
      null,
      null,
    ]);
    expect(rows[0]!.owning_department_id).toBe(rows[1]!.owning_department_id);
    expect((await db.execute(sql`select id from departments`)).rows).toHaveLength(4);
    expect(
      (
        await db.execute(
          sql`select column_name from information_schema.columns where table_name = 'contracts' and column_name = 'owning_department'`,
        )
      ).rows,
    ).toHaveLength(0);
    await runMigrations(db);
    expect((await db.execute(sql`select id from departments`)).rows).toHaveLength(4);
  } finally {
    await db.$client.end();
  }
});

it("promotes legacy Request and Matter classifications without losing their original answers", async () => {
  const db = await freshDb(container, "record_departments_migration");
  try {
    await migrateThrough(db, "0116_departments", migrationEntries());
    await db.execute(
      sql`insert into departments (id, slug, display_name, display_order) values ('finance', 'finance', 'Finance', 0)`,
    );
    await db.execute(
      sql`insert into users (id, email, display_name, role) values ('requester', 'requester@example.com', 'Requester', 'business_user')`,
    );
    await db.execute(sql`insert into matters (id, title, matter_type_id, status_id, created_by, custom_fields)
      select 'legacy-matter', 'Legacy', mt.id, ms.id, 'requester', '{"business_unit":"finance"}'::jsonb
      from (select id from matter_types limit 1) mt cross join (select id from matter_statuses limit 1) ms`);
    await db.execute(sql`insert into requests (id, title, request_type_id, requester_id, urgency, custom_fields)
      select 'legacy-request', 'Legacy request', id, 'requester', 'medium', '{"owning_department":"Platform"}'::jsonb from request_types limit 1`);
    await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag, options)
      values ('legacy-unit', 'business_unit', 'Business unit', 'matter', 'single_select', 'business', '["Platform","People"]'::jsonb)`);
    await runMigrations(db);
    const matter = (
      await db.execute(
        sql`select department_id, custom_fields from matters where id = 'legacy-matter'`,
      )
    ).rows[0];
    expect(matter).toEqual({
      department_id: "finance",
      custom_fields: { business_unit: "finance" },
    });
    const request = (
      await db.execute(
        sql`select d.display_name, r.custom_fields from requests r join departments d on d.id = r.department_id where r.id = 'legacy-request'`,
      )
    ).rows[0];
    expect(request).toEqual({
      display_name: "Platform",
      custom_fields: { owning_department: "Platform" },
    });
    expect(
      (await db.execute(sql`select display_name from departments order by display_name`)).rows,
    ).toEqual([
      { display_name: "Finance" },
      { display_name: "People" },
      { display_name: "Platform" },
    ]);
    expect(
      (
        await db.execute(
          sql`select display_name, archived_at is not null as archived from fields where id = 'legacy-unit'`,
        )
      ).rows,
    ).toEqual([{ display_name: "Department", archived: true }]);
    await runMigrations(db);
    expect((await db.execute(sql`select id from departments`)).rows).toHaveLength(3);
  } finally {
    await db.$client.end();
  }
});
