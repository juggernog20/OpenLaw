// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audience-tiered comments (DD-016, CMT-001–006) — one table behind
 * every thread in the product: the record threads, the document
 * annotations, and the portal request thread.
 *
 * The thread is flat and chronological (CMT-002). There is no
 * `parent_comment_id`: its absence is the decision, not an omission.
 *
 * `entity_type` / `entity_id` is the polymorphic pair SCHEMA.md
 * documents as the exception to separate-tables-with-view, so there is
 * no foreign key on the entity. The CHECK admits the full documented
 * vocabulary — the same set the `activity_log` precedent carries — while
 * the API accepts `contract` alone until the other records arrive.
 *
 * Columns land with the feature that reads them (TECH-014). The
 * `anchor` jsonb column CMT-001 needs for document annotations waits for
 * M11, when there are documents to anchor to.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

/** What a comment can hang off. Only `contract` is reachable in M9. */
export const COMMENT_ENTITY_TYPES = ["matter", "contract", "document", "request"] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];

/**
 * DD-016's three audience tiers, widest last. Code branches on them —
 * the tier predicate is a function of the viewer and this value — so
 * the set is fixed, not admin-configurable. `admin_only` is deliberately
 * absent: it is an activity-log tier for settings and security events,
 * and nobody comments into it.
 */
export const COMMENT_VISIBILITIES = ["legal_only", "working_team", "full_thread"] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const comments = pgTable(
  "comments",
  {
    id: uuidPk(),
    entityType: text("entity_type", { enum: COMMENT_ENTITY_TYPES }).notNull(),
    /** Polymorphic with entity_type, so no FK (SCHEMA.md). */
    entityId: text("entity_id").notNull(),
    // No cascade: a person is archived, never deleted (SET-005), so what
    // they said outlives their leaving.
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    /** Immutable after posting (CMT-005): there is no tier-update path. */
    visibility: text("visibility", { enum: COMMENT_VISIBILITIES }).notNull(),
    /** NULL = never edited; a timestamp draws the "edited" marker. */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** NULL = live; a timestamp draws a tombstone in the thread. The
     * author's own act. The body moves to `comment_revisions` with it,
     * so a soft delete hides what was said without losing it. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * NULL = never redacted; a timestamp says an Administrator removed
     * the text (CMT-005's hard redact, CMT-006). It is its own column
     * rather than a second meaning for `deleted_at`, because the two
     * tombstones are different acts by different people: an author took
     * their own words back, or an Administrator removed text posted into
     * the wrong record. The reader is owed the difference, and the row
     * is the only place left to read it — the body is gone.
     */
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The one read every thread makes: this record's comments, oldest
    // first (SCHEMA.md's documented index for this table).
    index("comments_entity_idx").on(table.entityType, table.entityId, table.createdAt),
    check(
      "comments_entity_type_check",
      sql`${table.entityType} in ('matter', 'contract', 'document', 'request')`,
    ),
    check(
      "comments_visibility_check",
      sql`${table.visibility} in ('legal_only', 'working_team', 'full_thread')`,
    ),
  ],
);

export type Comment = typeof comments.$inferSelect;

/**
 * Who a comment addresses (CMT-002, CMT-007) — the mentioned people as
 * a queryable list rather than a substring of prose.
 *
 * Two readers need this list, and neither should have to re-parse a
 * body. Tier promotion reads it at post time: a mention that outruns
 * the comment's tier is refused at the seam, whatever the client sent.
 * The M18 notification fan-out reads it afterwards.
 *
 * The key is the whole row. One person is mentioned on one comment once
 * — naming them twice in a sentence is still one person to reach — so
 * there is nothing to add beside the pair. The mention's time is the
 * comment's time, which is why there is no timestamp here.
 *
 * The comment cascades: a hard redact (CMT-006) removes what was said,
 * and the list of who it was said to goes with it. The user does not: a
 * person is archived, never deleted (SET-005).
 */
export const commentMentions = pgTable(
  "comment_mentions",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    primaryKey({ name: "comment_mentions_pkey", columns: [table.commentId, table.userId] }),
  ],
);

export type CommentMention = typeof commentMentions.$inferSelect;

/**
 * What a comment used to say (CMT-006, amending CMT-005) — one row per
 * body an edit or a soft delete replaced.
 *
 * CMT-005 first put the prior text in the audit log. It cannot live
 * there. DD-017 forbids `UPDATE` and `DELETE` on `activity_log`, so text
 * that enters a payload can never leave it, and an Administrator's hard
 * redact would then remove the comment and leave what it said sitting in
 * the log. The two rules only both hold when the text is somewhere else.
 *
 * This table is that somewhere else. It is ordinary application data, so
 * a redact purges it along with `comments.body` and the text is
 * genuinely gone rather than only hidden. The append-only rule keeps its
 * full strength, because it applies to a different table.
 *
 * Rows are the comment's, so they cascade with it: nothing here outlives
 * the comment it is a version of.
 */
export const commentRevisions = pgTable(
  "comment_revisions",
  {
    id: uuidPk(),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    /** The body this revision replaced, exactly as it was posted. */
    body: text("body").notNull(),
    /** When the body stopped being the comment's own text. */
    replacedAt: timestamp("replaced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The one read this table takes: one comment's prior versions,
    // oldest first — and the one a redact deletes by.
    index("comment_revisions_comment_idx").on(table.commentId, table.replacedAt),
  ],
);

export type CommentRevision = typeof commentRevisions.$inferSelect;
