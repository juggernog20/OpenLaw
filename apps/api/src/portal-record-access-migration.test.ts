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

it("preserves membership and creator history while keeping excluded Confidential affiliations outside the wall", async () => {
  const db = await freshDb(container, "portal_records_upgrade");
  try {
    await migrateThrough(db, "0108_normal_psynapse", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('legal', 'legal@example.com', 'Legal', 'legal_team_member'),
      ('former-contributor', 'contributor@example.com', 'Procurement', 'contributor'),
      ('business', 'business@example.com', 'Business', 'business_user'),
      ('outsider', 'outsider@example.com', 'Outside the wall', 'business_user')`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, business_owner_id, is_confidential)
      select fixture.id, fixture.id, ct.id, cs.id, 'business', fixture.confidential
      from (values ('open', false), ('walled', true)) fixture(id, confidential)
      cross join (select id from contract_types limit 1) ct
      cross join (select id from contract_statuses limit 1) cs`);
    await db.execute(sql`insert into contract_team (contract_id, user_id, role, created_at) values
      ('open', 'legal', 'creator', '2026-01-01'),
      ('open', 'legal', 'watcher', '2026-02-01'),
      ('walled', 'legal', 'creator', '2026-01-01'),
      ('walled', 'former-contributor', 'watcher', '2026-01-01')`);
    await db.execute(sql`insert into contract_stakeholders (contract_id, user_id) values
      ('open', 'outsider'), ('walled', 'outsider'), ('walled', 'former-contributor')`);
    await db.execute(sql`insert into matters (id, title, matter_type_id, status_id, created_by, is_confidential)
      select fixture.id, fixture.id, mt.id, ms.id, 'legal', fixture.confidential
      from (values ('open-matter', false), ('walled-matter', true)) fixture(id, confidential)
      cross join (select id from matter_types limit 1) mt
      cross join (select id from matter_statuses limit 1) ms`);
    await db.execute(sql`insert into matter_team (matter_id, user_id, role) values
      ('open-matter', 'legal', 'creator'), ('open-matter', 'legal', 'member'),
      ('walled-matter', 'legal', 'creator'), ('walled-matter', 'former-contributor', 'contributor')`);
    await db.execute(sql`insert into request_types (id, slug, display_name, display_order)
      values ('intake', 'portal-records-upgrade', 'Intake', 0)`);
    await db.execute(sql`insert into requests (id, request_type_id, requester_id, summary, urgency, status, converted_matter_id)
      values ('open-ask', 'intake', 'business', 'Open ask', 'medium', 'converted', 'open-matter'),
      ('walled-ask', 'intake', 'outsider', 'Walled ask', 'medium', 'converted', 'walled-matter')`);

    await runMigrations(db);

    expect(
      (await db.execute(sql`select role from users where id = 'former-contributor'`)).rows,
    ).toEqual([{ role: "business_user" }]);
    expect((await db.execute(sql`select created_by from contracts order by id`)).rows).toEqual([
      { created_by: "legal" },
      { created_by: "legal" },
    ]);
    expect(
      (
        await db.execute(
          sql`select contract_id, user_id from contract_team order by contract_id, user_id`,
        )
      ).rows,
    ).toEqual([
      { contract_id: "open", user_id: "business" },
      { contract_id: "open", user_id: "legal" },
      { contract_id: "open", user_id: "outsider" },
      { contract_id: "walled", user_id: "former-contributor" },
      { contract_id: "walled", user_id: "legal" },
    ]);
    expect(
      (
        await db.execute(
          sql`select matter_id, user_id from matter_team order by matter_id, user_id`,
        )
      ).rows,
    ).toEqual([
      { matter_id: "open-matter", user_id: "business" },
      { matter_id: "open-matter", user_id: "legal" },
      { matter_id: "walled-matter", user_id: "former-contributor" },
      { matter_id: "walled-matter", user_id: "legal" },
    ]);
    expect(
      (await db.execute(sql`select business_owner_id from matters where id = 'walled-matter'`))
        .rows,
    ).toEqual([{ business_owner_id: "outsider" }]);
    expect(
      (await db.execute(sql`select to_regclass('public.contract_stakeholders') as table_name`))
        .rows,
    ).toEqual([{ table_name: null }]);
    expect(
      (
        await db.execute(
          sql`select column_name from information_schema.columns where table_name in ('contract_team', 'matter_team') and column_name = 'role'`,
        )
      ).rows,
    ).toEqual([]);
    const history = await db.execute(
      sql`select entity_type, entity_id, payload from activity_log where action like '%.portal_access_excluded' order by entity_type, entity_id, payload::text`,
    );
    expect(history.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "contract",
          entity_id: "walled",
          payload: expect.objectContaining({ userId: "outsider", source: "stakeholder" }),
        }),
        expect.objectContaining({
          entity_type: "matter",
          entity_id: "walled-matter",
          payload: expect.objectContaining({ userId: "outsider", source: "requester" }),
        }),
      ]),
    );
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select entity_type, entity_id, payload from activity_log where action like '%.portal_access_excluded' order by entity_type, entity_id, payload::text`,
        )
      ).rows,
    ).toEqual(history.rows);
    await expect(
      db.execute(sql`insert into contract_team (contract_id, user_id) values ('open', 'business')`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update users set role = 'contributor' where id = 'business'`),
    ).rejects.toThrow();
  } finally {
    await db.$client.end();
  }
});
