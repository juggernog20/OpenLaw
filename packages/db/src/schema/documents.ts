// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The file layer's two tables (DOC-001, DOC-002): the logical
 * `documents` record, and the file-immutable `document_versions` chain
 * under it. They land together in M11/2, the first step that stores a file at
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
 * M11/6 adds `is_confidential`, DD-014's per-document flag, which M10
 * deferred until this table existed.
 *
 * M13/3 adds `folder_id` (DOC-006), the optional grouping inside the
 * owning record. NULL is the record root, which is where every document
 * uploaded before folders existed sits and where most of them stay.
 *
 * What is deliberately not here yet, and the step that brings it: the
 * version chain's `source` plus the two comparison-provenance columns
 * (M32's generated redlines). The fixed kind already includes
 * `generated_redline` so reads and the M21A correction guard can name
 * it. M32 brings the first writer and its provenance columns.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { documentFolders } from "./document-folders.js";
import { entities } from "./entities.js";
import { searchVector, uuidPk } from "./helpers.js";
import { knowledgeItems } from "./knowledge-items.js";
import { matters } from "./matters.js";

/**
 * What a version is, in the negotiation's own words (CTR-014). The six
 * hand-set kinds and `generated_redline` land here. Redline compare
 * (M32) is the first feature that writes the generated kind.
 *
 * The two `draft_*` kinds are **originating** rounds — paper somebody
 * wrote — and the two `redline_*` kinds are **markups** of a round that
 * already exists. That is why both sides need a draft: a counterparty's
 * first paper marks up nothing, so `redline_theirs` would claim a round
 * that is not there, and `draft_ours` would name the wrong author
 * (#326).
 *
 * Code branches on the kind — the chain view colours it, and the
 * executed pin is offered against it — so the set is fixed rather than
 * admin-configurable.
 */
export const HAND_SET_DOCUMENT_VERSION_KINDS = [
  "draft_ours",
  "draft_theirs",
  "redline_theirs",
  "redline_ours",
  "executed",
  "amendment",
] as const;
export const DOCUMENT_VERSION_KINDS = [
  ...HAND_SET_DOCUMENT_VERSION_KINDS,
  "generated_redline",
] as const;
export type DocumentVersionKind = (typeof DOCUMENT_VERSION_KINDS)[number];
export type HandSetDocumentVersionKind = (typeof HAND_SET_DOCUMENT_VERSION_KINDS)[number];

/**
 * The logical file record (DOC-001). It holds identity and ownership;
 * the bytes live in the version chain, never here.
 *
 * **Exactly one owning record** (DOC-008): a matter, a contract, an
 * entity, or a knowledge item, and there is no such thing as a
 * standalone document. M11 began with Contract as the only owner; M22
 * added Matter, M27 added Entity, and M28 completes the set with
 * Knowledge. The current constraint names all four columns and requires
 * exactly one.
 *
 * **The migration that adds a second owner column must carry the rule
 * down with it, not hand it to the application.** Dropping `NOT NULL`
 * and relying on the application check DOC-008 describes would leave the
 * table able to hold a two-owner row and an orphan row alike, and a row
 * like that is unreachable by every access path in the product — the
 * gate is the owner. Postgres states the rule directly, with
 * `num_nonnulls`.
 *
 * **The constraint names the owner columns that exist when it is
 * written.** It cannot be written in its final four-column form up
 * front: a CHECK naming `entity_id` before M27 adds that column does not
 * parse. So the migration that adds the second owner column carries
 * `CHECK (num_nonnulls(matter_id, contract_id) = 1)` beside its
 * `DROP NOT NULL` — never one without the other, because the gap between
 * them is where an ownerless row can be written. Each later owner module
 * then drops and re-adds it one column wider, in the migration that adds
 * its own column, until it reaches:
 *
 * ```sql
 * CHECK (num_nonnulls(matter_id, contract_id, entity_id, knowledge_item_id) = 1)
 * ```
 *
 * The application check stays, because it is what turns a violation into
 * a message somebody can act on rather than a 500. The constraint is the
 * floor under it. See DOC-008's 2026-08-21 consequence.
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
    /** The contract arm of DOC-008's owning record. A viewer reaches a
     * document only through the contract, matter, or Entity that owns
     * it; the Entity arm applies `entityReachScope` (ENT-004). */
    contractId: text("contract_id").references(() => contracts.id),
    /** M22's second owning record. Exactly one of `contract_id`,
     * `matter_id`, and `entity_id` is present; the table check below is
     * the floor under every application write (DOC-008). */
    matterId: text("matter_id").references(() => matters.id),
    /** M27's third owning record: the Entity-owned statutory Document arm
     * (ENT-005). Subject to the same exactly-one-owner check. */
    entityId: text("entity_id").references(() => entities.id),
    /** M28's fourth and final owning-record arm (KNW-001). */
    knowledgeItemId: text("knowledge_item_id").references(() => knowledgeItems.id),
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
    /**
     * DD-014's per-document flag, deferred from M10 to the step that
     * landed this table (M11/6).
     *
     * It **narrows** and never widens. Access is still inherited from
     * the owning contract (DOC-008), and this asks a second question of
     * whoever the contract already admits: a confidential document is
     * reached by the contract's named team, the contract's Owner, and
     * Administrators, and by nobody else. A viewer outside that audience
     * is answered exactly as for a document that was never uploaded —
     * off the list, out of the count, 404 on the download and on every
     * mutation, and with the activity entries that name it left out.
     *
     * There is no per-document team beside it, for DOC-008's reason: a
     * second team would be a second source of truth for one record's
     * permissions.
     */
    isConfidential: boolean("is_confidential").notNull().default(false),
    /**
     * Which folder on the owning record this document is filed in, or
     * NULL at the record root (DOC-006, M13/3).
     *
     * **Shared-owner invariant**: the named folder belongs to this
     * document's own contract. It is enforced in the write path, under
     * that contract's row lock, exactly as the folder tree's own
     * invariants are — a folder id says nothing about which record it is
     * on, so a folder from another contract is answered as one that was
     * never created rather than refused as a mismatch.
     *
     * **No cascade, and no SET NULL**, for `document_folders.parent_id`'s
     * reason: deleting a folder dissolves it, and the route re-files
     * every document in it into the parent — the record root when it had
     * none — before the row goes. The database refusing to orphan a
     * filed document is the backstop for a write that forgot to.
     */
    folderId: text("folder_id").references(() => documentFolders.id),
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
    /** M25's own-row metadata vector. Version filenames are joined at
     * query time; owning-record titles are deliberately never copied. */
    searchVector: searchVector("search_vector").generatedAlwaysAs(sql`
      setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'B')
    `),
  },
  (table) => [
    // The one read the record page makes: this contract's documents,
    // newest first. `id` last, because the listing's keyset walks
    // `(created_at, id)` and the tie-break belongs in the index that
    // answers the order (CTR-024, #391).
    index("documents_contract_idx").on(table.contractId, table.createdAt, table.id),
    index("documents_matter_idx").on(table.matterId, table.createdAt, table.id),
    index("documents_entity_idx").on(table.entityId, table.createdAt, table.id),
    index("documents_knowledge_item_idx").on(table.knowledgeItemId, table.createdAt, table.id),
    // The executed pin's own column — the referencing side of the
    // foreign key into `document_versions` (M11/5). No read filters on
    // it, so it carried no index until now: what needs one is DOC-010's
    // hard delete. Removing a version row makes Postgres check every
    // document for one pointing at it, and without an index that check
    // is a sequential scan of `documents` per deleted version — the cost
    // the M11/4 review parked until this step.
    index("documents_executed_version_idx").on(table.executedVersionId),
    // The read a folder makes when it is opened: this folder's
    // documents, newest first (M13/3). The same index answers the
    // folder's count and the re-file a delete runs, and it is what keeps
    // opening one folder on a heavy record off a scan of the record's
    // whole paper.
    // The same keyset as the record listing above, so the same
    // tie-break: one folder's page is the record's page under one more
    // filter, and it walks `(created_at, id)` too.
    index("documents_folder_idx").on(table.folderId, table.createdAt, table.id),
    index("documents_search_vector_idx").using("gin", table.searchVector),
    check(
      "documents_owner_check",
      sql`num_nonnulls(${table.matterId}, ${table.contractId}, ${table.entityId}, ${table.knowledgeItemId}) = 1`,
    ),
  ],
);

export type Document = typeof documents.$inferSelect;

/**
 * One immutable file snapshot (DOC-001). Versions are numbered 1..n per
 * document, strictly linear, and never deleted individually. A file
 * correction appends a new version. CTR-014 allows one update to the
 * judgement about it: `kind`, and no other column.
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
    // The filed-comment marker references the exact pair, so deleting
    // a chain can clear both of its marker columns in one FK action.
    uniqueIndex("document_versions_document_id_id_idx").on(table.documentId, table.id),
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
      sql`${table.kind} in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment', 'generated_redline')`,
    ),
  ],
);

export type DocumentVersion = typeof documentVersions.$inferSelect;
