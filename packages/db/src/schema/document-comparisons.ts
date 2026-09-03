// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A durable comparison between two rounds of one Document (DOC-003).
 *
 * The row is written `pending` in the request transaction. The queue is
 * only a wake-up; this record is the work owed and, once answered, the
 * result every later reader reuses. A comparison sits beside the immutable
 * version chain rather than becoming another round on it.
 *
 * Word comparison keeps both products of the engine pass: the structured
 * model the compare screen draws and the tracked-changes DOCX an export can
 * later append to the chain. Text comparison uses the same durable shape but
 * has no derived file.
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { documents, documentVersions } from "./documents.js";
import { uuidPk } from "./helpers.js";

export const DOCUMENT_COMPARISON_MODES = ["word", "text"] as const;
export type DocumentComparisonMode = (typeof DOCUMENT_COMPARISON_MODES)[number];

export const DOCUMENT_COMPARISON_STATES = ["pending", "ready", "failed"] as const;
export type DocumentComparisonState = (typeof DOCUMENT_COMPARISON_STATES)[number];

export const documentComparisons = pgTable(
  "document_comparisons",
  {
    id: uuidPk(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    fromVersionId: text("from_version_id")
      .notNull()
      .references(() => documentVersions.id),
    toVersionId: text("to_version_id")
      .notNull()
      .references(() => documentVersions.id),
    mode: text("mode", { enum: DOCUMENT_COMPARISON_MODES }).notNull(),
    state: text("state", { enum: DOCUMENT_COMPARISON_STATES }).notNull(),
    /** The parser's JSON-safe ChangeModel. Typed at the API boundary,
     * where its schema is owned; the database only promises JSON here. */
    changeModel: jsonb("change_model"),
    changeCount: integer("change_count"),
    /** The stored tracked-changes DOCX for a ready Word comparison. */
    redlineFileRef: text("redline_file_ref"),
    failure: text("failure"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("document_comparisons_pair_unique").on(
      table.documentId,
      table.fromVersionId,
      table.toVersionId,
    ),
    index("document_comparisons_from_version_idx").on(table.fromVersionId),
    index("document_comparisons_to_version_idx").on(table.toVersionId),
    check("document_comparisons_mode_check", sql`${table.mode} in ('word', 'text')`),
    check(
      "document_comparisons_state_check",
      sql`${table.state} in ('pending', 'ready', 'failed')`,
    ),
    check(
      "document_comparisons_distinct_versions_check",
      sql`${table.fromVersionId} <> ${table.toVersionId}`,
    ),
    check(
      "document_comparisons_change_count_check",
      sql`${table.changeCount} is null or ${table.changeCount} >= 0`,
    ),
    check(
      "document_comparisons_outcome_check",
      sql`(
        (${table.state} = 'pending' and ${table.changeModel} is null and ${table.changeCount} is null and ${table.redlineFileRef} is null and ${table.failure} is null and ${table.finishedAt} is null)
        or
        (${table.state} = 'ready' and ${table.changeModel} is not null and ${table.changeCount} is not null and ${table.failure} is null and ${table.finishedAt} is not null and ((${table.mode} = 'word' and ${table.redlineFileRef} is not null) or (${table.mode} = 'text' and ${table.redlineFileRef} is null)))
        or
        (${table.state} = 'failed' and ${table.changeModel} is null and ${table.changeCount} is null and ${table.redlineFileRef} is null and ${table.failure} is not null and ${table.finishedAt} is not null)
      )`,
    ),
  ],
);

export type DocumentComparison = typeof documentComparisons.$inferSelect;
