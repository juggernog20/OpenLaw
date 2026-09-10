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
it("backfills converted Requesters as Business Owners once, without granting duplicate stakeholder access", async () => {
  const db = await freshDb(container, "contract_portal_upgrade");
  try {
    await migrateThrough(db, "0097_currencies_in_use", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('requester', 'requester@example.com', 'Requester', 'business_user'),
      ('legal', 'legal@example.com', 'Legal Owner', 'legal_team_member')`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, manager_id)
      select fixture.id, fixture.id, ct.id, cs.id, 'legal'
      from (values ('converted'), ('direct')) fixture(id)
      cross join (select id from contract_types limit 1) ct
      cross join (select id from contract_statuses limit 1) cs`);
    await db.execute(
      sql`insert into request_types (id, slug, display_name, display_order) values ('type', 'portal-upgrade', 'Upgrade', 0)`,
    );
    await db.execute(sql`insert into requests (id, request_type_id, requester_id, summary, urgency, status, converted_contract_id)
      values ('request', 'type', 'requester', 'Agreement', 'medium', 'converted', 'converted')`);
    await runMigrations(db);
    const rows = await db.execute(
      sql`select id, manager_id, business_owner_id from contracts order by id`,
    );
    expect(rows.rows).toEqual([
      { id: "converted", manager_id: "legal", business_owner_id: "requester" },
      { id: "direct", manager_id: "legal", business_owner_id: null },
    ]);
    expect((await db.execute(sql`select * from contract_stakeholders`)).rows).toEqual([]);
    await db.execute(sql`update contracts set business_owner_id = null where id = 'converted'`);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select business_owner_id from contracts where id = 'converted'`))
        .rows[0],
    ).toEqual({ business_owner_id: null });
  } finally {
    await db.$client.end();
  }
});
