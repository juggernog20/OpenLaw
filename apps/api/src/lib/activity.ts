// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one door to the activity log (DD-017, SET-003): every settings and
 * record mutation appends its entry through here — later modules reuse
 * this helper rather than inserting into activity_log themselves. Write
 * side only; the feeds and the audit-log viewer read it in M9.
 */

import {
  activityLog,
  type ActivityEntityType,
  type ActivityVisibility,
  type Db,
} from "@openlaw/db";

/**
 * A database handle or a transaction inside one — callers that mutate
 * and log atomically pass their transaction, so a failed log write rolls
 * the mutation back rather than leaving an unrecorded change.
 */
export type ActivityWriter = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ActivityEntry {
  entityType: ActivityEntityType;
  /** The entity's id; omit for `system`-typed entries, which have none. */
  entityId?: string;
  /** The acting user; omit for system-emitted events with no human actor. */
  actorId?: string;
  /** Slug like `user.theme_changed` or `org_settings.updated`. */
  action: string;
  visibility: ActivityVisibility;
  /** Action-specific data — old/new values for edits, etc. */
  payload?: Record<string, unknown>;
}

/** Appends one entry. Append-only: nothing in application code ever
 * updates or deletes activity_log rows (corrections are new entries). */
export async function recordActivity(db: ActivityWriter, entry: ActivityEntry): Promise<void> {
  await db.insert(activityLog).values({
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    actorId: entry.actorId ?? null,
    action: entry.action,
    visibility: entry.visibility,
    payload: entry.payload ?? {},
  });
}
