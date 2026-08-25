// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses MTR-007's nullable Contract-to-Matter reference on an existing install. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, sql, type Db, type JournalEntry } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
let entries: JournalEntry[];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  entries = migrationEntries();
}, 180_000);

afterAll(async () => container?.stop());

describe("the Contract-to-Matter migration", () => {
  it("leaves every existing Contract standalone and adds the lookup index", async () => {
    const db: Db = await freshDb(container, "contract_matter_m23_6");
    try {
      await migrateThrough(db, "0075_watery_war_machine", entries);
      await db.execute(sql`insert into contracts
        (id, title, contract_type_id, status_id)
        select 'contract-before-link-1', 'First standalone Contract', ct.id, cs.id
        from contract_types ct cross join contract_statuses cs
        where ct.slug = 'other' and cs.slug = 'draft'`);
      await db.execute(sql`insert into contracts
        (id, title, contract_type_id, status_id)
        select 'contract-before-link-2', 'Second standalone Contract', ct.id, cs.id
        from contract_types ct cross join contract_statuses cs
        where ct.slug = 'other' and cs.slug = 'draft'`);

      await runMigrations(db);

      const contracts = await db.execute<{ id: string; matter_id: string | null }>(
        sql`select id, matter_id from contracts order by id`,
      );
      expect(contracts.rows).toEqual([
        { id: "contract-before-link-1", matter_id: null },
        { id: "contract-before-link-2", matter_id: null },
      ]);
      const indexes = await db.execute<{ indexname: string }>(
        sql`select indexname from pg_indexes
            where tablename = 'contracts' and indexname = 'contracts_matter_idx'`,
      );
      expect(indexes.rows).toEqual([{ indexname: "contracts_matter_idx" }]);
    } finally {
      await db.$client.end();
    }
  });
});
