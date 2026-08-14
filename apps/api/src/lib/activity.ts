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
import { emitActivityEvent } from "./activity-emitter.js";

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
  // The contract record's own feed (M8). A status change keeps its own
  // verb: surfaces branch on the stage behind the status (CTR-001), so
  // the M9 viewer narrates "status changed" rather than a generic edit.
  // Team changes keep their own verbs too — putting a person on a
  // contract is not an edit of a field, and the M9 viewer names them
  // (CTR-004). The Owner is a field, so it rides `contract.updated`.
  // The counterparties are the same shape as the team and for the same
  // reason (CTR-011): a party joining or leaving the other side is not
  // an edit of a field. The primary change is its own verb because it
  // also happens on its own — removing the primary promotes the next
  // party, and the log has to say so rather than leave it implied. A
  // type reassignment (#113) keeps its own verb for the entity-record
  // reason above: the contract moved because an Administrator archived
  // its type, not because someone re-typed it. Setting and clearing the
  // Confidential flag (M10/2) keep their own verbs for a third reason:
  // DD-014 requires every walling-off of a record to be accountable by
  // actor and timestamp, and a verb an Administrator can filter the
  // audit log on is what makes that a query rather than a hunt through
  // `contract.updated` payloads.
  | `contract.${"created" | "updated" | "status_changed" | "type_reassigned" | "team_added" | "team_removed" | "counterparty_added" | "counterparty_removed" | "counterparty_primary_changed" | "confidentiality_set" | "confidentiality_cleared" | "archived" | "restored"}`
  // The conversation on a record (M9/2, M9/4). Every entry carries the
  // comment's own tier, so a Legal Only comment leaves no trace for
  // anyone who could not read it. They carry ids and metadata only —
  // no comment text ever enters a payload, because DD-017 forbids
  // UPDATE and DELETE here and an Administrator's hard redact has to be
  // able to remove what was said (CMT-006, amending CMT-005). Correcting
  // a comment keeps its own verb from taking it back: an edit and a
  // delete are the author's acts, and a redact is an Administrator's.
  | `comment.${"posted" | "edited" | "deleted" | "redacted"}`
  // The record's paper (M11/2, M11/3, M11/4, M11/5, DD-017). The entry hangs off the
  // owning contract, not off the document: access to a document is the
  // owning record's access and nothing else (DOC-008), so its story
  // belongs in that record's feed. The payload names the document,
  // because hard deletion (DOC-010) removes the rows and the entry still
  // has to say what was deleted.
  //
  // A verb per thing that happens, not one generic edit. Adding a round
  // to the chain is not the same event as putting the first file on the
  // record, and neither is renaming one — the feed has to read as a
  // negotiation rather than as a run of generic edits, and an
  // Administrator has to be able to filter the audit log on the one they
  // are looking for.
  | "document.created"
  | "document.version_added"
  | "document.updated"
  // The two CTR-014 designations (M11/4). Each keeps its own verb for
  // the counterparty-primary reason above: naming the instrument and
  // pinning the signed copy are decisions about the record, and the
  // first one also happens on its own — the first upload takes the
  // designation nobody asked for, so the log says so rather than
  // leaving it implied by the upload above it. The pin's set and clear
  // are two verbs because the record having no signed copy any more is
  // its own event, not an edit of which one it is.
  | "document.primary_set"
  | "document.executed_set"
  | "document.executed_cleared"
  // DOC-010's two removals (M11/5), and they are not two names for one
  // act. Archiving hides a wrong upload and destroys nothing; restoring
  // is its undo; hard deletion is the Administrator's lawful erasure and
  // it takes the version rows and the stored files with it. Three verbs,
  // because an auditor asked "what happened to that file" must be able
  // to tell "it was taken off the list" from "it no longer exists".
  //
  // The hard-deletion entry is the reason every payload in this module
  // carries the document's title: the entry outlives the row, so it is
  // the only place left that says what was erased.
  | "document.archived"
  | "document.restored"
  | "document.hard_deleted"
  | "sso_provider.registered"
  | "sso_provider.updated"
  // Data leaving the system (M9/7, DD-017). An export is a security
  // event in its own right, so taking one appends an entry at
  // `admin_only` naming the filters it was taken under. It hangs off
  // `system`: an export is about no single record.
  | "export.performed";

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

/** Appends one entry. Append-only: nothing in application code ever
 * updates or deletes activity_log rows (corrections are new entries). */
export async function recordActivity(
  db: ActivityWriter,
  entry: ActivityEntry,
): Promise<RecordedActivity[]>;
/** Appends multiple entries in one write. */
export async function recordActivity(
  db: ActivityWriter,
  entries: ActivityEntry[],
): Promise<RecordedActivity[]>;
export async function recordActivity(
  db: ActivityWriter,
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
        payload: entry.payload ?? {},
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
