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
