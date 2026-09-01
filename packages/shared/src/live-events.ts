// SPDX-License-Identifier: AGPL-3.0-only

import type { ActivityAction } from "./activity.js";

/** The one Postgres channel every API and worker process uses (TECH-009). */
export const LIVE_EVENT_CHANNEL = "openlaw_live_events";

/** The three prompts carried by the live channel. */
export const LIVE_EVENT_KINDS = ["record", "bell", "inbox"] as const;
export type LiveEventKind = (typeof LIVE_EVENT_KINDS)[number];

/** Record surfaces that can hold a scoped live connection. */
export const LIVE_RECORD_ENTITY_TYPES = [
  "matter",
  "contract",
  "request",
  "entity",
  "knowledge_item",
] as const;
export type LiveRecordEntityType = (typeof LIVE_RECORD_ENTITY_TYPES)[number];

/** DD-016's record tiers. Administrator-only audit entries have no record stream. */
export const LIVE_EVENT_VISIBILITIES = ["legal_only", "working_team", "full_thread"] as const;
export type LiveEventVisibility = (typeof LIVE_EVENT_VISIBILITIES)[number];

/** An activity entry was appended on one record. Content stays on the read route. */
export interface RecordLiveEvent {
  kind: "record";
  action: ActivityAction;
  entityType: LiveRecordEntityType;
  entityId: string;
  entryId: string;
  visibility: LiveEventVisibility;
}

/** A notification row landed for one named user. */
export interface BellLiveEvent {
  kind: "bell";
  userId: string;
}

/** The shared Inbox queue changed. The count is the whole live fact. */
export interface InboxLiveEvent {
  kind: "inbox";
  total: number;
}

export type LiveEvent = RecordLiveEvent | BellLiveEvent | InboxLiveEvent;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Parses one Postgres notification before it reaches a browser.
 *
 * Postgres authenticates the process, not the payload. A bad publisher
 * must not make the listening API throw or forward a malformed frame.
 */
export function parseLiveEvent(value: unknown): LiveEvent | null {
  if (!isObject(value)) return null;
  if (value.kind === "bell") {
    return isNonEmptyString(value.userId) ? { kind: "bell", userId: value.userId } : null;
  }
  if (value.kind === "inbox") {
    return typeof value.total === "number" && Number.isSafeInteger(value.total) && value.total >= 0
      ? { kind: "inbox", total: value.total }
      : null;
  }
  if (value.kind !== "record") return null;
  const entityTypes: readonly unknown[] = LIVE_RECORD_ENTITY_TYPES;
  const visibilities: readonly unknown[] = LIVE_EVENT_VISIBILITIES;
  return isNonEmptyString(value.action) &&
    entityTypes.includes(value.entityType) &&
    isNonEmptyString(value.entityId) &&
    isNonEmptyString(value.entryId) &&
    visibilities.includes(value.visibility)
    ? {
        kind: "record",
        action: value.action as ActivityAction,
        entityType: value.entityType as LiveRecordEntityType,
        entityId: value.entityId,
        entryId: value.entryId,
        visibility: value.visibility as LiveEventVisibility,
      }
    : null;
}
