// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One filing of an Entity Obligation (ENT-006): the date, who filed it,
 * an optional note and the optional filed Document.
 *
 * The Obligation row is the schedule and keeps one standing note. A
 * recurring Obligation moves its due date forward on each filing, so this
 * table is where each cycle's proof stays. The Activity entry records
 * that the filing happened and names this row; it never carries the note.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { documentVersions } from "./documents.js";
import { entityObligations } from "./entity-obligations.js";
import { uuidPk } from "./helpers.js";

export const entityObligationFilings = pgTable(
  "entity_obligation_filings",
  {
    id: uuidPk(),
    /** Deleting the Obligation deletes its filings. The Activity entries stay. */
    obligationId: text("obligation_id")
      .notNull()
      .references(() => entityObligations.id, { onDelete: "cascade" }),
    filedOn: date("filed_on").notNull(),
    /** Free text for this cycle. NULL when nobody wrote one. */
    note: text("note"),
    // No cascade, as everywhere a record names a person: someone is
    // archived, never deleted (SET-005).
    filedBy: text("filed_by")
      .notNull()
      .references(() => users.id),
    /** The Entity Document filed as proof, if any. */
    documentId: text("document_id"),
    /** The Version that was current when the filing pinned it. */
    versionId: text("version_id"),
    /** Whether a Document was filed. It stays true after DOC-010 erases
     * the Document and clears the pair, so Filing history can say the
     * Document was removed rather than never filed. */
    documentFiled: boolean("document_filed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entity_obligation_filings_obligation_idx").on(
      table.obligationId,
      table.filedOn,
      table.createdAt,
    ),
    // The referencing side of the pair below. Erasing a Document makes
    // PostgreSQL look up every filing that names one of its Versions.
    index("entity_obligation_filings_document_idx").on(table.documentId, table.versionId),
    // The pair is one link. Neither half means anything alone.
    check(
      "entity_obligation_filings_document_pair_check",
      sql`(${table.documentId} is null and ${table.versionId} is null) or (${table.documentId} is not null and ${table.versionId} is not null)`,
    ),
    check(
      "entity_obligation_filings_document_filed_check",
      sql`${table.documentId} is null or ${table.documentFiled}`,
    ),
    // SET NULL clears both columns together when DOC-010 erases the
    // Document, so the pair check holds through the delete.
    foreignKey({
      name: "entity_obligation_filings_document_version_fk",
      columns: [table.documentId, table.versionId],
      foreignColumns: [documentVersions.documentId, documentVersions.id],
    }).onDelete("set null"),
  ],
);

export type EntityObligationFiling = typeof entityObligationFilings.$inferSelect;
