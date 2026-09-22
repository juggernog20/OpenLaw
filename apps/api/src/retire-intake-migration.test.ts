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
it("re-keys old Request answers without overwriting canonical answers and retires the schema", async () => {
  const db = await freshDb(container, "retire_intake");
  try {
    await migrateThrough(db, "0158_matter-record-preparation", migrationEntries());
    await db.execute(
      sql`insert into users (id, display_name, email, email_verified) values ('requester', 'Requester', 'old@example.test', true)`,
    );
    await db.execute(sql`insert into requests (id, request_type_id, requester_id, title, urgency, custom_fields)
      select 'old-answer', id, 'requester', 'Old answer', 'medium', ${JSON.stringify({
        __intake_contract_entityId: "our-entity",
        __intake_contract_counterparties: "Acme\nBeta\nAcme",
        __intake_contract_effectiveDate: "2026-01-01",
        __intake_contract_expiryDate: "2027-01-01",
        __intake_contract_termType: "Auto-renewing",
        __intake_contract_renewalPeriodMonths: 12,
        __intake_contract_noticePeriodDays: 30,
        __intake_contract_valueAmount: 1500.5,
        __intake_contract_valueCurrency: "USD",
        __intake_contract_valueCadence: "Monthly",
        expiry_date: "2028-01-01",
        ordinary_answer: "Keep me",
      })}::jsonb from request_types limit 1`);
    await db.execute(sql`create function refuse_shadow_delete() returns trigger language plpgsql as $$
      begin raise exception 'Simulated retirement failure'; end $$`);
    await db.execute(sql`create trigger refuse_shadow_delete before delete on fields
      for each row execute function refuse_shadow_delete()`);
    await expect(runMigrations(db)).rejects.toMatchObject({
      cause: { message: "Simulated retirement failure" },
    });
    expect(
      (
        await db.execute(
          sql`select custom_fields->>'__intake_contract_effectiveDate' as answer from requests where id = 'old-answer'`,
        )
      ).rows,
    ).toEqual([{ answer: "2026-01-01" }]);
    expect(
      (await db.execute(sql`select to_regclass('public.request_type_fields') as legacy`)).rows,
    ).toEqual([{ legacy: "request_type_fields" }]);
    await db.execute(sql`drop trigger refuse_shadow_delete on fields`);
    await db.execute(sql`drop function refuse_shadow_delete()`);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select custom_fields from requests where id = 'old-answer'`)).rows,
    ).toEqual([
      {
        custom_fields: {
          entity: "our-entity",
          counterparties: ["Acme", "Beta"],
          effective_date: "2026-01-01",
          expiry_date: "2028-01-01",
          term_type: "auto_renew",
          renewal_period_months: 12,
          notice_period_days: 30,
          value_amount: 150050,
          value_currency: "USD",
          value_cadence: "monthly",
          ordinary_answer: "Keep me",
        },
      },
    ]);
    expect(
      (await db.execute(sql`select slug from fields where slug like '\_\_intake\_%'`)).rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select to_regclass('public.request_type_fields') as legacy`)).rows,
    ).toEqual([{ legacy: null }]);
    expect(
      (
        await db.execute(
          sql`select column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'fields' and column_name in ('built_in_key', 'field_tag')) or (table_name = 'request_types' and column_name = 'form_field_order'))`,
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await db.$client.end();
  }
});

it("converts a pre-milestone Effective date onto the Contract after upgrade", async () => {
  const { startHarness, signInCookies, TEST_ADMIN } = await import("./testing/harness.js");
  const h = await startHarness({
    beforeMigrations: async (db) => {
      await migrateThrough(db, "0156_answer-style", migrationEntries());
      await db.execute(
        sql`insert into users (id, display_name, email, email_verified) values ('old-requester', 'Requester', 'old-convert@example.test', true)`,
      );
      await db.execute(sql`insert into request_type_fields (request_type_id, field_id, display_order)
      select rt.id, f.id, 1 from request_types rt cross join fields f where rt.slug = 'nda_request' and f.built_in_key = 'effectiveDate'`);
      await db.execute(sql`insert into requests (id, request_type_id, requester_id, title, urgency, custom_fields)
      select 'old-convert', id, 'old-requester', 'Upgrade NDA', 'medium', '{"__intake_contract_effectiveDate":"2026-01-01"}'::jsonb from request_types where slug = 'nda_request'`);
    },
  });
  try {
    const { provisionUser } = await import("./auth/instance.js");
    const admin = await provisionUser(h.app.auth, TEST_ADMIN);
    await h.db.execute(sql`update users set role = 'administrator' where id = ${admin.id}`);
    const cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const number = (
      await h.db.execute<{ number: number }>(
        sql`select number from requests where id = 'old-convert'`,
      )
    ).rows[0]!.number;
    const response = await h.app.inject({
      method: "POST",
      url: `/api/v1/requests/${number}/convert`,
      cookies,
      payload: { title: "Upgrade NDA" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      (
        await h.db.execute(
          sql`select effective_date from contracts where id = (select converted_contract_id from requests where id = 'old-convert')`,
        )
      ).rows,
    ).toEqual([{ effective_date: "2026-01-01" }]);
  } finally {
    await h.stop();
  }
});

it("keeps Auto-Doc mappings, prompt overrides and analysis provenance under canonical keys", async () => {
  const db = await freshDb(container, "builtin_metadata");
  const suggestion = {
    value: "Acme",
    citations: [{ sourceId: "request:old:title", revision: "one", quote: "Acme" }],
  };
  const evidence = { runId: "analysis", writtenAt: "2026-01-01T00:00:00Z", evidence: "Acme" };
  try {
    await migrateThrough(db, "0158_matter-record-preparation", migrationEntries());
    await db.execute(
      sql`insert into users (id, display_name, email, email_verified) values ('author', 'Author', 'author@example.test', true)`,
    );
    await db.execute(
      sql`insert into auto_docs (id, name, created_by, updated_by) values ('template', 'Old template', 'author', 'author')`,
    );
    await db.execute(
      sql`insert into auto_doc_form_versions (id, auto_doc_id, version_number, created_by, definition) values ('form', 'template', 1, 'author', ${JSON.stringify(
        {
          fields: [
            { slug: "party", contractAttribute: "primary_counterparty_name" },
            { slug: "company", contractAttribute: "entity_id" },
            { slug: "department", contractAttribute: "owning_department_id" },
            { slug: "custom", catalogFieldId: "untouched" },
          ],
        },
      )}::jsonb)`,
    );
    await db.execute(
      sql`insert into ai_field_prompts (slug, prompt) values ('counterparty', 'Preserve my prompt') on conflict (slug) do update set prompt = excluded.prompt`,
    );
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id, ai_unverified, analysis_human_fields)
      select 'contract', 'Existing', t.id, s.id, ${JSON.stringify({ counterparty: evidence })}::jsonb, '["counterparty", "effective_date"]'::jsonb from contract_types t cross join contract_statuses s limit 1`);
    await db.execute(sql`insert into contract_analysis_runs (id, contract_id, trigger, preset, model, source_context, outcome)
      values ('analysis', 'contract', 'conversion', 'openai', 'old-model', ${JSON.stringify({ requestId: "old", suggestions: { counterparty: suggestion } })}::jsonb,
      ${JSON.stringify({ written: ["counterparty"], kept: [], unsupported: [], invalid: [], results: [{ slug: "counterparty", value: "Acme", evidence: "Acme", outcome: "written" }] })}::jsonb)`);
    await db.execute(sql`insert into requests (id, request_type_id, requester_id, title, urgency)
      select 'old', id, 'author', 'Acme', 'medium' from request_types limit 1`);
    await db.execute(sql`insert into conversion_drafts (id, request_id, actor_id, target_module, target_type_id, snapshot, suggestions, conflicts)
      values ('draft', 'old', 'author', 'contract', 'type', 'old-snapshot', ${JSON.stringify({ counterparty: suggestion })}::jsonb, ${JSON.stringify({ counterparty: suggestion })}::jsonb)`);
    await runMigrations(db);
    expect(
      (
        await db.execute<{ definition: { fields: unknown[] } }>(
          sql`select definition from auto_doc_form_versions where id = 'form'`,
        )
      ).rows[0]!.definition.fields,
    ).toEqual([
      { slug: "party", contractAttribute: "counterparties" },
      { slug: "company", contractAttribute: "entity" },
      { slug: "department", contractAttribute: "owning_department" },
      { slug: "custom", catalogFieldId: "untouched" },
    ]);
    expect(
      (
        await db.execute(
          sql`select slug, prompt from ai_field_prompts where slug in ('counterparty', 'counterparties')`,
        )
      ).rows,
    ).toEqual([{ slug: "counterparties", prompt: "Preserve my prompt" }]);
    expect(
      (
        await db.execute(
          sql`select ai_unverified, analysis_human_fields from contracts where id = 'contract'`,
        )
      ).rows,
    ).toEqual([
      {
        ai_unverified: { counterparties: evidence },
        analysis_human_fields: ["counterparties", "effective_date"],
      },
    ]);
    const [run] = (
      await db.execute<{ source_context: unknown; outcome: unknown }>(
        sql`select source_context, outcome from contract_analysis_runs where id = 'analysis'`,
      )
    ).rows;
    expect(run).toMatchObject({
      source_context: { suggestions: { counterparties: suggestion } },
      outcome: {
        written: ["counterparties"],
        results: [{ slug: "counterparties", value: "Acme", evidence: "Acme", outcome: "written" }],
      },
    });
    expect(
      (
        await db.execute(
          sql`select suggestions, conflicts from conversion_drafts where id = 'draft'`,
        )
      ).rows,
    ).toEqual([
      { suggestions: { counterparties: suggestion }, conflicts: { counterparties: suggestion } },
    ]);
  } finally {
    await db.$client.end();
  }
});
