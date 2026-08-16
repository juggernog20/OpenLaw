// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bringing stored credentials under the key in use (TECH-022,
 * [#259](https://github.com/juggernog20/OpenLaw/issues/259)).
 *
 * **Why a boot pass rather than a SQL migration.** The four credential
 * columns are sealed by application code with a key that lives outside
 * the database (see `secrets.ts`). A drizzle-kit migration is SQL run
 * by Postgres, which has no key and no cipher — so the one thing a
 * migration cannot do is encrypt these columns. This runs beside the
 * migrations instead, on the same boot, in the API process that holds
 * the key.
 *
 * **What it covers.** Two cases, and it cannot tell them apart until it
 * reads a row, which is why it is one pass:
 *
 * - **An upgrade.** Values written by a version before TECH-022 have no
 *   envelope prefix. They are read as they stand and written back
 *   sealed. This is what makes "existing installs migrate without
 *   manual re-entry" true rather than aspirational.
 * - **A rotation.** Values sealed under `OPENLAW_SECRET_KEY_PREVIOUS`
 *   are opened with the retiring key and written back under the new
 *   one. The deployer runs one boot with both variables set and then
 *   removes the old one.
 *
 * **A value no configured key opens is left exactly as it is.** That is
 * the row of somebody who lost the key, and overwriting it would turn a
 * recoverable mistake — put the right key back and boot again — into a
 * destroyed credential. It is counted and reported so the boot log says
 * so out loud, and the Settings pane already shows the credential as
 * absent, which is the other half of the recovery.
 *
 * **It writes with raw SQL on purpose.** A Drizzle update would fire
 * `$onUpdate` and stamp `updated_at`, so every boot would claim an
 * Administrator had just rotated the connector. Re-sealing a value is
 * not a change to the row.
 */

import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
// Type-only, so this module never imports the package root at runtime:
// the root re-exports this one, and a value import would close the loop.
import type { Db } from "./index.js";
import { ssoProviders } from "./schema/auth.js";
import { orgSettings } from "./schema/org.js";
import { signingConnectors } from "./schema/signing-connectors.js";
import { openSecret, sealSecret, sealedByCurrentKey } from "./secrets.js";

/** What one boot's pass did. Zero everywhere is the steady state, and the usual one. */
export interface SecretsRewrap {
  /** Values written back under the key in use, by column. */
  resealed: Record<string, number>;
  /** Values no configured key opened, left untouched, by column. */
  unreadable: Record<string, number>;
}

/** One sealed column, and how to reach its rows. */
interface SecretColumn {
  table: PgTable;
  /** The primary key, used to write one row back. */
  id: PgColumn;
  column: PgColumn;
}

/**
 * Every column `encryptedText` declares.
 *
 * A fifth credential column joins this list in the same change that
 * adds it — TECH-022's successor to TECH-021's "one more future pass
 * comment" failure mode.
 */
const SEALED_COLUMNS: SecretColumn[] = [
  { table: signingConnectors, id: signingConnectors.id, column: signingConnectors.privateKey },
  { table: signingConnectors, id: signingConnectors.id, column: signingConnectors.webhookSecret },
  { table: orgSettings, id: orgSettings.id, column: orgSettings.smtpUrl },
  { table: ssoProviders, id: ssoProviders.id, column: ssoProviders.oidcConfig },
];

async function rewrapColumn(
  db: Db,
  spec: SecretColumn,
): Promise<{ resealed: number; unreadable: number }> {
  // The column's own name is the seal's additional authenticated data
  // (see secrets.ts), so it is taken from the column rather than
  // restated here — a list that disagreed with the schema would open
  // nothing and say so only at run time.
  const name = spec.column.name;

  // Read the raw text rather than the mapped column: the point is to
  // look at what is actually stored, which the custom type would have
  // opened before we saw it.
  const stored = await db.execute<{ id: string; value: string | null }>(
    sql`SELECT ${spec.id} AS id, ${spec.column}::text AS value FROM ${spec.table}`,
  );

  let resealed = 0;
  let unreadable = 0;
  for (const row of stored.rows) {
    if (row.value === null) continue;
    if (sealedByCurrentKey(row.value, name)) continue;

    const opened = openSecret(row.value, name);
    if (opened === null) {
      // Sealed under a key this process does not have. Left alone —
      // see the module note.
      unreadable += 1;
      continue;
    }

    // Two things about this statement.
    //
    // `sql.identifier`, not the column object, because Postgres refuses
    // a table-qualified name on the left of a SET.
    //
    // And the WHERE names the exact value that was read, not only the
    // row. The advisory lock serializes the replicas running this pass;
    // it says nothing about the *old* replica still serving traffic
    // through a rolling upgrade. If an Administrator saves a new
    // credential between the SELECT above and this UPDATE, the
    // unqualified form would write the resealed old value over it and
    // lose a credential silently. Qualified, that row simply does not
    // match, and the next boot reseals whatever is there by then.
    const written = await db.execute(
      sql`UPDATE ${spec.table}
             SET ${sql.identifier(name)} = ${sealSecret(opened, name)}
           WHERE ${spec.id} = ${row.id}
             AND ${spec.column}::text = ${row.value}`,
    );
    if (written.rowCount === 0) continue;
    resealed += 1;
  }
  return { resealed, unreadable };
}

/**
 * Seals every stored credential under the key in use.
 *
 * The caller holds the advisory lock — see `rewrapSecrets` in the
 * package root, which is what boot code calls.
 */
export async function resealStoredSecrets(db: Db): Promise<SecretsRewrap> {
  const report: SecretsRewrap = { resealed: {}, unreadable: {} };
  for (const spec of SEALED_COLUMNS) {
    const done = await rewrapColumn(db, spec);
    if (done.resealed > 0) report.resealed[spec.column.name] = done.resealed;
    if (done.unreadable > 0) report.unreadable[spec.column.name] = done.unreadable;
  }
  return report;
}
