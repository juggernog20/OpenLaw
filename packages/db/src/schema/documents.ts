// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The file layer's two tables (DOC-001, DOC-002): the logical
 * `documents` record, and the immutable `document_versions` chain under
 * it. They land together in M11/2, the first step that stores a file at
 * all, and they carry only the columns that step reads and writes
 * (TECH-014). SCHEMA.md is the naming reference for the rest.
 *
 * M11/4 adds `executed_version_id`, the CTR-014 pin, beside
 * `contracts.primary_document_id`, which is the other half of the same
 * decision: the contract names the instrument, the document names its
 * signed version.
 *
 * M11/5 adds `archived_at`, DOC-010's soft delete, and the two indexes
 * the same step's hard delete needs on the two designation foreign
 * keys — each on the column that holds the reference:
 * `documents.executed_version_id` here, and
 * `contracts.primary_document_id` beside it.
 *
 * What is deliberately not here yet, and the step that brings it:
 * `is_confidential` (DD-014's per-document flag), `folder_id`
 * (DOC-006), and the version chain's `source` plus the two
 * comparison-provenance columns (M32's generated redlines). Each
 * arrives with the feature that reads it.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { contracts } from "./contracts.js";
import { uuidPk } from "./helpers.js";

/**
 * What a version is, in the negotiation's own words (CTR-014). The five
 * uploaded kinds land here; `generated_redline` waits for redline
 * compare (M32), which is the first feature that writes one.
 *
 * Code branches on the kind — the chain view colours it, and the
 * executed pin is offered against it — so the set is fixed rather than
 * admin-configurable.
 */
export const DOCUMENT_VERSION_KINDS = [
  "draft_ours",
  "redline_theirs",
  "redline_ours",
  "executed",
  "amendment",
] as const;
export type DocumentVersionKind = (typeof DOCUMENT_VERSION_KINDS)[number];

/**
 * The logical file record (DOC-001). It holds identity and ownership;
 * the bytes live in the version chain, never here.
 *
 * **Exactly one owning record** (DOC-008): a matter, a contract, an
 * entity, or a knowledge item, and there is no such thing as a
 * standalone document. The owner set is a set of one in M11 — a
 * contract — and the other three FK columns land with their own modules
 * (M22, M27, M28). `contract_id` is therefore `NOT NULL` here: with one
 * owner declared, that is the exactly-one-owner rule stated exactly, and
 * it costs nothing to hold. The migration that adds a second owner
 * column relaxes it and moves the rule into the application check
 * DOC-008 describes, which is the only place a one-of-four rule can
 * live.
 *
 * No cascade on the contract: a contract is archived, never deleted, and
 * its paper outlives an accident. Hard deletion (DOC-010) is its own
 * route in M11/5, and it removes stored blobs as well as rows.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuidPk(),
    /** What the record is called. Seeded from the uploaded filename,
     * and renameable from there (DOC-007) — the files themselves are
     * never touched by it. */
    title: text("title").notNull(),
    /** What the record is, in the team's own words (DOC-007). Standard
     * metadata and the only prose the record carries: there are no tags
     * and no custom fields on a document. NULL when nobody wrote one. */
    description: text("description"),
    /** DOC-008's owning record, and the whole access answer in front of
     * this row: a viewer who cannot reach the contract cannot reach its
     * documents (DD-014, CTR-021). */
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    /**
     * CTR-014's executed pin: which version of this document is the
     * signed one (M11/4). It is the file previews, exports, and AI
     * analysis target by default.
     *
     * **Explicit, and never inferred from a version's kind.** A version
     * tagged `executed` is what the uploader called that round; the pin
     * is what the team decided is the signed copy, and the two are set
     * by different acts. NULL is the answer for every document nobody
     * has pinned a version on, which is most of them.
     *
     * **Same-document invariant** (DOC-001): the named row must be a
     * version of *this* document. It is enforced at write time — the
     * route reads the version by its id **and** this document's id
     * inside the same locked transaction, so a version of another
     * document is not found rather than pinned. A composite FK is the
     * decision's stated alternative; it is not taken, because
     * `(id, executed_version_id) → (document_id, id)` cannot carry the
     * plain `SET NULL` that hard deletion (DOC-010) needs without
     * nulling the primary key beside it.
     *
     * SET NULL on delete: versions are never deleted one at a time
     * (DOC-001), so this fires only when the whole document goes.
     */
    // The return type is written out because the reference closes a
    // cycle — this table names a version, and a version names this
    // table — and TypeScript cannot infer a type that depends on
    // itself. It is the annotation Drizzle documents for exactly this.
    executedVersionId: text("executed_version_id").references(
      (): AnyPgColumn => documentVersions.id,
      {
        onDelete: "set null",
      },
    ),
    /**
     * DOC-010's soft delete: when this document left the record's lists
     * and its count, or NULL while it is on them (M11/5).
     *
     * It answers the wrong upload, and it destroys nothing — the row
     * stays, the chain stays, and the blobs stay, so restoring it is one
     * write. Lawful erasure is the other removal DOC-010 gives, and it
     * is a whole different route: Administrator-only, typed
     * confirmation, and no row left to hold a time.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // No cascade, as everywhere a record names a person: someone is
    // archived, never deleted (SET-005).
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The one read the record page makes: this contract's documents,
    // newest first.
    index("documents_contract_idx").on(table.contractId, table.createdAt),
    // The executed pin's own column — the referencing side of the
    // foreign key into `document_versions` (M11/5). No read filters on
    // it, so it carried no index until now: what needs one is DOC-010's
    // hard delete. Removing a version row makes Postgres check every
    // document for one pointing at it, and without an index that check
    // is a sequential scan of `documents` per deleted version — the cost
    // the M11/4 review parked until this step.
    index("documents_executed_version_idx").on(table.executedVersionId),
  ],
);

export type Document = typeof documents.$inferSelect;

/**
 * One immutable file snapshot (DOC-001). Versions are numbered 1..n per
 * document, strictly linear, and **never edited or deleted
 * individually** — a correction appends a new version.
 *
 * There is no `updated_at`, and its absence is the decision: a row that
 * is never updated has no such time to record.
 *
 * Beside the chain columns, each row carries the file facts the
 * uploaded bytes are described by — the original filename, the MIME
 * type the browser declared, the byte size the server counted, and the
 * SHA-256 checksum the server computed while streaming. They are
 * recorded rather than derived later because the blob behind
 * `file_ref` is immutable: the facts cannot drift from it, and a
 * checksum written at upload is what makes a later integrity check
 * meaningful.
 */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuidPk(),
    /** Cascades: a hard-deleted document (DOC-010) takes its whole
     * chain with it, blobs included. */
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** 1..n, unique per document. The highest is the current version. */
    versionNumber: integer("version_number").notNull(),
    /** The stored blob, as `<driver>:<key>` per DOC-012 — the driver
     * prefix is what lets a deployment that has changed drivers still
     * read what the old one wrote. */
    fileRef: text("file_ref").notNull(),
    kind: text("kind", { enum: DOCUMENT_VERSION_KINDS }).notNull(),
    /** What changed in this round; NULL when the uploader said nothing. */
    note: text("note"),
    /** The name the file arrived under. Kept verbatim: it is what the
     * uploader recognises, and it is what a download offers back. It is
     * never used to build a storage key — keys are minted from ids. */
    originalFilename: text("original_filename").notNull(),
    /** What the upload declared it was. Client-supplied, so it is a
     * hint for rendering (DOC-004) and never a security decision. */
    mimeType: text("mime_type").notNull(),
    /** Counted by the server as the bytes streamed past, not taken from
     * a header. `bigint` because a file is not bounded by 2^31. */
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    /** Lowercase hex SHA-256, computed over the same pass. */
    checksumSha256: text("checksum_sha256").notNull(),
    // No cascade, for `documents.created_by`'s reason.
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    /** No `updated_at`: the row is immutable (DOC-001). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The chain read, and the constraint that keeps it linear in one
    // index: one number per document, so two concurrent appends cannot
    // both become version 3 — the database refuses the loser rather
    // than leaving the chain with a repeat in it.
    uniqueIndex("document_versions_document_number_idx").on(table.documentId, table.versionNumber),
    check("document_versions_number_check", sql`${table.versionNumber} >= 1`),
    check("document_versions_byte_size_check", sql`${table.byteSize} >= 0`),
    // Exactly 64 lowercase hex characters. The column's whole value is
    // that it can be compared against a checksum taken later, and a row
    // holding anything else could never be — so the shape is a database
    // rule rather than a convention the writer is trusted to keep.
    check(
      "document_versions_checksum_sha256_check",
      sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_versions_kind_check",
      sql`${table.kind} in ('draft_ours', 'redline_theirs', 'redline_ours', 'executed', 'amendment')`,
    ),
  ],
);

export type DocumentVersion = typeof documentVersions.$inferSelect;
