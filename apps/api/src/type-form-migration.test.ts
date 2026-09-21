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

it.each([false, true])(
  "migrates populated Forms, reusing a pre-existing Default: %s",
  async (existingDefault) => {
    const db = await freshDb(container, `type_forms_${existingDefault}`);
    try {
      await migrateThrough(db, "0156_answer-style", migrationEntries());
      if (existingDefault) {
        for (const module of ["contract", "matter"]) {
          await db.execute(
            sql.raw(
              `insert into ${module}_types (id, slug, display_name, display_order, archived_at) values ('existing-${module}', 'default', 'Existing default', 90, now())`,
            ),
          );
        }
      }
      await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag) values
      ('form-business', 'form_business', 'Business', 'contract', 'text', 'business'),
      ('form-legal', 'form_legal', 'Legal', 'contract', 'text', 'legal'),
      ('form-matter', 'form_matter', 'Matter', 'matter', 'text', 'business')`);
      await db.execute(sql`insert into request_types (id, slug, display_name, display_order, target_module, target_contract_type_id) values
      ('form-nda-request', 'form_nda_request', 'NDA', 90, 'contract', (select id from contract_types where slug = 'nda')),
      ('form-module-request', 'form_module_request', 'Contract', 91, 'contract', null),
      ('form-null-request', 'form_null_request', 'Question', 92, null, null)`);
      await db.execute(sql`insert into contract_type_fields (contract_type_id, field_id, display_order, is_required)
      select id, 'form-business', 41, true from contract_types where slug = 'nda'`);
      await db.execute(sql`insert into request_type_fields (request_type_id, field_id, display_order, is_required) values
      ('form-nda-request', 'form-business', 1, false), ('form-nda-request', 'form-legal', 2, true),
      ('form-module-request', 'form-business', 1, false), ('form-null-request', 'form-matter', 1, true)`);
      await db.execute(sql`insert into request_type_fields (request_type_id, field_id, display_order, is_required)
      select 'form-nda-request', id, 10, true from fields where built_in_key is not null`);
      await db.execute(
        sql`insert into users (id, display_name, email, email_verified) values ('form-requester', 'Requester', 'form@example.test', true)`,
      );
      await db.execute(sql`insert into requests (id, request_type_id, requester_id, title, urgency, custom_fields)
      values ('form-answer', 'form-nda-request', 'form-requester', 'Existing answer', 'medium', '{"__intake_contract_effectiveDate":"2026-01-01"}'::jsonb)`);
      await runMigrations(db);
      expect(
        (await db.execute(sql`select custom_fields from requests where id = 'form-answer'`)).rows,
      ).toEqual([{ custom_fields: { __intake_contract_effectiveDate: "2026-01-01" } }]);
      for (const module of ["contract", "matter"]) {
        const defaults = (
          await db.execute(sql.raw(`select id, archived_at from ${module}_types where is_default`))
        ).rows;
        expect(defaults).toHaveLength(1);
        expect(defaults[0]!.archived_at).toBeNull();
        if (existingDefault) expect(defaults[0]!.id).toBe(`existing-${module}`);
      }
      const destinations = (
        await db.execute(sql`select r.id, r.target_module, c.is_default as contract_default, m.is_default as matter_default
      from request_types r left join contract_types c on c.id = r.target_contract_type_id left join matter_types m on m.id = r.target_matter_type_id
      where r.id in ('form-module-request', 'form-null-request') order by r.id`)
      ).rows;
      expect(destinations).toEqual([
        {
          id: "form-module-request",
          target_module: "contract",
          contract_default: true,
          matter_default: null,
        },
        {
          id: "form-null-request",
          target_module: "matter",
          contract_default: null,
          matter_default: true,
        },
      ]);
      const rows = (
        await db.execute(sql`select f.field_id, f.display_order, f.is_required, f.on_intake_form, f.visible_on_portal
      from contract_type_fields f join contract_types t on t.id = f.contract_type_id where t.slug = 'nda' and f.field_id like 'form-%' order by f.display_order`)
      ).rows;
      expect(rows).toEqual([
        {
          field_id: "form-business",
          display_order: 41,
          is_required: true,
          on_intake_form: true,
          visible_on_portal: true,
        },
        {
          field_id: "form-legal",
          display_order: 42,
          is_required: true,
          on_intake_form: true,
          visible_on_portal: false,
        },
      ]);
      const builtins = (
        await db.execute(
          sql`select builtin_key, is_required from contract_type_builtin_rows b join contract_types t on t.id = b.contract_type_id where t.slug = 'nda' and on_intake_form order by builtin_key`,
        )
      ).rows;
      expect(builtins).toEqual(
        [
          "counterparties",
          "effective_date",
          "entity",
          "expiry_date",
          "notice_period_days",
          "renewal_period_months",
          "term_type",
          "value",
        ].map((builtin_key) => ({ builtin_key, is_required: true })),
      );
      expect(
        (
          await db.execute(
            sql`select count(*)::int as count from request_type_fields where request_type_id = 'form-nda-request'`,
          )
        ).rows,
      ).toEqual([{ count: 12 }]);
      // The module-only and no-module Requests land their Fields on each Default type.
      expect(
        (
          await db.execute(sql`select f.field_id, f.is_required, f.on_intake_form
      from contract_type_fields f join contract_types t on t.id = f.contract_type_id where t.is_default`)
        ).rows,
      ).toEqual([{ field_id: "form-business", is_required: false, on_intake_form: true }]);
      expect(
        (
          await db.execute(sql`select f.field_id, f.is_required, f.on_intake_form
      from matter_type_fields f join matter_types t on t.id = f.matter_type_id where t.is_default`)
        ).rows,
      ).toEqual([{ field_id: "form-matter", is_required: true, on_intake_form: true }]);
      await expect(
        db.execute(
          sql`update request_types set target_module = null where id = 'form-null-request'`,
        ),
      ).rejects.toMatchObject({ cause: { code: "23502" } });
    } finally {
      await db.$client.end();
    }
  },
);

it.each([
  [
    "built-in has no matching Matter Row",
    "select 'unmapped', id, 1 from fields where built_in_key = 'effectiveDate'",
  ],
  ["Field sits outside the Matter module", "values ('unmapped', 'unmapped-contract-field', 1)"],
])("names a legacy Request whose %s", async (_, source) => {
  const db = await freshDb(container, `unmapped_${source.length}`);
  try {
    await migrateThrough(db, "0156_answer-style", migrationEntries());
    await db.execute(
      sql`insert into request_types (id, slug, display_name, display_order) values ('unmapped', 'unmapped', 'Unrouted question', 99)`,
    );
    await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag) values
      ('unmapped-contract-field', 'unmapped_contract_field', 'Counterparty name', 'contract', 'text', 'business')`);
    await db.execute(
      sql.raw(
        `insert into request_type_fields (request_type_id, field_id, display_order) ${source}`,
      ),
    );
    await expect(runMigrations(db)).rejects.toMatchObject({
      cause: { message: expect.stringContaining("Unrouted question") },
    });
  } finally {
    await db.$client.end();
  }
});
