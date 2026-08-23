// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Optional lightweight folders, scoped inside one owning record
 * (DOC-006, DOC-011). They land in M13/2, the first step that files
 * anything, and they carry only the columns that step reads and writes
 * (TECH-014). SCHEMA.md is the naming reference for the rest.
 *
 * **The owner set is a set of one**, exactly as `documents` requires.
 * M22 added `matter_id`, relaxed Contract's NOT NULL, and widened the
 * check to the two current owners. M27 adds Entity by widening the same
 * constraint; nothing about the machinery is module-shaped.
 *
 * **`display_order` is not here**, and its absence is the decision. It
 * is deferred with the reorder surface that would read it; siblings
 * sort by name, case-insensitively, the way a file manager lists a
 * directory (DES-033).
 *
 * **Three invariants stand behind this table** (DOC-008's pattern): a
 * folder and its parent share one owning record, the parent chain never
 * cycles, and sibling names are unique within their parent. All three
 * are enforced in the application write path, under the owning
 * contract's row lock — the same lock version numbers are assigned
 * under. The two partial unique indexes below stand behind the third of
 * them as the database's own last word, because that is the one a
 * concurrent write can lose: two folder drops racing on one path have
 * to converge on one folder (DOC-011, M13/4), and a check that only
 * ever ran in application code would let both of them win.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";
import { uuidPk } from "./helpers.js";
import { matters } from "./matters.js";

/**
 * The longest folder name this table holds. It is the filesystem's own
 * ceiling, because a folder is created from a directory name as often
 * as it is typed (DOC-011): a name a drop can carry has to be a name a
 * folder can take. Widening it later is safe; narrowing it is not.
 */
export const MAX_FOLDER_NAME_LENGTH = 255;

export const documentFolders = pgTable(
  "document_folders",
  {
    id: uuidPk(),
    /** The contract arm of DOC-008's owning record. A folder is reached
     * only through whichever contract or matter owns it. No cascade:
     * both record types are archived rather than deleted. */
    contractId: text("contract_id").references(() => contracts.id),
    /** M22's matter-owned folder arm. Writers keep exactly one owner on
     * a folder, matching the documents filed beneath it. */
    matterId: text("matter_id").references(() => matters.id),
    /**
     * The folder this one sits inside, or NULL at the record root
     * (DOC-011).
     *
     * **No cascade, and no SET NULL.** Deleting a folder dissolves it —
     * its children are re-filed into its parent by the route, before
     * the row goes (DOC-006) — so the database refusing to orphan a
     * child is the backstop for a write that forgot to. A cascade would
     * destroy the tree this decision exists to preserve, and a SET NULL
     * would quietly promote a whole subtree to the record root.
     */
    // The return type is written out because the reference closes a
    // cycle — this column names this table — and TypeScript cannot infer
    // a type that depends on itself. It is the annotation Drizzle
    // documents for exactly this.
    parentId: text("parent_id").references((): AnyPgColumn => documentFolders.id),
    /** What the team calls this grouping. Trimmed, non-empty, bounded,
     * and free of the path separator — the shape a folder drop can
     * address by path (DOC-011). */
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The one read the Documents section makes: this contract's folders,
    // whole. A record's folder set is small, so the tree is drawn from
    // one read rather than one read per level.
    index("document_folders_contract_idx").on(table.contractId),
    index("document_folders_matter_idx").on(table.matterId),
    // Sibling names are unique within their parent, and the comparison
    // is case-insensitive — the same reading the sort already takes
    // (DES-033). Two siblings that sort as equal and read as the same
    // word may not both exist, and choosing the narrower rule now is
    // the safe direction: widening it later frees names, where
    // narrowing it later would strand rows the rule no longer allows.
    //
    // Two indexes, because a NULL parent is not equal to itself in a
    // unique index: the root's siblings are the rows with no parent, and
    // they are scoped by the contract instead.
    uniqueIndex("document_folders_root_name_idx")
      .on(table.contractId, sql`lower(${table.name})`)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("document_folders_matter_root_name_idx")
      .on(table.matterId, sql`lower(${table.name})`)
      .where(sql`${table.parentId} is null and ${table.matterId} is not null`),
    uniqueIndex("document_folders_sibling_name_idx")
      .on(table.parentId, sql`lower(${table.name})`)
      .where(sql`${table.parentId} is not null`),
    // The name's shape, as a database rule rather than as a convention
    // the writer is trusted to keep — the reason the checksum column has
    // one. A name with a separator in it could not be addressed by path
    // when a folder drop find-or-creates a chain segment by segment
    // (DOC-011), and an untrimmed one would sort and compare as a name
    // nobody typed.
    check(
      "document_folders_name_check",
      sql`${table.name} <> '' and btrim(${table.name}) = ${table.name}
        and length(${table.name}) <= ${sql.raw(String(MAX_FOLDER_NAME_LENGTH))}
        and strpos(${table.name}, '/') = 0 and strpos(${table.name}, '\\') = 0`,
    ),
    // A folder is never its own parent. This is the one cycle a single
    // row can hold, so it is the one the database can refuse on its own;
    // the longer chains are the write path's to check, because no
    // constraint can walk a tree.
    check("document_folders_parent_check", sql`${table.parentId} <> ${table.id}`),
    check(
      "document_folders_owner_check",
      sql`num_nonnulls(${table.matterId}, ${table.contractId}) = 1`,
    ),
  ],
);

export type DocumentFolder = typeof documentFolders.$inferSelect;
