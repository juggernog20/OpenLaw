/* OpenLaw — migration journal gate (#330).
 *
 * Drizzle applies a migration only when its journal stamp is later than
 * the newest stamp already recorded in the database. That makes the
 * journal's order load-bearing: an entry stamped earlier than the one
 * before it is a migration that some install will skip silently and
 * permanently, with no error at the time and a missing table much later.
 *
 * `0049_contract_tasks` reached `dev` stamped later than the three
 * migrations after it and CI was green, because nothing read the journal.
 * This is the check that was missing.
 *
 * It asserts three things:
 *   - every entry's `when` is strictly later than the entry before it;
 *   - every entry has a migration file on disk;
 *   - every migration file on disk has an entry.
 *
 * Failures are fixed by correcting the journal — but note that a
 * correction only helps installs that have not applied the bad stamp
 * yet. See guardMigrationJournal in @openlaw/db for the repair side.
 *
 * Runs standalone (`pnpm lint:migrations`) and inside `pnpm check`.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(repoRoot, "packages", "db", "migrations");
const journalPath = join(migrationsDir, "meta", "_journal.json");

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
if (typeof journal !== "object" || journal === null || Array.isArray(journal)) {
  fail("the journal is not a JSON object");
}
if (!Array.isArray(journal.entries)) {
  fail('"entries" is missing or not an array — a journal with no readable entries applies nothing');
}
// The array's own order, never sorted: the migrator walks `entries` as
// serialized and never reads `idx`, so this array *is* the sequence.
const entries = journal.entries;

// Check the shape before comparing anything. An entry missing `when`
// compares false against every stamp, so a malformed journal would sail
// through the checks below and report itself in order.
for (const [position, entry] of entries.entries()) {
  const where = `entry at position ${position}`;
  if (typeof entry !== "object" || entry === null) fail(`${where}: expected an object`);
  if (!Number.isInteger(entry.idx)) fail(`${where}: "idx" must be a whole number`);
  if (typeof entry.tag !== "string" || entry.tag.length === 0) {
    fail(`${where}: "tag" must be a non-empty string`);
  }
  if (!Number.isFinite(entry.when)) {
    fail(`${where}: "when" must be a number — it is the stamp the migrator compares`);
  }
}

function fail(message) {
  console.error(`migration journal: ${journalPath} is malformed`);
  console.error(`  ${message}`);
  process.exit(1);
}

/** Sha256 of a migration's text — the digest recorded in the database. */
function hashOf(tag) {
  return createHash("sha256")
    .update(readFileSync(join(migrationsDir, `${tag}.sql`), "utf8"))
    .digest("hex");
}

// `--hashes` prints the tag/stamp/hash table an operator needs to read a
// `drizzle.__drizzle_migrations` row back to the migration it stands for.
// Repairing a stranded install means editing one bookkeeping row, and the
// row only carries a hash — without this mapping, identifying the right
// one is guesswork. See docs/DEPLOYMENT.md.
if (process.argv.includes("--hashes")) {
  console.log("tag\twhen\thash");
  for (const entry of entries) console.log(`${entry.tag}\t${entry.when}\t${hashOf(entry.tag)}`);
  process.exit(0);
}

const failures = [];

for (const [position, entry] of entries.entries()) {
  if (entry.idx !== position) {
    failures.push(
      `${entry.tag} sits at position ${position} carrying idx ${entry.idx} — ` +
        `the migrator applies entries in written order, so the two must agree`,
    );
  }
  const previous = entries[position - 1];
  if (!previous) continue;
  if (entry.when <= previous.when) {
    failures.push(
      `${entry.tag} is stamped ${entry.when}, not later than ${previous.tag} (${previous.when}) — ` +
        `an install that applies ${previous.tag} will skip ${entry.tag} for ever`,
    );
  }
}

const onDisk = new Set(
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -".sql".length)),
);
const inJournal = new Set(entries.map((entry) => entry.tag));

for (const entry of entries) {
  if (!onDisk.has(entry.tag)) {
    failures.push(`${entry.tag} is in the journal with no ${entry.tag}.sql beside it`);
  }
}
for (const tag of [...onDisk].sort()) {
  if (!inJournal.has(tag)) {
    failures.push(`${tag}.sql is on disk with no journal entry — it will never be applied`);
  }
}

if (failures.length > 0) {
  console.error(`migration journal: ${failures.length} problem(s) in ${journalPath}`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "A migration's journal stamp must increase with its position — the migrator compares stamps, not names.",
  );
  process.exit(1);
}

console.log(`migration journal: ${entries.length} entries in order, each with its file (#330)`);
