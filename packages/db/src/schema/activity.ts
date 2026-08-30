// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The activity log (DD-017): one append-only table behind both the
 * per-entity activity feed and the Administrator-only audit log (both
 * read surfaces arrive in M9). The application layer emits every row
 * through the API's activity helper and never issues UPDATE or DELETE
 * here. Corrections are appended as new entries (SCHEMA.md).
 */

import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

export const ACTIVITY_ENTITY_TYPES = [
  "matter",
  "contract",
  "document",
  "request",
  "user",
  /** A corporate Entity (the registry record, M7), not the generic
   * polymorphic sense of this column pair (see CONTEXT.md). */
  "entity",
  "system",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** DD-017 visibility tiers: the DD-016 comment tiers plus admin_only. */
export const ACTIVITY_VISIBILITIES = [
  "legal_only",
  "working_team",
  "full_thread",
  "admin_only",
] as const;
export type ActivityVisibility = (typeof ACTIVITY_VISIBILITIES)[number];

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuidPk(),
    entityType: text("entity_type", { enum: ACTIVITY_ENTITY_TYPES }).notNull(),
    /**
     * Polymorphic with entity_type (the SCHEMA.md-documented exception to
     * separate-tables-with-view), so no FK; `system` entries have none.
     */
    entityId: text("entity_id"),
    /** NULL for system-emitted events (cron jobs, webhooks) with no human actor. */
    actorId: text("actor_id").references(() => users.id),
    /** Slug like `user.theme_changed` or `org_settings.updated`. */
    action: text("action").notNull(),
    visibility: text("visibility", { enum: ACTIVITY_VISIBILITIES }).notNull(),
    /** Action-specific data, such as old and new values for an edit. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The three SCHEMA.md query shapes: per-entity feed, actor-based
    // audit queries, security-event filtering by action.
    //
    // The per-entity feed carries `id` as its fourth column, because
    // that feed is paged and its keyset walks `(created_at, id)`
    // (CTR-024), the same pair `activity_log_created_at_idx` below
    // indexes for the audit log. The other two answer filters rather
    // than a cursor, so neither needs the tie-break (#391).
    index("activity_log_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
      table.id,
    ),
    index("activity_log_actor_idx").on(table.actorId, table.createdAt),
    index("activity_log_action_idx").on(table.action, table.createdAt),
    // The fourth shape, added with the surface that reads it (M9/7):
    // the Administrator's audit log, which has no entity scope and no
    // actor to key on. It orders the whole table by `(created_at, id)`,
    // the pair its keyset cursor walks. This is the largest table in
    // the system, so without this index every page and every export
    // sorts all of it.
    index("activity_log_created_at_idx").on(table.createdAt, table.id),
    check(
      "activity_log_entity_type_check",
      sql`${table.entityType} in ('matter', 'contract', 'document', 'request', 'user', 'entity', 'system')`,
    ),
    check(
      "activity_log_visibility_check",
      sql`${table.visibility} in ('legal_only', 'working_team', 'full_thread', 'admin_only')`,
    ),
  ],
);

export type ActivityLogEntry = typeof activityLog.$inferSelect;
