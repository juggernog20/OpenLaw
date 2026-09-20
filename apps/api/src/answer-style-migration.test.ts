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
