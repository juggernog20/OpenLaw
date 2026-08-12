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

/**
 * The closed audit vocabulary (DD-017). Rows are append-only, so a
 * mistyped slug becomes a permanently unqueryable entry — the compiler
 * is the only place to catch it. The M9 viewer filters on these exact
 * slugs. The template arm covers the preference route, which builds its
 * slug from the changed field name.
 */
/** The taxonomy tables' audit namespaces (#85: one machinery each). */
export type TaxonomyActionPrefix = "contract_type" | "matter_type" | "entity_type";
export type TypeFieldActionPrefix = "contract_type_field" | "matter_type_field";

export type ActivityAction =
  | `user.${"theme" | "timezone" | "display_name" | "avatar"}_changed`
  | "user.invited"
  | "user.invite_resent"
  | "user.invite_revoked"
  | "user.password_changed"
  | "user.other_sessions_revoked"
  | "user.two_factor_enrolled"
  | "user.two_factor_disabled"
  | "user.role_changed"
  | "user.archived"
  | "user.unarchived"
  | "user.sessions_revoked"
  | "org_settings.updated"
  | `${TaxonomyActionPrefix}.${"created" | "renamed" | "updated" | "reordered" | "archived" | "restored" | "deleted"}`
  | `${TypeFieldActionPrefix}.${"attached" | "detached" | "reordered" | "required_changed"}`
  | `contract_status.${"created" | "renamed" | "reordered" | "archived" | "restored" | "deleted"}`
  | `field.${"created" | "updated" | "promoted" | "narrowed" | "archived" | "restored"}`
  // The registry record's own feed (M7): create and archive from #98,
  // the record surface's verbs from #99. A status change keeps its own
  // verb — status is the fixed code-branching enum (ENT-001), so the M9
  // viewer narrates "status changed" rather than a generic edit. A type
  // reassignment (#100) keeps its own verb too: the entity moved because
  // an Administrator archived its type, not because someone edited it.
  | `entity.${"created" | "updated" | "status_changed" | "type_reassigned" | "archived" | "restored"}`
  | "sso_provider.registered"
  | "sso_provider.updated";

export interface ActivityEntry {
  entityType: ActivityEntityType;
  /** The entity's id; omit for `system`-typed entries, which have none. */
  entityId?: string;
  /** The acting user; omit for system-emitted events with no human actor. */
  actorId?: string;
  action: ActivityAction;
  visibility: ActivityVisibility;
  /** Action-specific data — old/new values for edits, etc. */
  payload?: Record<string, unknown>;
}

/** Appends one entry. Append-only: nothing in application code ever
 * updates or deletes activity_log rows (corrections are new entries). */
export async function recordActivity(db: ActivityWriter, entry: ActivityEntry): Promise<void>;
/** Appends multiple entries in one write. */
export async function recordActivity(db: ActivityWriter, entries: ActivityEntry[]): Promise<void>;
export async function recordActivity(
  db: ActivityWriter,
  entryOrEntries: ActivityEntry | ActivityEntry[],
): Promise<void> {
  const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
  await db.insert(activityLog).values(
    entries.map((entry) => ({
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      visibility: entry.visibility,
      payload: entry.payload ?? {},
    })),
  );
}
