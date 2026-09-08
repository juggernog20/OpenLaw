// SPDX-License-Identifier: AGPL-3.0-only

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => {
  await container?.stop();
});

it("keeps existing webhook configuration and defaults new rows to polling", async () => {
  const db = await freshDb(container, "signing_modes");
  try {
    await migrateThrough(db, "0090_request_triage_assignee", migrationEntries());
    await db.execute(sql`insert into signing_connectors
      (id, provider, environment, integration_key, api_user_id, private_key, webhook_secret, disabled_at)
      values ('old', 'docusign', 'demo', 'fixture-integration', 'fixture-user', 'fixture-private', 'fixture-hmac', '2026-01-01')`);
    await runMigrations(db);
    const rows = await db.execute(
      sql`select update_mode, webhook_url, private_key, webhook_secret, disabled_at is not null as disabled from signing_connectors`,
    );
    expect(rows.rows).toEqual([
      {
        update_mode: "webhook",
        webhook_url: null,
        private_key: "fixture-private",
        webhook_secret: "fixture-hmac",
        disabled: true,
      },
    ]);
    await db.execute(sql`delete from signing_connectors`);
    await db.execute(sql`insert into signing_connectors
      (id, provider, environment, integration_key, api_user_id, private_key, webhook_secret)
      values ('new', 'docusign', 'demo', 'fixture-integration', 'fixture-user', 'fixture-private', '')`);
    const fresh = await db.execute(sql`select update_mode from signing_connectors`);
    expect(fresh.rows).toEqual([{ update_mode: "polling" }]);
    await expect(
      db.execute(sql`update signing_connectors set update_mode = 'invalid'`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally {
    await db.$client.end();
  }
});
