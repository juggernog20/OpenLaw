// SPDX-License-Identifier: AGPL-3.0-only

/** Rehearses M25's stored search vectors over a populated pre-M25 install (DOC-009, TECH-014). */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DOCUMENT_TEXT_SEARCH_CHARACTER_LIMIT,
  runMigrations,
  sql,
  type Db,
  type JournalEntry,
} from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
let entries: JournalEntry[];

const SEARCH_INDEX_NAMES = [
  "contracts_search_vector_idx",
  "counterparties_search_vector_idx",
  "document_version_text_search_vector_idx",
  "documents_search_vector_idx",
  "entities_search_vector_idx",
  "matters_search_vector_idx",
  "requests_search_vector_idx",
] as const;

const SEARCH_TABLE_NAMES = [
  "contracts",
  "counterparties",
  "document_version_text",
  "documents",
  "entities",
  "matters",
  "requests",
] as const;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  entries = migrationEntries();
}, 180_000);

afterAll(async () => container?.stop());

describe("the M25 search-vector migration", () => {
  it("indexes existing records and capped ready text without changing their source rows", async () => {
    const db: Db = await freshDb(container, "search_vectors_pre_m25");
    try {
      await migrateThrough(db, "0079_gigantic_lester", entries);
      await seedPreM25Install(db);

      const before = await sourceRows(db, false);
      await runMigrations(db);

      expect(await sourceRows(db, true)).toEqual(before);

      const columns = await db.execute<{ table_name: string; is_generated: string }>(sql`
        select table_name, is_generated
        from information_schema.columns
        where table_schema = 'public'
          and column_name = 'search_vector'
          and table_name in (${sql.join(
            SEARCH_TABLE_NAMES.map((name) => sql`${name}`),
            sql`, `,
          )})
        order by table_name
      `);
      expect(columns.rows).toEqual(
        SEARCH_TABLE_NAMES.map((tableName) => ({ table_name: tableName, is_generated: "ALWAYS" })),
      );

      const indexes = await db.execute<{ indexname: string }>(sql`
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and tablename in (${sql.join(
            SEARCH_TABLE_NAMES.map((name) => sql`${name}`),
            sql`, `,
          )})
          and indexdef like '%USING gin (search_vector)%'
        order by indexname
      `);
      expect(indexes.rows.map((row) => row.indexname)).toEqual(SEARCH_INDEX_NAMES);

      const textHit = await db.execute<{ version_id: string }>(sql`
        select version_id
        from document_version_text
        where search_vector @@ to_tsquery('english', 'warrantyclause')
      `);
      expect(textHit.rows).toEqual([{ version_id: "version-search-ready" }]);

      const cappedText = await db.execute<{
        length: number;
        inside_cap: boolean;
        outside_cap: boolean;
      }>(sql`
        select
          length(text)::integer as length,
          search_vector @@ to_tsquery('english', 'searchcapanchorxyz') as inside_cap,
          search_vector @@ to_tsquery('english', 'beyondcapuniquexyz') as outside_cap
        from document_version_text
        where version_id = 'version-search-oversize'
      `);
      expect(cappedText.rows).toHaveLength(1);
      expect(cappedText.rows[0]?.length).toBeGreaterThan(DOCUMENT_TEXT_SEARCH_CHARACTER_LIMIT);
      expect(cappedText.rows[0]).toMatchObject({ inside_cap: true, outside_cap: false });

      // Inside the character cap but past PostgreSQL's 1 MB tsvector
      // limit: a schedule of serial numbers. The write must succeed and
      // keep the text; only the vector is given up.
      await db.execute(sql`
        update document_version_text
        set text = (
          select string_agg(md5(i::text), ' ') from generate_series(1, 40000) i
        )
        where version_id = 'version-search-oversize'
      `);
      const overflow = await db.execute<{ state: string; length: number; empty: boolean }>(sql`
        select state, length(text)::integer as length, search_vector = ''::tsvector as empty
        from document_version_text
        where version_id = 'version-search-oversize'
      `);
      expect(overflow.rows).toEqual([{ state: "ready", length: 40000 * 33 - 1, empty: true }]);

      await db.execute(sql`
        update document_version_text
        set state = 'failed', source = null, text = null
        where version_id = 'version-search-ready'
      `);
      const failedVector = await db.execute<{ empty: boolean }>(sql`
        select search_vector = ''::tsvector as empty
        from document_version_text
        where version_id = 'version-search-ready'
      `);
      expect(failedVector.rows).toEqual([{ empty: true }]);

      await db.execute(sql`
        update contracts set title = 'Fresh generated title' where id = 'contract-search'
      `);
      const refreshed = await db.execute<{ fresh: boolean; stale: boolean }>(sql`
        select
          search_vector @@ to_tsquery('english', 'fresh') as fresh,
          search_vector @@ to_tsquery('english', 'legacy') as stale
        from contracts
        where id = 'contract-search'
      `);
      expect(refreshed.rows).toEqual([{ fresh: true, stale: false }]);
    } finally {
      await db.$client.end();
    }
  });
});

async function seedPreM25Install(db: Db): Promise<void> {
  await db.execute(sql`
    insert into users (id, email, display_name, role)
    values ('user-search', 'search@example.com', 'Search Member', 'legal_team_member')
  `);
  await db.execute(sql`
    insert into entities
      (id, legal_name, entity_type_id, jurisdiction, registration_number, status)
    select 'entity-search', 'Northstar Holdings', id, 'Delaware', 'REG-SEARCH-42', 'active'
    from entity_types where slug = 'other'
  `);
  await db.execute(sql`
    insert into counterparties (id, name, jurisdiction, notes)
    values ('counterparty-search', 'Legacy Counterparty', 'England and Wales', 'Known supplier')
  `);
  await db.execute(sql`
    insert into contracts
      (id, title, description, contract_type_id, status_id, entity_id)
    select
      'contract-search',
      'Legacy indexed contract',
      'Description written before M25',
      ct.id,
      cs.id,
      'entity-search'
    from contract_types ct cross join contract_statuses cs
    where ct.slug = 'other' and cs.slug = 'draft'
  `);
  await db.execute(sql`
    insert into matters
      (id, title, description, matter_type_id, status_id, priority, created_by)
    select
      'matter-search',
      'Legacy indexed Matter',
      'Matter description written before M25',
      mt.id,
      ms.id,
      'high',
      'user-search'
    from matter_types mt cross join matter_statuses ms
    where mt.slug = 'other' and ms.slug = 'open'
  `);
  await db.execute(sql`
    insert into request_types
      (id, slug, display_name, description, display_order, is_system_default)
    values
      ('request-type-search', 'search-request', 'Search Request', 'Pre-M25 request type', 1, false)
  `);
  await db.execute(sql`
    insert into requests
      (id, request_type_id, requester_id, status, summary, description, urgency)
    values
      ('request-search', 'request-type-search', 'user-search', 'new',
       'Legacy indexed Request', 'Request description written before M25', 'medium')
  `);
  await db.execute(sql`
    insert into documents (id, title, description, contract_id, created_by)
    values
      ('document-search', 'Legacy indexed Document', 'Document description before M25',
       'contract-search', 'user-search'),
      ('document-search-oversize', 'Oversize indexed Document', null,
       'contract-search', 'user-search')
  `);
  await db.execute(sql`
    insert into document_versions
      (id, document_id, version_number, file_ref, kind, note, original_filename,
       mime_type, byte_size, checksum_sha256, created_by)
    values
      ('version-search-ready', 'document-search', 1, 'local:search/ready', 'draft_ours', null,
       'legacy-search.pdf', 'application/pdf', 42, repeat('a', 64), 'user-search'),
      ('version-search-oversize', 'document-search-oversize', 1, 'local:search/oversize',
       'draft_ours', null, 'oversize-search.pdf', 'application/pdf', 43, repeat('b', 64),
       'user-search')
  `);
  await db.execute(sql`
    insert into document_version_text (version_id, state, source, text)
    values
      ('version-search-ready', 'ready', 'native_layer',
       'This existing row contains the warrantyclause sought after upgrade.'),
      ('version-search-oversize', 'ready', 'native_layer',
       'searchcapanchorxyz ' || repeat('padding ',
         (${DOCUMENT_TEXT_SEARCH_CHARACTER_LIMIT} / length('padding ')) + 10
       ) || 'beyondcapuniquexyz')
  `);
}

async function sourceRows(
  db: Db,
  migrated: boolean,
): Promise<Array<{ table_name: string; rows: unknown[] }>> {
  // Later migrations may add more derived search inputs beside the
  // generated vector. Neither is source data this M25 rehearsal is
  // promising to preserve byte-for-byte.
  const withoutDerivedSearch = migrated
    ? sql.raw(" - 'search_vector' - 'email_subject'")
    : sql.raw("");
  // Later milestones add nullable/defaulted source columns. This M25
  // rehearsal compares the pre-M25 source shape, so omit those later
  // additions beside M25's own generated vector.
  const withoutLaterEntityColumns = migrated
    ? sql.raw(
        " - 'search_vector' - 'shares_authorized' - 'shares_issued' - 'par_value' - 'custom_fields' - 'is_confidential'",
      )
    : sql.raw("");
  const withoutLaterDocumentColumns = migrated
    ? sql.raw(" - 'search_vector' - 'entity_id'")
    : sql.raw("");
  const tableNames = SEARCH_TABLE_NAMES.map((name) => sql`${name}`);
  const result = await db.execute<{ table_name: string; rows: unknown[] }>(sql`
    select table_name, rows
    from (
      select 'contracts' as table_name,
        jsonb_agg(to_jsonb(row)${withoutDerivedSearch} order by row.id) as rows from contracts row
      union all
      select 'counterparties',
        jsonb_agg(to_jsonb(row)${withoutDerivedSearch} order by row.id) from counterparties row
      union all
      select 'document_version_text',
        jsonb_agg(to_jsonb(row)${withoutDerivedSearch} order by row.version_id) from document_version_text row
      union all
      select 'documents',
        jsonb_agg(to_jsonb(row)${withoutLaterDocumentColumns} order by row.id) from documents row
      union all
      select 'entities',
        jsonb_agg(to_jsonb(row)${withoutLaterEntityColumns} order by row.id) from entities row
      union all
      select 'matters',
        jsonb_agg(to_jsonb(row)${withoutDerivedSearch} order by row.id) from matters row
      union all
      select 'requests',
        jsonb_agg(to_jsonb(row)${withoutDerivedSearch} order by row.id) from requests row
    ) source_rows
    where table_name in (${sql.join(tableNames, sql`, `)})
    order by table_name
  `);
  return result.rows;
}
