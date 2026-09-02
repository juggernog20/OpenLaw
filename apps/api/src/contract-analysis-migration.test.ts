// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses the M31 analysis substrate migration from a populated install. */
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

describe("the M31 Contract analysis substrate migration", () => {
  it("adds empty run and prompt stores without backfilling existing Contracts", async () => {
    const db: Db = await freshDb(container, "contract_analysis_upgrade");
    try {
      await migrateThrough(db, "0085_loud_scourge", entries);
      await db.execute(sql`
        insert into users (id, email, display_name, role)
        values ('analysis-existing-user', 'analysis-existing@example.com', 'Existing User',
          'legal_team_member')
      `);
      await db.execute(sql`
        insert into contracts (id, title, contract_type_id, status_id, manager_id)
        select 'analysis-existing-contract', 'Existing Contract', ct.id, cs.id,
          'analysis-existing-user'
        from contract_types ct cross join contract_statuses cs
        where ct.slug = 'other' and cs.slug = 'draft'
      `);

      await runMigrations(db);

      const stores = await db.execute<{ runs: string; prompts: string; flag: unknown }>(sql`
        select
          (select count(*) from contract_analysis_runs) as runs,
          (select count(*) from ai_field_prompts) as prompts,
          (select ai_unverified from contracts where id = 'analysis-existing-contract') as flag
      `);
      expect(stores.rows[0]).toEqual({ runs: "0", prompts: "0", flag: null });

      await db.execute(sql`
        insert into ai_field_prompts (slug, prompt) values ('effective_date', 'Find its start date.')
      `);
      await db.execute(sql`
        insert into contract_analysis_runs
          (id, contract_id, state, trigger, requested_by, preset, model)
        values ('analysis-run', 'analysis-existing-contract', 'pending', 'manual',
          'analysis-existing-user', 'custom', 'test-model')
      `);
      const run = await db.execute<{ state: string; trigger: string }>(sql`
        select state, trigger from contract_analysis_runs where id = 'analysis-run'
      `);
      expect(run.rows[0]).toEqual({ state: "pending", trigger: "manual" });
    } finally {
      await db.$client.end();
    }
  });
});
