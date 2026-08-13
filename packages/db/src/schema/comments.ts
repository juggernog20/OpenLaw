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
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    /** NULL = live; a timestamp draws a tombstone in the thread. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
