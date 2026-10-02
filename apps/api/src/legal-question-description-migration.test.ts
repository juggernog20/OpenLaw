// SPDX-License-Identifier: AGPL-3.0-only

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

const SHIPPED = "One-off question — no record is created up front.";
const PLAIN =
  "Ask Legal a one-off question. You get a request number, and Legal replies on the request.";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
}, 180_000);
afterAll(async () => container?.stop());

async function descriptionAfterUpgrade(name: string, edit?: string): Promise<unknown> {
  const db = await freshDb(container, name);
  try {
    await migrateThrough(db, "0192_invite-link-lifetime", migrationEntries());
    expect(
      (await db.execute(sql`select description from request_types where slug = 'legal_question'`))
        .rows[0],
    ).toEqual({ description: SHIPPED });
    if (edit !== undefined)
      await db.execute(
        sql`update request_types set description = ${edit} where slug = 'legal_question'`,
      );
    await runMigrations(db);
    return (
      await db.execute(sql`select description from request_types where slug = 'legal_question'`)
    ).rows[0];
  } finally {
    await db.$client.end();
  }
}

it("replaces the shipped Legal question description with one that names the Request (#1302)", async () => {
  expect(await descriptionAfterUpgrade("legal_question_default")).toEqual({ description: PLAIN });
});

it("keeps a Legal question description an Administrator already edited", async () => {
  const edited = "Quick questions for the legal team.";
  expect(await descriptionAfterUpgrade("legal_question_edited", edited)).toEqual({
    description: edited,
  });
});
