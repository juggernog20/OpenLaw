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

/**
 * The half of 0099 the earlier shipped revision committed before its
 * mid-file `COMMIT`, written out here rather than read from the file.
 *
 * Drizzle runs every pending migration and its journal row in one
 * transaction, so that `COMMIT` ended the transaction early: these
 * objects landed, the backfill and the index that follow them did not,
 * and no journal row was ever written for 0099. An install interrupted
 * in that window boots into the current 0099 holding all of this
 * already. The literal SQL is the point — it is a past release's text
 * and must not follow the migration as it changes, or the rehearsal
 * would set up whatever the file currently does and prove nothing.
 */
const STRANDED_HALF = [
  `CREATE TABLE "contract_stakeholders" (
    "contract_id" text NOT NULL,
    "user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "contract_stakeholders_pkey" PRIMARY KEY("contract_id","user_id"))`,
  `ALTER TABLE "contracts" ADD COLUMN "business_owner_id" text`,
  `ALTER TABLE "contract_stakeholders" ADD CONSTRAINT "contract_stakeholders_contract_id_contracts_id_fk"
    FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE "contract_stakeholders" ADD CONSTRAINT "contract_stakeholders_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
  `CREATE INDEX "contract_stakeholders_user_idx" ON "contract_stakeholders" USING btree ("user_id")`,
  `ALTER TABLE "contracts" ADD CONSTRAINT "contracts_business_owner_id_users_id_fk"
    FOREIGN KEY ("business_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action NOT VALID`,
];

it("resumes 0099 on an install its earlier revision stranded, dead index and all", async () => {
  const db = await freshDb(container, "contract_portal_resume");
  try {
    await migrateThrough(db, "0097_currencies_in_use", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role) values
      ('resume-requester', 'resume-requester@example.com', 'Resume Requester', 'business_user'),
      ('resume-legal', 'resume-legal@example.com', 'Resume Legal', 'legal_team_member')`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, manager_id)
      select fixture.id, fixture.id, ct.id, cs.id, 'resume-legal'
      from (values ('resume-converted'), ('resume-direct')) fixture(id)
      cross join (select id from contract_types limit 1) ct
      cross join (select id from contract_statuses limit 1) cs`);
    await db.execute(
      sql`insert into request_types (id, slug, display_name, display_order) values ('resume-type', 'resume-portal', 'Resume', 0)`,
    );
    await db.execute(sql`insert into requests (id, request_type_id, requester_id, summary, urgency, status, converted_contract_id)
      values ('resume-request', 'resume-type', 'resume-requester', 'Agreement', 'medium', 'converted', 'resume-converted')`);

    for (const statement of STRANDED_HALF) await db.execute(sql.raw(statement));
    // What a `CREATE INDEX CONCURRENTLY` that failed part way leaves
    // behind: an index that exists under the name the migration wants
    // and that no query may use. `IF NOT EXISTS` alone would see the
    // name and skip past it for ever, so 0099 has to drop it first.
    await db.execute(
      sql`create index "contracts_business_owner_idx" on contracts using btree (business_owner_id)`,
    );
    await db.execute(
      sql`update pg_index set indisvalid = false where indexrelid = 'public.contracts_business_owner_idx'::regclass`,
    );
    // The window the interruption opened: the objects above are
    // committed, and nothing records that 0099 ran.
    const journalled = async () =>
      (
        await db.execute<{ count: number }>(
          sql`select count(*)::int as count from drizzle.__drizzle_migrations where created_at = ${
            migrationEntries().find((entry) => entry.tag === "0099_contract_portal_access")!.when
          }`,
        )
      ).rows[0]!.count;
    expect(await journalled()).toBe(0);

    await runMigrations(db);

    expect(await journalled()).toBe(1);
    expect(
      (await db.execute(sql`select id, business_owner_id from contracts order by id`)).rows,
    ).toEqual([
      { id: "resume-converted", business_owner_id: "resume-requester" },
      { id: "resume-direct", business_owner_id: null },
    ]);
    // The constraint the stranded half left NOT VALID is validated, and
    // the dead index is a live one, not the remnant it was.
    expect(
      (
        await db.execute(
          sql`select convalidated from pg_constraint where conname = 'contracts_business_owner_id_users_id_fk'`,
        )
      ).rows,
    ).toEqual([{ convalidated: true }]);
    expect(
      (
        await db.execute(sql`select i.indisvalid from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_index i on i.indexrelid = c.oid
          where n.nspname = 'public' and c.relname = 'contracts_business_owner_idx'`)
      ).rows,
    ).toEqual([{ indisvalid: true }]);
    // A second boot after the repaired one changes nothing further.
    await runMigrations(db);
    expect(await journalled()).toBe(1);
  } finally {
    await db.$client.end();
  }
});
