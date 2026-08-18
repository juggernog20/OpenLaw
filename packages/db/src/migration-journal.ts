// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The migration journal's integrity, checked before the migrator runs
 * ([#330](https://github.com/juggernog20/OpenLaw/issues/330)).
 *
 * TECH-005 makes migrations run on container start, so this is the only
 * moment anybody looks: an operator upgrades, the container boots, and
 * whatever the migrator decides is what they get. Nothing downstream
 * re-checks it, which is why a wrong decision here is silent for ever.
 *
 * Drizzle decides what to apply from **one** number. It reads the newest
 * `created_at` in `drizzle.__drizzle_migrations` and applies a migration
 * only when that migration's journal stamp is *later* than it. The test
 * is against the newest recorded stamp, never against the set of
 * recorded hashes — so a stamp that is too high does not fail loudly. It
 * silently swallows every migration behind it, permanently.
 *
 * That is what `0049_contract_tasks` did: it shipped stamped later than
 * the migrations that follow it, and commit `fc91bae` corrected the
 * journal. Correcting the journal fixes a new install and cannot reach
 * one that already applied the bad stamp, because the wrong number is in
 * that database rather than in this repo.
 *
 * So two things happen here, in order, before `migrate()` runs: repair
 * the one stamp known to have shipped wrong, then refuse to boot if any
 * migration would still be skipped. The second is the general guard. The
 * first is the single case that guard would otherwise strand with no way
 * out but hand-written SQL.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./index.js";

/**
 * One journal entry, with the hash Drizzle identifies it by.
 *
 * `hash` is sha256 of the migration file's text — the same digest
 * `readMigrationFiles` computes and writes into the bookkeeping row. It
 * identifies a migration by its *content*, which is what lets the repair
 * below prove a row is the migration it claims to be before rewriting
 * that row's stamp.
 */
export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  hash: string;
}

interface RawJournal {
  entries?: { idx: number; tag: string; when: number }[];
}

/** Reads `meta/_journal.json` and hashes each migration file beside it. */
export function readMigrationJournal(migrationsFolder: string): JournalEntry[] {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as RawJournal;
  return (journal.entries ?? []).map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    when: entry.when,
    hash: createHash("sha256")
      .update(readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8"))
      .digest("hex"),
  }));
}

/**
 * Journal entries whose stamp does not increase with their position.
 *
 * This is the property the migrator's one-number comparison depends on,
 * and nothing enforced it before: `0049` reached `dev` stamped later than
 * `0050` and the build was green. The CI check calls this so the next
 * out-of-order stamp fails at the commit that writes it rather than in
 * somebody's database months later.
 *
 * **Read in the array's own order, not sorted by `idx`.** Drizzle walks
 * `journal.entries` exactly as serialized and never looks at `idx`, so
 * the array *is* the sequence — sorting first would check an order the
 * migrator does not use and could pass a journal it then mis-applies.
 * `idx` disagreeing with position is itself reported below, because a
 * journal where the two have diverged is one nobody should be reading
 * past.
 *
 * Returns a human-readable line per offending entry, empty when the
 * journal is sound.
 */
export function findJournalDisorder(entries: JournalEntry[]): string[] {
  const problems: string[] = [];
  for (const [position, entry] of entries.entries()) {
    if (entry.idx !== position) {
      problems.push(
        `${entry.tag} sits at position ${position} carrying idx ${entry.idx}. ` +
          `The migrator applies entries in the order they are written, so the two must agree.`,
      );
    }
    const previous = entries[position - 1];
    if (!previous) continue;
    if (entry.when <= previous.when) {
      problems.push(
        `${entry.tag} is stamped ${entry.when}, which is not later than ${previous.tag} (${previous.when}). ` +
          `An install that applies ${previous.tag} will skip ${entry.tag} for ever.`,
      );
    }
  }
  return problems;
}

/**
 * The stamps known to have shipped wrong, by the tag that carried them.
 *
 * Deliberately a list of *one known-wrong value* rather than a general
 * "make the database agree with the journal" pass. Aligning every
 * recorded stamp to the journal would also rewrite a row an operator has
 * a real reason to hold — a hand-repaired database, a restored backup —
 * and this code runs unattended at boot. It repairs what shipped broken
 * and nothing else; anything it does not recognise falls through to the
 * refusal below, where a person decides.
 *
 * The corrected value is not stored here. It is read from the journal,
 * which is the source of truth for what a migration's stamp should be.
 */
const KNOWN_BAD_STAMPS: { tag: string; recorded: number }[] = [
  // Shipped 1787130000000 — later than 0050, 0051 and 0052, so an
  // install that applied it before fc91bae skips all three. Corrected in
  // the journal to 1786930000000.
  //
  // The hash match below works because `fc91bae` changed the journal
  // alone: `0049_contract_tasks.sql` has one commit in its history and
  // has never been edited, so the digest a stranded database recorded is
  // still the digest this file hashes to. If that file were ever
  // rewritten, this entry would stop matching and the install would fall
  // through to the refusal — which is the safe direction to fail.
  { tag: "0049_contract_tasks", recorded: 1787130000000 },
];

export interface JournalGuardOutcome {
  /** Tags whose recorded stamp this pass rewrote. */
  repaired: string[];
}

/** Drizzle's own bookkeeping table — schema and name are its defaults. */
const BOOKKEEPING = sql`drizzle.__drizzle_migrations`;

interface RecordedMigration extends Record<string, unknown> {
  hash: string;
  created_at: string | number | null;
}

/**
 * Repairs the known-bad stamp, then refuses to continue if any migration
 * would still be skipped.
 *
 * Throws rather than logging: an install whose schema is three
 * migrations behind is not degraded, it is wrong, and every request it
 * serves writes against a shape the code does not expect. The failure
 * this replaces was a missing table at query time, far from the cause.
 *
 * Safe on a fresh database — with no bookkeeping table there is nothing
 * recorded, nothing to repair, and nothing that can be skipped.
 */
export async function guardMigrationJournal(
  db: Db,
  migrationsFolder: string,
): Promise<JournalGuardOutcome> {
  const entries = readMigrationJournal(migrationsFolder);
  const outcome: JournalGuardOutcome = { repaired: [] };

  // A database that has never been migrated has no bookkeeping table.
  // `to_regclass` answers without raising, unlike a plain select.
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!present.rows[0]?.exists) return outcome;

  // 1. Repair. Matched on the stamp *and* the content hash, so a row
  // that merely shares the number is left alone.
  for (const known of KNOWN_BAD_STAMPS) {
    const entry = entries.find((candidate) => candidate.tag === known.tag);
    if (!entry) continue;
    const written = await db.execute(
      sql`update ${BOOKKEEPING}
             set created_at = ${entry.when}
           where created_at = ${known.recorded}
             and hash = ${entry.hash}`,
    );
    if (written.rowCount) outcome.repaired.push(entry.tag);
  }

  // 2. Detect, on what the table says *after* the repair.
  const recorded = await db.execute<RecordedMigration>(
    sql`select hash, created_at from ${BOOKKEEPING}`,
  );
  if (recorded.rows.length === 0) return outcome;

  const appliedHashes = new Set(recorded.rows.map((row) => row.hash));
  const newestApplied = Math.max(...recorded.rows.map((row) => Number(row.created_at ?? 0)));

  // Drizzle applies an entry only when `newestApplied < entry.when`, so
  // anything pending at or below that line is silently skipped.
  const stranded = entries.filter(
    (entry) => !appliedHashes.has(entry.hash) && entry.when <= newestApplied,
  );
  if (stranded.length === 0) return outcome;

  throw new Error(
    [
      "This database cannot apply the migrations it is missing.",
      "",
      `The newest applied migration is stamped ${newestApplied}. These migrations are stamped at or before it, so the migrator will skip them silently and permanently:`,
      ...stranded.map((entry) => `  - ${entry.tag} (stamped ${entry.when})`),
      "",
      "That happens when a stamp recorded in drizzle.__drizzle_migrations is later than migrations that come after it.",
      "Refusing to start: serving traffic on a schema this far behind writes data against the wrong shape.",
      "",
      "See docs/DEPLOYMENT.md — 'A stranded migration journal' — for the repair.",
    ].join("\n"),
  );
}
