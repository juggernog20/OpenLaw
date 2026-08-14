// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One version's display rendition (DOC-004), landed in M12/4.
 *
 * A Word draft and a PowerPoint deck do not read in a browser. DOC-004
 * promises they read in the doc panel anyway, so the pipeline converts
 * each one to a PDF and the panel draws that. This table is the record
 * of that conversion: per version, where the rendition's blob is and
 * whether it is there yet.
 *
 * **It sits beside the version chain, never in it.** A
 * `document_versions` row is immutable (DOC-001): it describes bytes a
 * person uploaded, and a PDF a machine made afterwards is not those
 * bytes. So the rendition gets its own table, keyed by the version it
 * was converted from, and the chain is never rewritten by a background
 * job. It is the same shape `document_version_text` takes, for the same
 * reason.
 *
 * **The row is the record of work owed, not only of work done.** It is
 * written `pending` inside the upload's own transaction, so a
 * rolled-back upload leaves nothing behind and a committed one always
 * says a conversion is due. The queue only wakes a worker; this row is
 * what makes the work durable, and what the M12/6 backfill sweep reads
 * to find versions that never got theirs.
 *
 * **The rendition is for display, and it is never the record.** The
 * stored original is what a download answers and what the chain
 * describes (DOC-001, DOC-005). A rendition can be thrown away and made
 * again from the original; the original cannot be made again from
 * anything.
 */

import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DERIVATION_STATES } from "./document-text.js";
import { documentVersions } from "./documents.js";

/**
 * The display rendition of one version.
 *
 * The primary key is the version's own id, so a version has exactly one
 * rendition and re-running its conversion rewrites that row rather than
 * growing a pile of attempts.
 *
 * Cascades: a hard-deleted document (DOC-010) takes its chain, and the
 * chain takes what was derived from it. The blob behind `file_ref` is
 * **not** cascaded — no database can reach a storage driver — so the
 * erasure route deletes it explicitly, inside the same transaction and
 * before the commit, exactly as it deletes the source blobs.
 */
export const documentVersionRenditions = pgTable(
  "document_version_rendition",
  {
    versionId: text("version_id")
      .primaryKey()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    state: text("state", { enum: DERIVATION_STATES }).notNull(),
    /**
     * Where the converted PDF is stored, as `<driver>:<key>` (DOC-012).
     * NULL until the conversion lands — a pending or failed row has
     * converted nothing, so it names no blob.
     *
     * The key is minted fresh for each attempt rather than derived from
     * the version alone, because a stored key is never written twice
     * (DOC-012). A retry that re-converts writes a new blob and records
     * that one; the blob the failed attempt left behind is an orphan,
     * which is the same harmless outcome an upload's failed transaction
     * leaves.
     */
    fileRef: text("file_ref"),
    /**
     * How many bytes the rendition is, counted as it streamed to the
     * driver. It is what the preview response's `content-length` is set
     * from, so the panel's PDF surface knows how much it is fetching —
     * the source preview says the same thing from the version row, and
     * the two reads should not differ in what they tell a browser.
     */
    byteSize: bigint("byte_size", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the state last moved. The panel polls on it, and an operator
     * reads it to tell a job that is running from one that is wedged. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "document_version_rendition_state_check",
      sql`${table.state} in ('pending', 'ready', 'failed')`,
    ),
    // Ready and "has a stored blob of a known size" are the same fact, so
    // the database holds them together rather than trusting every
    // writer to. A `ready` row with no blob would send the panel at a
    // preview that streams nothing, and a `pending` row naming a blob
    // would make a caller poll forever past an answer it already has.
    check(
      "document_version_rendition_ready_check",
      sql`(${table.state} = 'ready') = (${table.fileRef} is not null and ${table.byteSize} is not null)`,
    ),
    check(
      "document_version_rendition_byte_size_check",
      sql`${table.byteSize} is null or ${table.byteSize} >= 0`,
    ),
  ],
);

export type DocumentVersionRendition = typeof documentVersionRenditions.$inferSelect;
