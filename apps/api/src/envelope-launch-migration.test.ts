// SPDX-License-Identifier: AGPL-3.0-only

/** Existing 0173 launch correlations survive the timestamp expansion. */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { envelopeLaunches, eq, runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => {
  await container?.stop();
});

it("preserves existing correlations and records subsequent consumption after upgrading 0173", async () => {
  const db = await freshDb(container, "launch_timestamps");
  try {
    await migrateThrough(db, "0173_envelope-launch-return", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role)
      values ('preparer', 'preparer@example.test', 'Preparer', 'legal_team_member')`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id)
      select 'contract', 'Existing Contract', ct.id, cs.id from contract_types ct cross join contract_statuses cs
      where ct.slug = 'other' and cs.slug = 'draft'`);
    await db.execute(sql`insert into contract_envelopes (id, contract_id, provider, provider_envelope_id, status, sent_by, sent_at)
      values ('draft', 'contract', 'docusign', 'provider-draft', 'draft', 'preparer', null)`);
    await db.execute(sql`insert into envelope_launches (state_hash, envelope_id, user_id, provider_account_id, provider_environment, expires_at, consumed_at)
      values ('open', 'draft', 'preparer', 'account', 'demo', '2026-10-01', null),
      ('spent', 'draft', 'preparer', 'account', 'demo', '2026-10-01', '2026-09-26')`);
    const readOriginal = () =>
      db.execute(sql`select state_hash, envelope_id, user_id, provider_account_id,
      provider_environment, expires_at, consumed_at from envelope_launches order by state_hash`);
    const before = await readOriginal();
    await runMigrations(db);
    expect((await readOriginal()).rows).toEqual(before.rows);
    const [open] = await db
      .select()
      .from(envelopeLaunches)
      .where(eq(envelopeLaunches.stateHash, "open"));
    expect(open!.createdAt).toBeInstanceOf(Date);
    expect(open!.updatedAt).toEqual(open!.createdAt);
    const consumedAt = new Date();
    const [consumed] = await db
      .update(envelopeLaunches)
      .set({ consumedAt })
      .where(eq(envelopeLaunches.stateHash, "open"))
      .returning();
    expect(consumed!.createdAt).toEqual(open!.createdAt);
    expect(consumed!.expiresAt).toEqual(open!.expiresAt);
    expect(consumed!.consumedAt).toEqual(consumedAt);
    expect(consumed!.updatedAt.getTime()).toBeGreaterThanOrEqual(consumedAt.getTime());
    await runMigrations(db);
    expect(await db.select().from(envelopeLaunches)).toHaveLength(2);
  } finally {
    await db.$client.end();
  }
});
