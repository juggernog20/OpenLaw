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

it("preserves progression groups already configured on the UX branch", async () => {
  const db = await freshDb(container, "existing_status_groups");
  try {
    await migrateThrough(db, "0092_request_triage_assignee", migrationEntries());
    await db.execute(sql`alter table matter_statuses
      add column progression_group text not null default 'in_progress'`);
    await db.execute(sql`alter table matter_statuses
      add constraint matter_statuses_progression_group_check
      check (progression_group in ('open', 'in_progress', 'waiting'))`);
    await db.execute(sql`update matter_statuses set progression_group = 'waiting'
      where slug = 'on_hold'`);
    await runMigrations(db);
    const rows = await db.execute(sql`select progression_group from matter_statuses
      where slug = 'on_hold'`);
    expect(rows.rows).toEqual([{ progression_group: "waiting" }]);
    await runMigrations(db);
  } finally {
    await db.$client.end();
  }
});

it("groups existing statuses without changing their names, categories or order", async () => {
  const db = await freshDb(container, "matter_status_groups");
  try {
    await migrateThrough(db, "0092_request_triage_assignee", migrationEntries());
    await db.execute(sql`insert into matter_statuses (id, slug, display_name, category, display_order)
      values ('waiting-custom', 'with_external_counsel', 'Renamed by admin', 'open', 5),
      ('business-custom', 'awaiting_the_business', 'Awaiting the business', 'open', 6),
      ('active-custom', 'legal_research', 'Legal research', 'open', 7)`);
    const before = await db.execute(
      sql`select id, slug, display_name, category, display_order from matter_statuses order by id`,
    );
    await runMigrations(db);
    const after = await db.execute(
      sql`select id, slug, display_name, category, display_order from matter_statuses order by id`,
    );
    expect(after.rows).toEqual(before.rows);
    const grouped = await db.execute<{ slug: string; progression_group: string }>(
      sql`select slug, progression_group from matter_statuses`,
    );
    const groups = Object.fromEntries(grouped.rows.map((row) => [row.slug, row.progression_group]));
    expect(groups).toMatchObject({
      open: "open",
      on_hold: "open",
      in_progress: "in_progress",
      with_external_counsel: "waiting",
      awaiting_the_business: "waiting",
      legal_research: "in_progress",
    });
  } finally {
    await db.$client.end();
  }
});
