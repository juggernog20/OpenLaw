// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses the M28 Knowledge schema migration from a populated M27 install. */
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

describe("the M28 Knowledge schema migration", () => {
  it("preserves M27 Documents, folders, and external deflection links while widening their checks", async () => {
    const db: Db = await freshDb(container, "knowledge_m27_upgrade");
    try {
      await migrateThrough(db, "0082_great_betty_ross", entries);
      await seedM27Install(db);

      const documentBefore = await db.execute(sql`
        select id, title, description, matter_id, contract_id, entity_id, folder_id,
          executed_version_id, archived_at, is_confidential, created_by,
          created_at, updated_at, search_vector::text as search_vector
        from documents where id = 'document-before-m28'
      `);
      const folderBefore = await db.execute(sql`
        select id, matter_id, contract_id, entity_id, parent_id, name,
          created_at, updated_at
        from document_folders where id = 'folder-before-m28'
      `);
      const linkBefore = await db.execute(sql`
        select id, label, url, request_type_id, display_order, created_at, updated_at
        from intake_links where id = 'link-before-m28'
      `);

      await runMigrations(db);

      expect(
        (
          await db.execute(sql`
            select id, title, description, matter_id, contract_id, entity_id, folder_id,
              executed_version_id, archived_at, is_confidential, created_by,
              created_at, updated_at, search_vector::text as search_vector
            from documents where id = 'document-before-m28'
          `)
        ).rows,
      ).toEqual(documentBefore.rows);
      expect(
        (
          await db.execute(sql`
            select id, matter_id, contract_id, entity_id, parent_id, name,
              created_at, updated_at
            from document_folders where id = 'folder-before-m28'
          `)
        ).rows,
      ).toEqual(folderBefore.rows);
      expect(
        (
          await db.execute(sql`
            select id, label, url, request_type_id, display_order, created_at, updated_at
            from intake_links where id = 'link-before-m28'
          `)
        ).rows,
      ).toEqual(linkBefore.rows);

      const addedColumns = await db.execute<{
        knowledge_item_id: string | null;
        link_knowledge_item_id: string | null;
      }>(sql`
        select d.knowledge_item_id,
          l.knowledge_item_id as link_knowledge_item_id
        from documents d cross join intake_links l
        where d.id = 'document-before-m28' and l.id = 'link-before-m28'
      `);
      expect(addedColumns.rows).toEqual([
        { knowledge_item_id: null, link_knowledge_item_id: null },
      ]);

      const ownerChecks = await db.execute<{ conname: string; definition: string }>(sql`
        select conname, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conname in ('documents_owner_check', 'intake_links_target_check')
        order by conname
      `);
      expect(ownerChecks.rows).toEqual([
        {
          conname: "documents_owner_check",
          definition:
            "CHECK ((num_nonnulls(matter_id, contract_id, entity_id, knowledge_item_id) = 1))",
        },
        {
          conname: "intake_links_target_check",
          definition: "CHECK ((num_nonnulls(url, knowledge_item_id) = 1))",
        },
      ]);

      const folderColumns = await db.execute<{ exists: boolean }>(sql`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'document_folders'
            and column_name = 'knowledge_item_id'
        ) as exists
      `);
      expect(folderColumns.rows).toEqual([{ exists: false }]);
    } finally {
      await db.$client.end();
    }
  });

  it("creates constrained Knowledge tables and keeps the four type seeds single on rerun", async () => {
    const db: Db = await freshDb(container, "knowledge_schema_constraints");
    try {
      await runMigrations(db);
      await runMigrations(db);

      const types = await db.execute<{
        slug: string;
        display_order: number;
        is_system_default: boolean;
        copies: number;
      }>(sql`
        select slug, min(display_order)::int as display_order,
          bool_and(is_system_default) as is_system_default,
          count(*)::int as copies
        from knowledge_types
        group by slug
        order by display_order
      `);
      expect(types.rows).toEqual([
        { slug: "template", display_order: 1, is_system_default: true, copies: 1 },
        { slug: "precedent", display_order: 2, is_system_default: true, copies: 1 },
        { slug: "playbook", display_order: 3, is_system_default: true, copies: 1 },
        { slug: "article", display_order: 4, is_system_default: true, copies: 1 },
      ]);

      await seedKnowledgeItem(db);
      await db.execute(sql`
        insert into documents (id, title, knowledge_item_id, created_by)
        values ('knowledge-document', 'Knowledge Document', 'knowledge-item', 'knowledge-user')
      `);
      await db.execute(sql`
        insert into intake_links
          (id, label, knowledge_item_id, display_order)
        values ('knowledge-link', 'Knowledge link', 'knowledge-item', 1)
      `);
      await db.execute(sql`
        update knowledge_items
        set primary_document_id = 'knowledge-document'
        where id = 'knowledge-item'
      `);

      await expect(
        db.execute(sql`
          insert into documents (id, title, contract_id, knowledge_item_id, created_by)
          values ('two-owner-document', 'Invalid', 'knowledge-contract',
            'knowledge-item', 'knowledge-user')
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          insert into intake_links
            (id, label, url, knowledge_item_id, display_order)
          values ('two-target-link', 'Invalid', 'https://example.com', 'knowledge-item', 2)
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          insert into intake_links (id, label, display_order)
          values ('targetless-link', 'Invalid', 3)
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          update knowledge_items set state = 'review' where id = 'knowledge-item'
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          update knowledge_items set audience = 'contributors' where id = 'knowledge-item'
        `),
      ).rejects.toThrow();

      const intakeDeleteRule = await db.execute<{ delete_rule: string }>(sql`
        select delete_rule
        from information_schema.referential_constraints
        where constraint_schema = 'public'
          and constraint_name = 'intake_links_knowledge_item_id_knowledge_items_id_fk'
      `);
      expect(intakeDeleteRule.rows).toEqual([{ delete_rule: "SET NULL" }]);

      await db.execute(sql`delete from documents where id = 'knowledge-document'`);
      const primary = await db.execute(sql`
        select primary_document_id from knowledge_items where id = 'knowledge-item'
      `);
      expect(primary.rows).toEqual([{ primary_document_id: null }]);
    } finally {
      await db.$client.end();
    }
  });
});

async function seedM27Install(db: Db): Promise<void> {
  await db.execute(sql`
    insert into users (id, email, display_name, role)
    values ('user-before-m28', 'before-m28@example.com', 'Before M28', 'legal_team_member')
  `);
  await db.execute(sql`
    insert into contracts (id, title, contract_type_id, status_id)
    select 'contract-before-m28', 'Existing Contract', ct.id, cs.id
    from contract_types ct cross join contract_statuses cs
    where ct.slug = 'other' and cs.slug = 'draft'
  `);
  await db.execute(sql`
    insert into document_folders (id, contract_id, name)
    values ('folder-before-m28', 'contract-before-m28', 'Existing folder')
  `);
  await db.execute(sql`
    insert into documents (id, title, contract_id, folder_id, created_by)
    values ('document-before-m28', 'Existing Document', 'contract-before-m28',
      'folder-before-m28', 'user-before-m28')
  `);
  await db.execute(sql`
    insert into intake_links (id, label, url, display_order)
    values ('link-before-m28', 'Existing external link', 'https://example.com/faq', 1)
  `);
}

async function seedKnowledgeItem(db: Db): Promise<void> {
  await db.execute(sql`
    insert into users (id, email, display_name, role)
    values ('knowledge-user', 'knowledge@example.com', 'Knowledge Author', 'legal_team_member')
  `);
  await db.execute(sql`
    insert into contracts (id, title, contract_type_id, status_id)
    select 'knowledge-contract', 'Knowledge Constraint Contract', ct.id, cs.id
    from contract_types ct cross join contract_statuses cs
    where ct.slug = 'other' and cs.slug = 'draft'
  `);
  await db.execute(sql`
    insert into knowledge_items
      (id, title, knowledge_type_id, body, state, audience, created_by, updated_by)
    select 'knowledge-item', 'Playbook', id, '# Guidance', 'published', 'everyone',
      'knowledge-user', 'knowledge-user'
    from knowledge_types where slug = 'playbook'
  `);
}
