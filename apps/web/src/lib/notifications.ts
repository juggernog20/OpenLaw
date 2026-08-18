// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bell's narration layer (NOT-001, NOT-002, NOT-005): one
 * notification in, one sentence and one address out.
 *
 * The API answers a slug, a payload snapshot, and an entity reference.
 * A reader wants a prompt — "Nadia Counsel asked you to approve
 * Acme MSA" — and somewhere to go. This module is the whole of that
 * translation, and it is the activity feed's narration layer applied to
 * a second table: a lookup table of arms, an ICU message per arm, and a
 * fallback for a slug this build has never heard of.
 *
 * **Three properties are the same as `activity.ts`'s, for the same
 * reasons.** Every payload read is defensive, because a row outlives the
 * build that wrote it and `event_type` deliberately carries no CHECK
 * (NOT-002). The lookup is by own key only, so a row whose slug is
 * `__proto__` reads the fallback rather than `Object.prototype`. And
 * nothing here throws — a bell that cannot render one item must still
 * render the rest.
 *
 * **The catalog is narrated in full, not event by event.** NOT-002's
 * twelve slugs all have an arm here, though M18/1 fires one of them:
 * that is what makes the slices behind #318–#321 an emission rather
 * than a surface change. Every arm reads only the two keys the fan-out
 * already writes — the contract's number and its title — plus the
 * actor's name where the event has one, so no arm is a guess about a
 * payload nobody has written yet.
 *
 * **The address is a section, not a record.** An approval request opens
 * the Approvals section (DES-032's routed tabs); a task opens Tasks;
 * paper opens Documents. Landing on the record's overview and making
 * the reader find the thing they were told about is one click short of
 * the promise, and the sections are addresses precisely so a prompt can
 * name one.
 */

import {
  Activity,
  AtSign,
  CalendarClock,
  FilePlus2,
  GitCommitHorizontal,
  MessageSquare,
  PenLine,
  SquareCheck,
  Stamp,
  Upload,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { defineMessage, type IntlShape, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";

type BellResponse =
  paths["/api/v1/notifications"]["get"]["responses"]["200"]["content"]["application/json"];

/** One bell item, as the API answers it. */
export type BellItem = BellResponse["notifications"][number];

/** One item, ready to draw. */
export interface NarratedNotification {
  /** The glyph for the event's family, on DES-026's medallion. */
  icon: LucideIcon;
  /** The prompt: what happened, and to which record. */
  sentence: string;
  /**
   * Where the item goes, or null when this build cannot address it.
   *
   * Null is reachable only for a row about an entity kind this surface
   * has no route for. The read API answers `contract` rows alone today
   * (its scope predicate fails closed on anything else), so it does not
   * happen — and a row that cannot be addressed is drawn as a sentence
   * rather than as a link to nowhere.
   */
  href: string | null;
}

/**
 * An item's own data, as the table stores it: whatever the slug's writer
 * put there. Every read below goes through {@link text} or
 * {@link wholeNumber}, because the shapes are as old as the rows.
 */
type Payload = BellItem["payload"];

/** A payload value as a non-empty string, or null. */
function text(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A payload value as a whole number above zero, or null. Contract
 * numbers are the only one of these, and a zero is not one. */
function wholeNumber(payload: Payload, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** One arm of the catalog: a glyph, a sentence, and the record section
 * the sentence is about. */
interface Arm {
  icon: LucideIcon;
  message: MessageDescriptor;
  /**
   * The record section this event belongs to, appended to the record's
   * own address. Empty means the record's overview, which is what the
   * bare URL lands on (DES-032).
   */
  section?: "documents" | "approvals" | "key-dates" | "tasks";
}

/**
 * NOT-002's catalog, narrated.
 *
 * A plain object rather than a `Record` over a union: `event_type` is
 * `z.string()` on the wire on purpose, so there is no closed type on
 * this side of it for a compiler to hold. The keys below are this
 * build's vocabulary and {@link armFor} answers `undefined` for the
 * rest.
 *
 * Every `defaultMessage` spells its `hasActor` select out in full rather
 * than sharing a constant: the ICU extractor reads the source rather
 * than running it, so a message assembled from a variable is a message
 * it cannot see.
 */
const ARMS: Readonly<Record<string, Arm>> = {
  // Group 1 — done *to* you. Every sentence here says "you", because
  // that is what puts the event in this group (NOT-002).
  "approval.requested": {
    icon: Stamp,
    section: "approvals",
    message: defineMessage({
      id: "notifications.approval.requested",
      defaultMessage:
        "{hasActor, select, yes {{actor} asked you to approve {contract}} " +
        "other {You were asked to approve {contract}}}",
    }),
  },
  "contract.owner_assigned": {
    icon: UserPlus,
    message: defineMessage({
      id: "notifications.contract.ownerAssigned",
      defaultMessage:
        "{hasActor, select, yes {{actor} made you the Owner of {contract}} " +
        "other {You were made the Owner of {contract}}}",
    }),
  },
  "contract.task_assigned": {
    icon: SquareCheck,
    section: "tasks",
    message: defineMessage({
      id: "notifications.contract.taskAssigned",
      defaultMessage:
        "{hasActor, select, yes {{actor} assigned you a task on {contract}} " +
        "other {You were assigned a task on {contract}}}",
    }),
  },
  "comment.mentioned": {
    icon: AtSign,
    message: defineMessage({
      id: "notifications.comment.mentioned",
      defaultMessage:
        "{hasActor, select, yes {{actor} mentioned you on {contract}} " +
        "other {You were mentioned on {contract}}}",
    }),
  },
  // Group 2 — ambient movement on records you are on.
  "contract.status_changed": {
    icon: GitCommitHorizontal,
    message: defineMessage({
      id: "notifications.contract.statusChanged",
      defaultMessage:
        "{hasActor, select, yes {{actor} changed the status of {contract}} " +
        "other {The status of {contract} changed}}",
    }),
  },
  "comment.posted": {
    icon: MessageSquare,
    message: defineMessage({
      id: "notifications.comment.posted",
      defaultMessage:
        "{hasActor, select, yes {{actor} commented on {contract}} " +
        "other {A comment was posted on {contract}}}",
    }),
  },
  "document.added": {
    icon: FilePlus2,
    section: "documents",
    message: defineMessage({
      id: "notifications.document.added",
      defaultMessage:
        "{hasActor, select, yes {{actor} added a document to {contract}} " +
        "other {A document was added to {contract}}}",
    }),
  },
  "document.version_added": {
    icon: Upload,
    section: "documents",
    message: defineMessage({
      id: "notifications.document.versionAdded",
      defaultMessage:
        "{hasActor, select, yes {{actor} added a version to {contract}} " +
        "other {A version was added to {contract}}}",
    }),
  },
  // The provider ends an envelope as often as a person does (CTR-013),
  // so this one names no actor at all rather than selecting on one.
  "envelope.ended": {
    icon: PenLine,
    message: defineMessage({
      id: "notifications.envelope.ended",
      defaultMessage: "Signing ended on {contract}",
    }),
  },
  // Group 3 — dates arriving. Nobody acts, so nobody is named.
  "date.key_date_approaching": {
    icon: CalendarClock,
    section: "key-dates",
    message: defineMessage({
      id: "notifications.date.keyDate",
      defaultMessage: "A key date on {contract} is coming up",
    }),
  },
  "date.notice_deadline_approaching": {
    icon: CalendarClock,
    section: "key-dates",
    message: defineMessage({
      id: "notifications.date.noticeDeadline",
      defaultMessage: "The notice deadline on {contract} is coming up",
    }),
  },
  "date.expiry_approaching": {
    icon: CalendarClock,
    section: "key-dates",
    message: defineMessage({
      id: "notifications.date.expiry",
      defaultMessage: "{contract} is expiring",
    }),
  },
};

/** What an item whose slug this build does not know reads as. It names
 * the record, because that is the part the reader can act on. */
const UNKNOWN = defineMessage({
  id: "notifications.unknown",
  defaultMessage: "{contract} — {event}",
});

/** What a record with no title in the payload is called. A row this old
 * is still a prompt about something, and the number addresses it. */
const NUMBERED = defineMessage({
  id: "notifications.contractNumber",
  defaultMessage: "contract {number}",
});

/** What a record with neither a title nor a number is called. */
const UNNAMED = defineMessage({
  id: "notifications.unnamedRecord",
  defaultMessage: "a record",
});

/**
 * The arm for a slug read off the wire, if this build has one.
 *
 * **By own key only**, for `activity.ts`'s reason: `ARMS` is an object
 * literal, so a bare index would answer for keys nobody wrote — a row
 * whose event is `constructor` would read a function. Nothing
 * constrains `event_type` (NOT-002), so the row can say anything.
 */
function armFor(eventType: string): Arm | undefined {
  return Object.hasOwn(ARMS, eventType) ? ARMS[eventType] : undefined;
}

/** How the sentence names the record: its snapshotted title, else its
 * number, else neither. */
function recordName(intl: IntlShape, item: BellItem): string {
  const title = text(item.payload, "contractTitle");
  if (title) return title;
  const number = wholeNumber(item.payload, "contractNumber");
  return number === null
    ? intl.formatMessage(UNNAMED)
    : intl.formatMessage(NUMBERED, { number: String(number) });
}

/**
 * Where an item goes.
 *
 * The address is built from the payload's contract number rather than
 * from `entityId`, because the record's own URL is its number
 * (DD-011's human reference) and the row's `entity_id` is the internal
 * one. An item carrying no number cannot be addressed and says so.
 */
function hrefFor(item: BellItem, arm: Arm | undefined): string | null {
  if (item.entityType !== "contract") return null;
  const number = wholeNumber(item.payload, "contractNumber");
  if (number === null) return null;
  return arm?.section ? `/contracts/${number}/${arm.section}` : `/contracts/${number}`;
}

/**
 * One item, narrated. Reads every payload key defensively; never throws;
 * a slug with no arm falls through to {@link UNKNOWN}.
 */
export function narrateNotification(intl: IntlShape, item: BellItem): NarratedNotification {
  const arm = armFor(item.eventType);
  const contract = recordName(intl, item);
  const href = hrefFor(item, arm);
  if (!arm) {
    return {
      icon: Activity,
      sentence: intl.formatMessage(UNKNOWN, { contract, event: item.eventType }),
      href,
    };
  }
  const actor = text(item.payload, "actorName");
  return {
    icon: arm.icon,
    sentence: intl.formatMessage(arm.message, {
      contract,
      actor: actor ?? "",
      // ICU takes what it is given and ignores what it does not use, so
      // every arm gets this whether or not its sentence selects on it.
      hasActor: actor ? "yes" : "no",
    }),
    href,
  };
}
