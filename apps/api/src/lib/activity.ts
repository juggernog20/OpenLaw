// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one door to the activity log (DD-017, SET-003): every settings and
 * record mutation appends its entry through here — later modules reuse
 * this helper rather than inserting into activity_log themselves. Write
 * side only; the feeds and the audit-log viewer read it in M9.
 *
 * **The vocabulary is not here.** The action slugs and the payload each
 * one writes live in `@openlaw/shared`, because both ends of the log
 * read them: this module writes the rows, and the web narrator turns one
 * row into a sentence. This module is the door; that module is the words
 * you may say through it.
 */

import {
  activityLog,
  type ActivityEntityType,
  type ActivityVisibility,
  type Executor,
} from "@openlaw/db";
import type { ActivityAction, ActivityPayloadMap } from "@openlaw/shared";
import { emitActivityEvent } from "./activity-emitter.js";

/**
 * The vocabulary itself lives in `@openlaw/shared`, because both ends of
 * the log read it: this module writes the rows, and the web narrator
 * turns one row into a sentence. Re-exported here so the write sites
 * keep importing their vocabulary from the writer they call.
 */
export type {
  ActivityAction,
  ActivityPayloadMap,
  TaxonomyActionPrefix,
  TypeFieldActionPrefix,
} from "@openlaw/shared";

/**
 * One entry, before it is a row.
 *
 * A union over the vocabulary rather than one shape with a loose
 * payload: the action picks the payload, so a write site that supplies
 * a wrong or missing key does not compile. `payload` is optional only
 * for the slugs that carry nothing — everywhere else the compiler asks
 * for it.
 *
 * The prose that says *why* each verb exists is with the vocabulary, in
 * `@openlaw/shared`.
 */
export type ActivityEntry = {
  [A in ActivityAction]: {
    entityType: ActivityEntityType;
    /** The entity's id; omit for `system`-typed entries, which have none. */
    entityId?: string;
    /** The acting user; omit for system-emitted events with no human actor. */
    actorId?: string;
    action: A;
    visibility: ActivityVisibility;
  } & PayloadField<ActivityPayloadMap[A]>;
}[ActivityAction];

/** Action-specific data. Required unless the slug's shape asks for
 * nothing, in which case there is nothing for a caller to hand over. */
type PayloadField<P> = Record<never, never> extends P ? { payload?: P } : { payload: P };

/**
 * The tier a record's own actions ride (DD-017, M9/6).
 *
 * DD-017 says an entry inherits the visibility tier of the action it
 * represents. Editing a field, moving a status, or putting somebody on
 * the team is the working group's business, so the working group can
 * read it: those entries are Working Team, and the record feed shows
 * them to a Contributor on the team exactly as it shows them to a
 * Member. `admin_only` is not this — it stays for settings, user
 * administration, and security actions, which no record feed carries.
 * Comment entries take no default at all: each one rides the comment's
 * own tier (CMT-006).
 *
 * **M8 wrote these rows `legal_only`, and those rows stay as written.**
 * The log is append-only, so there is no migration that rewrites them;
 * this is pre-release, and a handful of early entries reading narrower
 * than they would today is the honest state of an append-only table.
 *
 * Contracts adopt this in M9/6, because the contract record is the
 * first surface with a feed. The Entities record's `entity.*` entries
 * still write `legal_only`: its activity bar is not mounted (M9 is out
 * of scope for it), and they join this constant when the Entities
 * module gets its feed in Arc 6.
 */
export const RECORD_ACTIVITY_TIER: ActivityVisibility = "working_team";

/**
 * One appended row, as the table now holds it. Returned because two
 * callers need the row's own identity rather than the entry they handed
 * over: structured emission names the row it is a copy of, and the audit
 * log's CSV export bounds itself at the entry recording the export
 * (M9/7), so an export never streams itself.
 */
export type RecordedActivity = typeof activityLog.$inferSelect;

/** Appends multiple entries in one write. */
export async function recordActivity(
  db: Executor,
  entries: ActivityEntry[],
): Promise<RecordedActivity[]>;
/**
 * Appends one entry. Append-only: nothing in application code ever
 * updates or deletes activity_log rows (corrections are new entries).
 *
 * The single-entry overload is declared **last** on purpose. When a call
 * matches neither, TypeScript reports the last overload's error — and
 * for a wrong payload key, "this key is not in `contract.updated`" is
 * the message a writer needs, not "this is not an array".
 */
export async function recordActivity(
  db: Executor,
  entry: ActivityEntry,
): Promise<RecordedActivity[]>;
export async function recordActivity(
  db: Executor,
  entryOrEntries: ActivityEntry | ActivityEntry[],
): Promise<RecordedActivity[]> {
  const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
  const rows = await db
    .insert(activityLog)
    .values(
      entries.map((entry) => ({
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        visibility: entry.visibility,
        // The column is `Record<string, unknown>` and stays that way: a
        // row is read back long after the shape that wrote it was
        // typed, so the reader gets what is there rather than what the
        // current build would have written.
        payload: (entry.payload ?? {}) as Record<string, unknown>,
      })),
    )
    // Every column, because the emitted line is built from the row and
    // not from the entry that asked for it. Nothing here pairs a
    // returned row with an input by position: `RETURNING` order is not
    // something to lean on, and the line has to be a copy of what was
    // actually stored anyway.
    .returning();

  // The SIEM copy (DD-017), one line per row, alongside the in-app
  // write rather than instead of it. It rides the insert rather than the
  // commit: a caller inside a transaction gets its line when the row is
  // written, and a transaction that later rolls back has emitted a line
  // for a row nobody can read. That is the price of not making every
  // caller hand over a commit hook, and it is the cheaper mistake — a
  // rolled-back mutation is a failed request, which is loud on its own.
  // Emission never throws (see `emitActivityEvent`), so nothing here can
  // fail or roll back the mutation it is reporting.
  for (const row of rows) {
    emitActivityEvent({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      entityType: row.entityType,
      entityId: row.entityId,
      actorId: row.actorId,
      action: row.action,
      visibility: row.visibility,
      payload: row.payload,
    });
  }

  return rows;
}
