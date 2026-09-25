/* OpenLaw migration journal gate (#330).
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
 * Fix a failure by correcting the journal. A correction only helps
 * installs that have not applied the bad stamp yet. See
 * guardMigrationJournal in @openlaw/db for the repair side.
 *
 * It also refuses a migration that ends outside a transaction (#1119).
 * The migrator runs the whole batch in one transaction and sends its own
 * COMMIT at the end. A file whose last transaction statement is COMMIT
 * leaves the next file, and every journal row after it, in autocommit,
 * so a failure later in the batch keeps the DDL that ran before it.
 * TECH-006's addendums have the rule and the fix.
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

/** Sha256 of a migration's text, the digest recorded in the database. */
function hashOf(tag) {
  return createHash("sha256")
    .update(readFileSync(join(migrationsDir, `${tag}.sql`), "utf8"))
    .digest("hex");
}

// `--hashes` prints the tag/stamp/hash table an operator needs to read a
// `drizzle.__drizzle_migrations` row back to the migration it stands for.
// Repairing a stranded install means editing one bookkeeping row, and the
// row only carries a hash. Without this mapping, identifying the right
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

// These files were applied before the rule existed and end in autocommit.
// The boot guard matches applied files by hash, so they cannot change.
// Every file after them that must be atomic opens its own transaction,
// which TECH-006's #390 preamble does on every upgrade path.
const endsInAutocommitBeforeRule = new Set([
  "0054_reminder_dedup_entity_type",
  "0055_document_version_draft_theirs",
  "0060_account_issuer",
  "0064_keyset_id_tiebreak",
  "0065_approver_group_name_unique",
  "0066_envelope_signer_email_unique",
  "0068_glorious_mockingbird",
  "0069_document_version_generated_kind",
  "0070_nappy_thunderbolt",
  "0077_fearless_maximus",
  "0079_gigantic_lester",
  "0084_lush_ender_wiggin",
  "0088_document-version-provenance",
  "0093_matter_status_groups_and_documents",
  "0132_auto-doc-acknowledgement-policy",
  "0134_authentication-methods",
  "0135_regions",
  "0136_matter-region",
  "0137_custom-value-cadence",
  "0148_fields-system-default",
  "0155_saved-ai-keys",
  "0158_matter-record-preparation",
  "0160_document_types",
  "0161_document_types_without_knowledge",
]);

const autocommitFailures = [];
for (const entry of entries) {
  if (endsInAutocommitBeforeRule.has(entry.tag)) continue;
  const text = readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8");
  const last = lastTransactionStatement(text);
  if (last !== null && !/^(BEGIN|START TRANSACTION)\b/.test(last)) {
    autocommitFailures.push(
      `${entry.tag} ends outside a transaction: its last transaction statement is ${last}`,
    );
  }
}

if (autocommitFailures.length > 0) {
  console.error(
    `migration transactions: ${autocommitFailures.length} problem(s) in ${migrationsDir}`,
  );
  for (const failure of autocommitFailures) console.error(`  ${failure}`);
  console.error(
    "Leave the file's own BEGIN open. The migrator's COMMIT at the end of the batch closes it. " +
      "A file that runs statements outside a transaction, such as CREATE INDEX CONCURRENTLY or a " +
      "VALIDATE CONSTRAINT after its locks are released, ends with BEGIN;.",
  );
  process.exit(1);
}

console.log(
  `migration journal: ${entries.length} entries in order, each with its file (#330), ` +
    `none new ending in autocommit (#1119)`,
);

/**
 * The last statement in a migration that opens or closes a transaction,
 * upper-cased with its whitespace collapsed, or null if there is none.
 *
 * Comments, quoted strings and dollar-quoted bodies are skipped, so the
 * BEGIN and END of a DO block do not count. Comments here often carry an
 * apostrophe, so a quote is only a string when it starts outside one.
 */
function lastTransactionStatement(text) {
  const dollarTag = /^\$([A-Za-z_]\w*)?\$/;
  const statements = [];
  let current = "";
  let at = 0;
  while (at < text.length) {
    if (text.startsWith("--", at)) {
      const end = text.indexOf("\n", at);
      at = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      at = end === -1 ? text.length : end + 2;
    } else if (text[at] === "'" || text[at] === '"') {
      const quote = text[at];
      let end = at + 1;
      while (end < text.length) {
        if (text[end] === quote && text[end + 1] === quote) end += 2;
        else if (text[end] === quote) break;
        else end += 1;
      }
      current += " ";
      at = end + 1;
    } else if (dollarTag.test(text.slice(at, at + 64))) {
      const tag = text.slice(at, at + 64).match(dollarTag)[0];
      const end = text.indexOf(tag, at + tag.length);
      current += " ";
      at = end === -1 ? text.length : end + tag.length;
    } else if (text[at] === ";") {
      statements.push(current);
      current = "";
      at += 1;
    } else {
      current += text[at];
      at += 1;
    }
  }
  statements.push(current);

  const control =
    /^(BEGIN|START TRANSACTION)\b|^(COMMIT|END|ROLLBACK|ABORT)( (WORK|TRANSACTION))?$/;
  let last = null;
  for (const statement of statements) {
    const words = statement.trim().replace(/\s+/g, " ").toUpperCase();
    if (control.test(words)) last = words;
  }
  return last;
}
