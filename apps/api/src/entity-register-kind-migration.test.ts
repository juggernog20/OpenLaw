// SPDX-License-Identifier: AGPL-3.0-only
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";
import { getEntity } from "./modules/entities/service.js";
import { getEntityShareRegister } from "./modules/entities/share-register-routes.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());
it("pins a partnership-typed Entity with share entries on upgrade and still opens its register", async () => {
  const db = await freshDb(container, "register_kind_upgrade");
  try {
    await migrateThrough(db, "0185_holdings-register-only", migrationEntries());
    await db.execute(sql`insert into entities (id, legal_name, entity_type_id)
      select 'existing-partnership', 'Existing Partnership', id from entity_types where slug = 'partnership'`);
    await db.execute(sql`insert into entity_share_classes (id, entity_id, name)
      values ('ordinary', 'existing-partnership', 'Ordinary')`);
    await db.execute(sql`insert into entity_shareholders (id, entity_id, kind, name)
      values ('holder', 'existing-partnership', 'individual', 'Existing Holder')`);
    await db.execute(sql`insert into entity_share_entries (id, entity_id, entry_no, kind, effective_on, share_class_id, quantity, to_holder_id)
      values ('entry', 'existing-partnership', 1, 'allotment', '2026-01-01', 'ordinary', 100, 'holder')`);
    await db.execute(sql`insert into entities (id, legal_name, entity_type_id)
      select 'empty-partnership', 'Empty Partnership', id from entity_types where slug = 'partnership'`);
    await db.execute(sql`insert into entity_types (id, slug, display_name, display_order)
      values ('custom-type', 'custom-type', 'Custom type', 6)`);
    await runMigrations(db);
    await runMigrations(db);
    const user = {
      id: "reader",
      email: "reader@example.com",
      displayName: "Reader",
      role: "legal_team_member" as const,
      theme: "light" as const,
      timezone: null,
    };
    const detail = await getEntity(db, user, "existing-partnership");
    expect(detail.entity).toMatchObject({
      registerKind: "shares",
      registerKindSource: "entity",
      registerKindLocked: true,
      typeRegisterKind: "partnership",
    });
    const register = await getEntityShareRegister(db, user, "existing-partnership");
    expect(register.entries).toHaveLength(1);
    expect(register.reconciliation.registerIssued).toBe(100);
    expect((await getEntity(db, user, "empty-partnership")).entity).toMatchObject({
      registerKind: "partnership",
      registerKindSource: "type",
      registerKindLocked: false,
    });
    expect(
      (await db.execute(sql`select register_kind from entity_types where id = 'custom-type'`)).rows,
    ).toEqual([{ register_kind: "shares" }]);
  } finally {
    await db.$client.end();
  }
});
