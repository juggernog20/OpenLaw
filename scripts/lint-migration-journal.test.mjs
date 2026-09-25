// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./lint-migration-journal.mjs", import.meta.url));

/**
 * Runs the gate against a repo that holds only the given migrations.
 * The script finds the migrations from its own path, so it is copied
 * into a scratch repo of the same layout.
 */
function lint(migrations) {
  const root = mkdtempSync(path.join(tmpdir(), "openlaw-migration-lint-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(script, path.join(root, "scripts", "lint-migration-journal.mjs"));
    const dir = path.join(root, "packages", "db", "migrations");
    mkdirSync(path.join(dir, "meta"), { recursive: true });
    const entries = Object.entries(migrations).map(([tag, sql], idx) => {
      writeFileSync(path.join(dir, `${tag}.sql`), sql);
      return { idx, version: "7", when: 1_790_000_000_000 + idx, tag, breakpoints: true };
    });
    writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ entries }));
    return spawnSync(process.execPath, [path.join(root, "scripts", "lint-migration-journal.mjs")], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const preamble = "COMMIT;--> statement-breakpoint\nBEGIN;--> statement-breakpoint\n";

test("the real migrations pass", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("a file that leaves its own BEGIN open passes", () => {
  const result = lint({
    "0900_open": `${preamble}ALTER TABLE "a" ADD COLUMN "b" text;--> statement-breakpoint\nUPDATE "a" SET "b" = 'x';`,
    "0901_plain": `ALTER TABLE "a" ADD COLUMN "c" text;`,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a file whose last transaction statement is COMMIT fails", () => {
  const result = lint({
    "0900_closed": `${preamble}ALTER TABLE "a" ADD COLUMN "b" text;--> statement-breakpoint\nCOMMIT;\n`,
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /0900_closed ends outside a transaction: its last transaction statement is COMMIT/,
  );
});

test("a file that validates after a COMMIT and never reopens fails", () => {
  const result = lint({
    "0900_validate": [
      preamble,
      `ALTER TABLE "a" ADD CONSTRAINT "a_b" CHECK ("b" <> '') NOT VALID;--> statement-breakpoint`,
      "COMMIT;--> statement-breakpoint",
      `ALTER TABLE "a" VALIDATE CONSTRAINT "a_b";`,
    ].join("\n"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0900_validate ends outside a transaction/);
});

test("a file that reopens a transaction after CONCURRENTLY passes", () => {
  const result = lint({
    "0900_concurrently": [
      "COMMIT;--> statement-breakpoint",
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "a_b_idx" ON "a" ("b");--> statement-breakpoint`,
      "BEGIN;",
    ].join("\n"),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("comments, strings and DO blocks do not count as transaction statements", () => {
  const result = lint({
    "0900_bodies": [
      "-- The file's own COMMIT; is not here.",
      preamble,
      "/* COMMIT; */",
      `INSERT INTO "notes" ("body") VALUES ('done; COMMIT');--> statement-breakpoint`,
      "DO $$",
      "BEGIN",
      "  BEGIN",
      "    PERFORM 1;",
      "  END;",
      "END $$;--> statement-breakpoint",
      "DO $body$ BEGIN COMMIT; END $body$;",
    ].join("\n"),
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a dollar sign inside a name does not hide a trailing COMMIT", () => {
  const result = lint({
    "0900_dollar_name": `${preamble}ALTER TABLE "a" ADD COLUMN price$usd$ numeric;--> statement-breakpoint\nCOMMIT;`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0900_dollar_name ends outside a transaction/);
});

test("a file applied before the rule keeps its trailing COMMIT", () => {
  const result = lint({
    "0160_document_types": `${preamble}ALTER TABLE "a" ADD COLUMN "b" text;--> statement-breakpoint\nCOMMIT;`,
  });
  assert.equal(result.status, 0, result.stderr);
});
