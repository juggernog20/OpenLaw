// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Migration 0060, the `accounts.issuer` backfill (#340), against a real
 * database.
 *
 * Lives in apps/api for the reason `migration-journal.test.ts` gives:
 * this is where the Postgres harness is, and packages/db has no test
 * runner. That file is also the prior art for migrating through a tag,
 * which is what this one needs.
 *
 * better-auth 1.7 identifies an account by (`issuer`, `account_id`)
 * rather than by its provider id, and its own credential lookups filter
 * on the issuer. Every other suite starts from a migrated empty
 * database, so the backfill never runs on a row in any of them — it can
 * only be asserted by putting an install into the state a real one is
 * in on 1.6 and then upgrading it.
 *
 * The failure mode is quiet and total: a credential row with the wrong
 * issuer is a user who cannot sign in and cannot reset a password, and
 * an SSO row with the wrong issuer re-links as a second identity on the
 * next sign-in. So the refusals are asserted too — this migration is
 * meant to stop an upgrade rather than complete a partial one.
 *
 * The last test signs in through `auth.api` rather than through a
 * mounted route, which is the one place this file steps outside the
 * house rule. `startHarness` migrates the database it creates, so it
 * cannot produce the thing under test: an install that stopped at 0059.
 * What is being asserted is not the route — nothing about it changed —
 * but whether better-auth accepts the row the backfill wrote, and
 * `signInEmail` is that lookup with nothing else around it. The same
 * journey over real HTTP, against a genuinely upgraded install, is the
 * upgrade-fidelity gate in e2e/scripts.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDb,
  readMigrationJournal,
  readSecretKeys,
  runMigrations,
  SECRET_KEY_VARIABLE,
  sql,
  useSecretKeys,
  type Db,
  type JournalEntry,
} from "@openlaw/db";
import { createAuth, CREDENTIAL_ISSUER } from "./auth/instance.js";
import { createUnconfiguredMailer } from "./lib/mailer.js";
import { TEST_AUTH_CONFIG, TEST_SECRET_KEY } from "./testing/harness.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

/** The last migration before the one under test. */
const BEFORE = "0059_intake_links";

/**
 * Every test here makes a new database and migrates it through 0059
 * before it starts. That does not fit the 5s default when the suite runs
 * with the rest of the file set, so the tests time out under CI load and
 * pass on their own. The work is real, so the timeout is what moves.
 */
vi.setConfig({ testTimeout: 60_000 });

let container: StartedPostgreSqlContainer;
let entries: JournalEntry[];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  entries = readMigrationJournal(MIGRATIONS);
  // The sealed-column key, as the API installs it at boot (TECH-022):
  // `sso_providers.oidc_config` is encrypted, so a suite that writes one
  // has to be holding a key.
  useSecretKeys(readSecretKeys({ [SECRET_KEY_VARIABLE]: TEST_SECRET_KEY }));
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

/** `createAuth`'s two collaborators, neither of which this suite uses. */
const unconfiguredMailer = async () => ({
  source: "unset" as const,
  from: null,
  mailer: createUnconfiguredMailer(),
});
const silent = { warn: () => {} };

/** A database of its own per scenario — each one writes bookkeeping. */
async function freshDb(name: string): Promise<Db> {
  const admin = createDb(container.getConnectionUri());
  await admin.execute(sql.raw(`create database "${name}"`));
  await admin.$client.end();
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  return createDb(url.toString());
}

/** Applies migrations up to and including `tag`, the way a past release did. */
async function migrateThrough(db: Db, tag: string): Promise<void> {
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key, hash text not null, created_at bigint)`);
  for (const entry of entries) {
    // One statement per round trip rather than one joined string: a
    // multi-statement query runs in an implicit transaction, and 0054's
    // `CREATE INDEX CONCURRENTLY` cannot.
    const statements = readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await db.execute(sql.raw(statement));
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${entry.hash}, ${entry.when})`,
    );
    if (entry.tag === tag) return;
  }
}

/** An install on 1.6: migrated to 0059, with rows and no issuer column. */
async function installOn16(name: string): Promise<Db> {
  const db = await freshDb(name);
  await migrateThrough(db, BEFORE);
  await db.execute(sql`insert into users (id, display_name, email, email_verified, role)
    values ('u-blair', 'Blair Wentworth', 'blair@example.com', true, 'administrator'),
           ('u-nadia', 'Nadia Counsel', 'nadia@acme.example', true, 'legal_team_member')`);
  return db;
}

/**
 * What the database said when the migration refused.
 *
 * Drizzle's own message is the SQL it sent, which quotes the `RAISE`
 * text verbatim — asserting on that would pass whether or not the
 * statement ever ran. The substituted message is on the cause, and it is
 * the only place the offending rows are actually named.
 */
async function refusal(db: Db): Promise<string> {
  try {
    await runMigrations(db);
  } catch (error) {
    return String((error as { cause?: unknown }).cause ?? error);
  }
  throw new Error("the migration was expected to refuse this install, and did not");
}

/** Every account row's issuer, keyed by account id. */
async function issuers(db: Db): Promise<Record<string, string | null>> {
  const rows = await db.execute<{ account_id: string; issuer: string | null }>(
    sql`select account_id, issuer from accounts`,
  );
  return Object.fromEntries(rows.rows.map((row) => [row.account_id, row.issuer]));
}

describe("the 0060 backfill", () => {
  it("gives a password row the issuer better-auth looks it up by", async () => {
    const db = await installOn16("issuer_credential");
    try {
      // A credential row as 1.6 wrote it: the subject is the user id.
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id, password)
        values ('a-1', 'u-blair', 'u-blair', 'credential', 'argon2id-hash')`);

      await runMigrations(db);

      expect(await issuers(db)).toEqual({ "u-blair": CREDENTIAL_ISSUER });
    } finally {
      await db.$client.end();
    }
  });

  it("gives an OIDC row its provider's own issuer", async () => {
    const db = await installOn16("issuer_oidc");
    try {
      await db.execute(sql`insert into sso_providers (id, issuer, domain, provider_id, user_id)
        values ('p-acme', 'https://idp.acme.example', 'acme.example', 'acme-idp', 'u-blair')`);
      // An SSO row as 1.6 wrote it: provider id is the provider's slug,
      // and the subject is the OIDC `sub`.
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id)
        values ('a-2', 'u-nadia', 'idp-nadia', 'acme-idp')`);

      await runMigrations(db);

      expect(await issuers(db)).toEqual({ "idp-nadia": "https://idp.acme.example" });
    } finally {
      await db.$client.end();
    }
  });

  it("fills a mixed install in one pass, and leaves nothing null", async () => {
    const db = await installOn16("issuer_mixed");
    try {
      await db.execute(sql`insert into sso_providers (id, issuer, domain, provider_id, user_id)
        values ('p-acme', 'https://idp.acme.example', 'acme.example', 'acme-idp', 'u-blair')`);
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id, password)
        values ('a-1', 'u-blair', 'u-blair', 'credential', 'argon2id-hash'),
               ('a-3', 'u-nadia', 'u-nadia', 'credential', 'argon2id-hash')`);
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id)
        values ('a-2', 'u-nadia', 'idp-nadia', 'acme-idp')`);

      await runMigrations(db);

      expect(await issuers(db)).toEqual({
        "u-blair": CREDENTIAL_ISSUER,
        "u-nadia": CREDENTIAL_ISSUER,
        "idp-nadia": "https://idp.acme.example",
      });
      // The column is real from here on, so a later row cannot omit it.
      const nulls = await db.execute<{ count: string }>(
        sql`select count(*) as count from accounts where issuer is null`,
      );
      expect(Number(nulls.rows[0]!.count)).toBe(0);
    } finally {
      await db.$client.end();
    }
  });
});

describe("the 0060 refusals", () => {
  it("stops the upgrade, naming the provider, when an account has no issuer to take", async () => {
    const db = await installOn16("issuer_stranded");
    try {
      // A provider row deleted while its accounts survived — the case the
      // issue called out as the one upstream cannot resolve for us.
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id)
        values ('a-2', 'u-nadia', 'idp-nadia', 'ghost-idp')`);

      expect(await refusal(db)).toContain("ghost-idp");

      // Refused, not half-applied. The migration runs in one
      // transaction, so the column it was adding is not there at all —
      // the install is exactly as the old image left it, which is what
      // makes stopping the upgrade the safe answer rather than a
      // half-migrated database nobody can sign in to.
      const columns = await db.execute<{ column_name: string }>(
        sql`select column_name from information_schema.columns
             where table_name = 'accounts' and column_name = 'issuer'`,
      );
      expect(columns.rows).toEqual([]);
    } finally {
      await db.$client.end();
    }
  });

  it("rolls back whole even when the same upgrade crosses 0054's COMMIT", async () => {
    // An install more than one release behind upgrades straight to this
    // one, so the batch drizzle applies includes 0054. That migration
    // opens with a literal `COMMIT;` — its CONCURRENTLY statements
    // cannot run inside the single transaction drizzle wraps a batch in
    // — and from there every later statement runs in autocommit. 0060
    // opens a transaction of its own so a refusal still applies
    // nothing. Without that, the ALTER would commit before the refusal
    // fired: the column would sit half-filled, and re-running the
    // upgrade after the fix would die on the duplicate column.
    const db = await freshDb("issuer_crossing");
    try {
      await migrateThrough(db, "0053_reminder_offsets");
      await db.execute(sql`insert into users (id, display_name, email, email_verified, role)
        values ('u-nadia', 'Nadia Counsel', 'nadia@acme.example', true, 'legal_team_member')`);
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id)
        values ('a-2', 'u-nadia', 'idp-nadia', 'ghost-idp')`);

      expect(await refusal(db)).toContain("ghost-idp");
      const columns = await db.execute<{ column_name: string }>(
        sql`select column_name from information_schema.columns
             where table_name = 'accounts' and column_name = 'issuer'`,
      );
      expect(columns.rows).toEqual([]);

      // The documented remedy, end to end: re-register the provider the
      // accounts point at, run the upgrade again, and it completes.
      await db.execute(sql`insert into sso_providers (id, issuer, domain, provider_id, user_id)
        values ('p-ghost', 'https://idp.ghost.example', 'ghost.example', 'ghost-idp', 'u-nadia')`);
      await runMigrations(db);
      expect(await issuers(db)).toEqual({ "idp-nadia": "https://idp.ghost.example" });
    } finally {
      await db.$client.end();
    }
  });

  it("stops the upgrade when two accounts would share one 1.7 identity", async () => {
    const db = await installOn16("issuer_collision");
    try {
      // Two providers registered against one IdP, each with a row for the
      // same subject. Distinct under 1.6's key, one identity under 1.7's.
      await db.execute(sql`insert into sso_providers (id, issuer, domain, provider_id, user_id)
        values ('p-a', 'https://idp.acme.example', 'acme.example', 'acme-idp', 'u-blair'),
               ('p-b', 'https://idp.acme.example', 'acme.example', 'acme-idp-2', 'u-blair')`);
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id)
        values ('a-2', 'u-nadia', 'idp-nadia', 'acme-idp'),
               ('a-3', 'u-blair', 'idp-nadia', 'acme-idp-2')`);

      // The pair itself, substituted — the two rows that would collide.
      expect(await refusal(db)).toContain("(https://idp.acme.example, idp-nadia)");
    } finally {
      await db.$client.end();
    }
  });
});

describe("the upgraded install", () => {
  it("signs a password account in that was written before 1.7 existed", async () => {
    const db = await installOn16("issuer_signin");
    try {
      const password = "correct-horse-battery"; // NOSONAR — fixture for a throwaway container
      // Hashing needs an auth instance, and this one is only borrowed for
      // its hasher: `password.hash` reads nothing and writes nothing, so
      // it is safe to build against a database that has no issuer column
      // yet. The row it produces is what 1.6 wrote — the same Argon2id
      // hash, keyed on (provider_id, account_id), with no issuer at all.
      const before = createAuth(db, TEST_AUTH_CONFIG, unconfiguredMailer, silent);
      const hash = await (await before.$context).password.hash(password);
      await db.execute(sql`insert into accounts (id, user_id, account_id, provider_id, password)
        values ('a-1', 'u-blair', 'u-blair', 'credential', ${hash})`);

      await runMigrations(db);

      // The whole point of the backfill: better-auth 1.7 looks a
      // credential row up by (issuer, account_id), so an account the
      // upgrade did not reach is a person locked out of their own
      // install. A fresh instance, because the schema moved under it.
      const after = createAuth(db, TEST_AUTH_CONFIG, unconfiguredMailer, silent);
      const session = await after.api.signInEmail({
        body: { email: "blair@example.com", password },
      });
      expect(session.user.email).toBe("blair@example.com");
    } finally {
      await db.$client.end();
    }
  });
});
