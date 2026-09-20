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

it("defaults existing and new connectors to sentence and deletes only rule overrides", async () => {
  const db = await freshDb(container, "answer_styles");
  try {
    await migrateThrough(db, "0152_conversion-draft-notice", migrationEntries());
    await db.execute(sql`insert into ai_connector (id, preset, protocol, base_url, model)
      values ('old', 'ollama', 'openai_chat_completions', 'http://localhost', 'fixture')`);
    await db.execute(sql`insert into ai_field_prompts (slug, prompt) values
      ('rules.evidence', 'old override'), ('rules.future', 'old override'),
      ('conversion.title', 'Keep title'), ('effective_date', 'Keep date')`);
    await runMigrations(db);
    expect((await db.execute(sql`select answer_style from ai_connector`)).rows).toEqual([
      { answer_style: "sentence" },
    ]);
    expect(
      (await db.execute(sql`select slug, prompt from ai_field_prompts order by slug`)).rows,
    ).toEqual([
      { slug: "conversion.title", prompt: "Keep title" },
      { slug: "effective_date", prompt: "Keep date" },
    ]);
    await db.execute(sql`delete from ai_connector`);
    await db.execute(sql`insert into ai_connector (id, preset, protocol, base_url, model)
      values ('new', 'ollama', 'openai_chat_completions', 'http://localhost', 'fixture')`);
    expect((await db.execute(sql`select answer_style from ai_connector`)).rows).toEqual([
      { answer_style: "sentence" },
    ]);
    await expect(
      db.execute(sql`update ai_connector set answer_style = 'invalid'`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.execute(sql`update ai_connector set answer_style = null`),
    ).rejects.toMatchObject({ cause: { code: "23502" } });
  } finally {
    await db.$client.end();
  }
});

it("rolls back the whole migration after an earlier migration leaves autocommit enabled", async () => {
  const db = await freshDb(container, "answer_style_rollback");
  try {
    await migrateThrough(db, "0147_individual-holdings", migrationEntries());
    await db.execute(
      sql`insert into ai_field_prompts (slug, prompt) values ('rules.scope', 'Keep until upgrade succeeds')`,
    );
    await db.execute(sql`create function refuse_rule_delete() returns trigger language plpgsql as $$
      begin raise exception 'Simulated delete failure'; end $$`);
    await db.execute(sql`create trigger refuse_rule_delete before delete on ai_field_prompts
      for each row execute function refuse_rule_delete()`);
    await expect(runMigrations(db)).rejects.toMatchObject({
      cause: { message: "Simulated delete failure" },
    });
    expect(
      (
        await db.execute(sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'ai_connector' and column_name = 'answer_style'`)
      ).rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select prompt from ai_field_prompts where slug = 'rules.scope'`)).rows,
    ).toEqual([{ prompt: "Keep until upgrade succeeds" }]);
    await db.execute(sql`drop trigger refuse_rule_delete on ai_field_prompts`);
    await db.execute(sql`drop function refuse_rule_delete()`);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select slug from ai_field_prompts where slug like 'rules.%'`)).rows,
    ).toEqual([]);
  } finally {
    await db.$client.end();
  }
});

it("leaves existing Fields on Organisation default and constrains overrides", async () => {
  const db = await freshDb(container, "field_answer_styles");
  try {
    await migrateThrough(db, "0154_ai-answer-style", migrationEntries());
    await runMigrations(db);
    expect((await db.execute(sql`select ai_answer_style from fields`)).rows.length).toBeGreaterThan(
      0,
    );
    expect(
      (await db.execute(sql`select ai_answer_style from fields where ai_answer_style is not null`))
        .rows,
    ).toEqual([]);
    await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag, ai_answer_style)
      values ('style-fixture', 'style_clause', 'Clause', 'contract', 'long_text', 'legal', 'full_clause')`);
    for (const style of ["few_words", "sentence", "full_clause", null]) {
      await db.execute(
        sql`update fields set ai_answer_style = ${style} where slug = 'style_clause'`,
      );
    }
    await expect(
      db.execute(sql`update fields set ai_answer_style = 'invalid' where slug = 'style_clause'`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.execute(sql`update fields set ai_answer_style = 'full_clause' where field_type = 'text'`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.execute(
      sql`update fields set ai_answer_style = 'sentence' where slug = 'style_clause'`,
    );
    for (const fieldType of ["number", "boolean", "user", "entity"]) {
      await expect(
        db.execute(sql`update fields set field_type = ${fieldType} where slug = 'style_clause'`),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    }
    await expect(
      db.execute(sql`update fields set module_scope = 'matter' where slug = 'style_clause'`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally {
    await db.$client.end();
  }
});
