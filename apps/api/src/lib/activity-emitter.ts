// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Structured event emission (M9/7, DD-017's SIEM clause): every row the
 * activity writer appends also leaves this process as one line of JSON.
 *
 * A self-hosting Administrator ships those lines to Datadog, Loki, or
 * Splunk with the log shipper they already run, and needs no integration
 * from us to do it. DD-017 puts this in so many words: "structured event
 * emission to stdout is a separate concern handled by the application
 * logger, not by the activity feed."
 *
 * **The sink is set once, for the process.** `buildApp` points it at
 * that app's logger. It is not threaded through `recordActivity`'s
 * seventy-odd call sites, because it is not that kind of dependency —
 * stdout is process-wide, and the writer's argument is a database handle
 * or the transaction it must write inside. A process that never builds
 * an app (a migration script) emits nothing, which is the right answer
 * for a process that serves no requests.
 *
 * **A failure to emit must not fail the mutation** (DD-017, #133). The
 * in-app log is the record of what happened; the emitted line is a copy
 * for somebody else's system. A full disk on the log volume must not
 * roll back a role change. So the emitter is called inside a catch that
 * swallows, and the failure goes unreported — there is nowhere to report
 * a logger's failure except the logger.
 */

import type { ActivityEntityType, ActivityVisibility } from "@openlaw/db";

/**
 * One appended entry, as it leaves the process. Flat and fully
 * self-describing: a SIEM indexes fields, and a consumer of these lines
 * has neither our schema nor our joins. The action is the row's own
 * slug and the payload is the row's own payload, unread and unshaped —
 * the log is append-only, so a line emitted today has to keep meaning
 * what it meant when a reader opens it in three years.
 */
export interface ActivityEvent {
  id: string;
  /** ISO 8601 with an offset, as the row was written. */
  createdAt: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  actorId: string | null;
  action: string;
  visibility: ActivityVisibility;
  payload: Record<string, unknown>;
}

/**
 * Where an emitted event goes. Synchronous by contract: a logger's
 * `info` is synchronous, and an emitter that returned a promise would
 * put an unobserved rejection behind every mutation.
 */
export type ActivityEmitter = (event: ActivityEvent) => void;

/** Nothing is shipped until an app says where. */
const SILENT: ActivityEmitter = () => {};

let emitter: ActivityEmitter = SILENT;

/** Points emission at a sink. `buildApp` calls this with its logger. */
export function setActivityEmitter(next: ActivityEmitter): void {
  emitter = next;
}

/** Drops emission on the floor again — the state a fresh process is in. */
export function clearActivityEmitter(): void {
  emitter = SILENT;
}

/**
 * Emits one event, and swallows whatever the sink does about it.
 *
 * The swallow is the decision, not an oversight: the mutation and its
 * in-app entry are already committed or committing, and the caller is
 * inside a transaction that must not roll back over a log line. See the
 * header.
 */
export function emitActivityEvent(event: ActivityEvent): void {
  try {
    emitter(event);
  } catch {
    // Deliberately silent. The sink is the logger; a logger that cannot
    // take this line cannot take a line about it either.
  }
}
