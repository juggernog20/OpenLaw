// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One version's extracted text (DOC-005), landed in M12/3.
 *
 * **It sits beside the version chain, never in it.** A `document_versions`
 * row is immutable (DOC-001): it describes bytes a person uploaded, and
 * nothing a machine derives afterwards belongs on it. So the derivation
 * gets its own table, keyed by the version it was derived from, and the
 * chain is never rewritten by a background job.
 *
 * **The row is the record of work owed, not only of work done.** It is
 * written `pending` inside the upload's own transaction, so a rolled-back
 * upload leaves nothing behind and a committed one always says a
 * derivation is due. The queue only wakes a worker; this row is what
 * makes the work durable, and what the M12/6 backfill sweep reads to
 * find versions that never got theirs.
 *
 * **The text is derived data, never a replacement preview** (DOC-005).
 * What the Document panel renders is always the original a person uploaded.
 * Search reads this text directly, and M32 text-mode Comparison reads two
 * rows to build its explicit no-formatting view.
 *
 * The display rendition's own table landed in M12/4 beside this one, in
 * `document-rendition.ts`. The `email_body` source landed in M12/5 with
 * the feature that writes it — the same way `generated_redline` still
 * waits for M32 in `document_versions.kind`.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documentVersions } from "./documents.js";
import { searchVector } from "./helpers.js";

/** Maximum extracted source characters admitted to one M25 vector (DOC-009).
 * The live value is baked into `document_text_search_vector` by
 * migration 0080; change both together. */
export const DOCUMENT_TEXT_SEARCH_CHARACTER_LIMIT = 1_000_000;

/**
 * Where a derivation has got to.
 *
 * Three states and no fourth: the work is owed, the text is there, or
 * the job gave up. Code branches on all three — the read answers
 * `pending` distinctly from a missing document so a caller can poll, and
 * the panel says "preparing" or "unavailable" from the same value — so
 * the set is fixed rather than admin-configurable.
 */
export const DERIVATION_STATES = ["pending", "ready", "failed"] as const;
export type DerivationState = (typeof DERIVATION_STATES)[number];

/**
 * Where the text came from (DOC-005).
 *
 * `native_layer` is a PDF that already carried its words. `ocr` is an
 * image-only scan the doc engine read as pictures of pages.
 * `rendition` is a Word document or a PowerPoint deck, read from the
 * PDF the pipeline converted it to (M12/4) — one extraction path, over
 * PDF, rather than a second reader per office format. `email_body` is
 * an uploaded MSG or EML, parsed in process (M12/5): its body is its
 * text, and no engine and no conversion were involved.
 *
 * The four are recorded rather than inferred because they are not
 * equally trustworthy: OCR text is a machine's reading of a photograph,
 * a rendition's text has been through a conversion, an email body is
 * exactly what a sender wrote, and a later feature that weighs a match —
 * search ranking, AI analysis — has to be able to tell which it is
 * holding.
 */
export const TEXT_SOURCES = ["native_layer", "ocr", "rendition", "email_body"] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

/**
 * The extracted text of one version.
 *
 * The primary key is the version's own id, so a version has exactly one
 * text row and re-running its extraction rewrites that row rather than
 * growing a pile of attempts.
 *
 * Cascades: a hard-deleted document (DOC-010) takes its chain, and the
 * chain takes what was derived from it. Lawful erasure has to erase what
 * the machine read as well as what the person uploaded.
 */
export const documentVersionText = pgTable(
  "document_version_text",
  {
    versionId: text("version_id")
      .primaryKey()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    state: text("state", { enum: DERIVATION_STATES }).notNull(),
    /** NULL until the text is there — a pending or failed row has read
     * nothing, so it can name no source. */
    source: text("source", { enum: TEXT_SOURCES }),
    /** An uploaded email's subject, stored by the same parse that writes
     * its body. Search uses it as that Document hit's title without
     * opening and parsing the stored message a second time (DOC-004).
     * NULL means this is not email, extraction has not completed, or
     * the parsed email carried no subject; all three fall back to the
     * Document title. */
    emailSubject: text("email_subject"),
    /** The words themselves. NULL for the same reason `source` is. An
     * empty string is a different fact and a legitimate one: a blank
     * scan was read successfully and had nothing on it. */
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the state last moved. The panel polls on it, and an operator
     * reads it to tell a job that is running from one that is wedged. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Only completed derivations contribute content. PostgreSQL
     * recomputes this stored value on every state/text write, so the
     * extraction worker is already the indexing path (TECH-014).
     *
     * The expression lives in `document_text_search_vector`, defined by
     * migration 0080 next to this column. It applies the `ready` gate
     * and `DOCUMENT_TEXT_SEARCH_CHARACTER_LIMIT`, and it catches the
     * 1 MB tsvector limit so a version full of serial numbers or OCR
     * noise keeps its text and is merely unindexed, rather than failing
     * the extraction write (DOC-009). */
    searchVector: searchVector("search_vector").generatedAlwaysAs(
      sql`document_text_search_vector("state", "text")`,
    ),
  },
  (table) => [
    check(
      "document_version_text_state_check",
      sql`${table.state} in ('pending', 'ready', 'failed')`,
    ),
    check(
      "document_version_text_source_check",
      sql`${table.source} is null or ${table.source} in ('native_layer', 'ocr', 'rendition', 'email_body')`,
    ),
    // Ready and "has text from a named source" are the same fact, so the
    // database holds them together rather than trusting every writer to.
    // A `ready` row with no text would answer a reader with silence that
    // looks like a blank page, and a `pending` row carrying text would
    // make a caller poll forever past an answer it already has.
    check(
      "document_version_text_ready_check",
      sql`(${table.state} = 'ready') = (${table.text} is not null and ${table.source} is not null)`,
    ),
    check(
      "document_version_text_email_subject_check",
      sql`${table.emailSubject} is null or ${table.source} = 'email_body'`,
    ),
    index("document_version_text_search_vector_idx").using("gin", table.searchVector),
  ],
);

export type DocumentVersionText = typeof documentVersionText.$inferSelect;
