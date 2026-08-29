// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses the complete M27 schema migration from a populated M26 install. */
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

describe("the M27 Entities schema migration", () => {
  it("keeps populated M26 Entities and Documents unchanged and widens both owner checks", async () => {
    const db: Db = await freshDb(container, "entities_full_m26");
    try {
      await migrateThrough(db, "0081_bright_talkback", entries);
      await seedM26Install(db);

      const entityBefore = await db.execute(sql`
        select id, legal_name, entity_type_id, jurisdiction, formed_on,
          registration_number, tax_id, registered_agent, registered_address,
          status, archived_at, created_at, updated_at
        from entities where id = 'entity-before-m27'
      `);
      const documentBefore = await db.execute(sql`
        select id, title, description, matter_id, contract_id, folder_id,
          executed_version_id, archived_at, is_confidential, created_by,
          created_at, updated_at
        from documents where id = 'document-before-m27'
      `);
      const folderBefore = await db.execute(sql`
        select id, matter_id, contract_id, parent_id, name, created_at, updated_at
        from document_folders where id = 'folder-before-m27'
      `);

      await runMigrations(db);

      expect(
        (
          await db.execute(sql`
            select id, legal_name, entity_type_id, jurisdiction, formed_on,
              registration_number, tax_id, registered_agent, registered_address,
              status, archived_at, created_at, updated_at
            from entities where id = 'entity-before-m27'
          `)
        ).rows,
      ).toEqual(entityBefore.rows);
      expect(
        (
          await db.execute(sql`
            select id, title, description, matter_id, contract_id, folder_id,
              executed_version_id, archived_at, is_confidential, created_by,
              created_at, updated_at
            from documents where id = 'document-before-m27'
          `)
        ).rows,
      ).toEqual(documentBefore.rows);
      expect(
        (
          await db.execute(sql`
            select id, matter_id, contract_id, parent_id, name, created_at, updated_at
            from document_folders where id = 'folder-before-m27'
          `)
        ).rows,
      ).toEqual(folderBefore.rows);

      const addedDefaults = await db.execute<{
        shares_authorized: string | null;
        shares_issued: string | null;
        par_value: number | null;
        custom_fields: Record<string, unknown> | null;
        is_confidential: boolean;
      }>(sql`
        select shares_authorized, shares_issued, par_value, custom_fields, is_confidential
        from entities where id = 'entity-before-m27'
      `);
      expect(addedDefaults.rows).toEqual([
        {
          shares_authorized: null,
          shares_issued: null,
          par_value: null,
          custom_fields: null,
          is_confidential: false,
        },
      ]);

      await db.execute(sql`
        insert into documents (id, title, entity_id, created_by)
        values ('entity-document', 'Entity-owned Document', 'entity-before-m27', 'user-before-m27')
      `);
      await db.execute(sql`
        insert into document_folders (id, entity_id, name)
        values ('entity-folder', 'entity-before-m27', 'Corporate records')
      `);
      await expect(
        db.execute(sql`
          insert into documents (id, title, contract_id, entity_id, created_by)
          values ('two-owner-document', 'Invalid', 'contract-before-m27',
            'entity-before-m27', 'user-before-m27')
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          insert into document_folders (id, name)
          values ('ownerless-folder', 'Invalid')
        `),
      ).rejects.toThrow();

      const ownerChecks = await db.execute<{ conname: string; definition: string }>(sql`
        select conname, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conname in ('documents_owner_check', 'document_folders_owner_check')
        order by conname
      `);
      expect(ownerChecks.rows).toEqual([
        {
          conname: "document_folders_owner_check",
          definition: "CHECK ((num_nonnulls(matter_id, contract_id, entity_id) = 1))",
        },
        {
          conname: "documents_owner_check",
          definition: "CHECK ((num_nonnulls(matter_id, contract_id, entity_id) = 1))",
        },
      ]);
    } finally {
      await db.$client.end();
    }
  });

  it("creates the full table set and applies its value constraints", async () => {
    const db: Db = await freshDb(container, "entities_full_constraints");
    try {
      await runMigrations(db);
      const tables = await db.execute<{ tablename: string }>(sql`
        select tablename
        from pg_tables
        where schemaname = 'public' and tablename in (
          'officer_roles', 'entity_officers', 'entity_registrations',
          'entity_holdings', 'entity_obligations', 'entity_type_fields', 'entity_grants'
        )
        order by tablename
      `);
      expect(tables.rows.map((row) => row.tablename)).toEqual([
        "entity_grants",
        "entity_holdings",
        "entity_obligations",
        "entity_officers",
        "entity_registrations",
        "entity_type_fields",
        "officer_roles",
      ]);

      await seedTwoEntities(db);
      await expect(
        db.execute(sql`update entities set custom_fields = '[]'::jsonb`),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          insert into entity_holdings (owner_entity_id, owned_entity_id, ownership_percent)
          values ('holding-owner', 'holding-owner', 25)
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          insert into entity_holdings (owner_entity_id, owned_entity_id, ownership_percent)
          values ('holding-owner', 'holding-owned', 100.01)
        `),
      ).rejects.toThrow();
    } finally {
      await db.$client.end();
    }
  });

  it("seeds officer roles once, including on a second migration run", async () => {
    const db: Db = await freshDb(container, "entities_full_seeds");
    try {
      await runMigrations(db);
      await runMigrations(db);
      const roles = await db.execute<{
        slug: string;
        display_order: number;
        is_system_default: boolean;
      }>(sql`
        select slug, display_order, is_system_default
        from officer_roles order by display_order
      `);
      expect(roles.rows).toEqual([
        { slug: "director", display_order: 1, is_system_default: true },
        { slug: "ceo", display_order: 2, is_system_default: true },
        { slug: "cfo", display_order: 3, is_system_default: true },
        { slug: "secretary", display_order: 4, is_system_default: true },
        { slug: "other", display_order: 5, is_system_default: true },
      ]);
    } finally {
      await db.$client.end();
    }
  });

  it("sets an obligation registration link null when its registration is deleted", async () => {
    const db: Db = await freshDb(container, "entities_full_registration_unlink");
    try {
      await runMigrations(db);
      await seedTwoEntities(db);
      await db.execute(sql`
        insert into entity_registrations
          (id, entity_id, jurisdiction, status)
        values ('registration-to-delete', 'holding-owner', 'Delaware', 'active')
      `);
      await db.execute(sql`
        insert into entity_obligations
          (id, entity_id, label, registration_id, next_due_on)
        values ('obligation-to-keep', 'holding-owner', 'Annual report',
          'registration-to-delete', '2027-03-01')
      `);
      await db.execute(sql`delete from entity_registrations where id = 'registration-to-delete'`);
      const obligation = await db.execute<{ registration_id: string | null }>(sql`
        select registration_id from entity_obligations where id = 'obligation-to-keep'
      `);
      expect(obligation.rows).toEqual([{ registration_id: null }]);
    } finally {
      await db.$client.end();
    }
  });
});

async function seedM26Install(db: Db): Promise<void> {
  await db.execute(sql`
    insert into users (id, email, display_name, role)
    values ('user-before-m27', 'before-m27@example.com', 'Before M27', 'legal_team_member')
  `);
  await db.execute(sql`
    insert into entities
      (id, legal_name, entity_type_id, jurisdiction, registration_number, status)
    select 'entity-before-m27', 'Existing Entity Ltd', id, 'England and Wales',
      '09876543', 'active'
    from entity_types where slug = 'other'
  `);
  await db.execute(sql`
    insert into contracts (id, title, contract_type_id, status_id, entity_id)
    select 'contract-before-m27', 'Existing Contract', ct.id, cs.id, 'entity-before-m27'
    from contract_types ct cross join contract_statuses cs
    where ct.slug = 'other' and cs.slug = 'draft'
  `);
  await db.execute(sql`
    insert into document_folders (id, contract_id, name)
    values ('folder-before-m27', 'contract-before-m27', 'Existing folder')
  `);
  await db.execute(sql`
    insert into documents (id, title, contract_id, folder_id, created_by)
    values ('document-before-m27', 'Existing Document', 'contract-before-m27',
      'folder-before-m27', 'user-before-m27')
  `);
}

async function seedTwoEntities(db: Db): Promise<void> {
  await db.execute(sql`
    insert into entities (id, legal_name, entity_type_id)
    select 'holding-owner', 'Owner Entity', id from entity_types where slug = 'other'
  `);
  await db.execute(sql`
    insert into entities (id, legal_name, entity_type_id)
    select 'holding-owned', 'Owned Entity', id from entity_types where slug = 'other'
  `);
}
