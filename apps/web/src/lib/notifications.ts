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
 * **One narrator, two bells** (M20/9). NOT-001 has one notification
 * system on two surfaces, and an item names the record it is about
 * whichever panel drew it: a `contract` row names a contract and
 * addresses a record section, a `request` row names a Request and
 * addresses the detail its reader works on. The arm decides the sentence
 * and the address, so neither surface has to tell this module which one
 * it is — which is what lets a Member+ hold two rows about one Request,
 * the Inbox's arrival and their own receipt, and have each point where
 * its reader can act.
 *
 * **Three properties are the same as `activity.ts`'s, for the same
 * reasons.** Every payload read is defensive, because a row outlives the
 * build that wrote it and `event_type` deliberately carries no CHECK
 * (NOT-002). The lookup is by own key only, so a row whose slug is
 * `__proto__` reads the fallback rather than `Object.prototype`. And
 * nothing here throws — a bell that cannot render one item must still
 * render the rest.
 *
 * **The catalog is narrated in full, not event by event.** All seventeen
 * of NOT-002's slugs have an arm here, including the two of group 5 that
 * wait for M21's disposition routes: that is what makes the slices
 * behind #318–#321, #382, and #415 an emission rather than a surface
 * change.
 * Every arm reads only the two keys the fan-out already writes — the
 * record's number and its name — plus the actor's name where the event
 * has one, so no arm is a guess about a payload nobody has written yet.
 *
 * **The address is a section, not a record.** An approval request opens
 * the Approvals section (DES-032's routed tabs); a task opens Tasks;
 * paper opens Documents. Landing on the record's overview and making
 * the reader find the thing they were told about is one click short of
 * the promise, and the sections are addresses precisely so a prompt can
 * name one. A Request is the exception that proves it: its detail is one
 * page with no tabs to name, so a group-5 item opens
 * `/portal/requests/{number}` and the staff side's rows — group 4's
 * arrival and a mention on a Request thread — open the staff detail at
 * `/inbox/{number}`.
 */

import {
  Activity,
  AtSign,
  CalendarClock,
  CalendarDays,
  CircleX,
  FilePlus2,
  GitCommitHorizontal,
  Inbox,
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

/**
 * The staff list's own response, which the portal list's matches
 * exactly: the two mounts are one implementation over two scopes
 * (M20/9), so an item is an item whichever bell answered it.
 */
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
   * Null is reachable only for a row about an entity kind this build has
   * no route for, or one whose payload carries no number to address it
   * by. The two bells answer `contract` and `request` rows and nothing
   * else — each scope predicate fails closed on anything it has no rule
   * for — so it does not happen, and a row that cannot be addressed is
   * drawn as a sentence rather than as a link to nowhere.
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

/** One arm of the catalog: a glyph, a sentence, and where the sentence
 * points. */
interface Arm {
  icon: LucideIcon;
  message: MessageDescriptor;
  /**
   * The record section this event belongs to, appended to the record's
   * own address. Empty means the record's overview, which is what the
   * bare URL lands on (DES-032).
   */
  section?: "documents" | "approvals" | "key-dates" | "tasks" | "obligations";
  /**
   * A Request row for this event is the **staff side's**, so it addresses
   * the staff detail rather than the portal one: group 4's arrival
   * (INT-006) and group 1's mention on a Request thread (M21/5).
   *
   * It is a fact about the event and not about the reader: one act
   * writes an arrival for staff and a receipt for the Requester, and the
   * two rows have to point at two different pages even when one person
   * holds both.
   *
   * It is read only for a `request` row, so an arm that is a contract's
   * as well — the mention is one slug on two records — carries it
   * harmlessly.
   */
  staffSide?: true;
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
  "matter.task_assigned": {
    icon: SquareCheck,
    section: "tasks",
    message: defineMessage({
      id: "notifications.matter.taskAssigned",
      defaultMessage:
        "{hasActor, select, yes {{actor} assigned you a Task on {contract}} " +
        "other {You were assigned a Task on {contract}}}",
    }),
  },
  // One slug, two records (M21/5). The sentence names whichever record
  // the row is about, and `staffSide` sends a Request's mention to the
  // staff detail: a mention on a Request is a mention of a triager, and
  // the Requester is never mention-notified at all.
  "comment.mentioned": {
    icon: AtSign,
    staffSide: true,
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
  "date.obligation_approaching": {
    icon: CalendarClock,
    section: "obligations",
    message: defineMessage({
      id: "notifications.date.obligation",
      defaultMessage: "{obligation} on {contract} is coming up",
    }),
  },
  "briefing.ready": {
    icon: CalendarDays,
    message: defineMessage({
      id: "notifications.briefing.ready",
      defaultMessage: "Your daily briefing is ready",
    }),
  },
  // Group 4 — the Inbox's own arrival (INT-006, M21/4). The one Request
  // arm that lands on the **staff** bell, and the one that addresses the
  // staff detail rather than the portal: the reader is a triager, and
  // the Request is work rather than news about their own ask.
  "request.submitted": {
    icon: Inbox,
    staffSide: true,
    message: defineMessage({
      id: "notifications.request.submitted",
      defaultMessage:
        "{hasActor, select, yes {{actor} submitted a new request: {request}} " +
        "other {A new request arrived: {request}}}",
    }),
  },
  // Group 5 — the portal audience's own events (INT-001, M20/8). These
  // land on the portal bell and nowhere else, because the staff centre's
  // scope answers only the staff side's Request rows. They name no
  // section: a Request has one page and it is the whole of what a
  // requester can open.
  "request.created": {
    icon: Inbox,
    message: defineMessage({
      id: "notifications.request.created",
      defaultMessage: "Legal has received your request {request}",
    }),
  },
  "request.status_changed": {
    icon: GitCommitHorizontal,
    message: defineMessage({
      id: "notifications.request.statusChanged",
      defaultMessage: "The status of your request {request} changed",
    }),
  },
  // The one arm here with an actor: a reply is somebody's act, and the
  // requester's own replies never reach them (M20/8).
  "request.replied": {
    icon: MessageSquare,
    message: defineMessage({
      id: "notifications.request.replied",
      defaultMessage:
        "{hasActor, select, yes {{actor} replied on your request {request}} " +
        "other {Legal replied on your request {request}}}",
    }),
  },
  // The reason itself stays on the Request (INT-006). The item says "no"
  // arrived and points at where the why is written.
  "request.declined": {
    icon: CircleX,
    message: defineMessage({
      id: "notifications.request.declined",
      defaultMessage: "Legal declined your request {request}",
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

const NUMBERED_MATTER = defineMessage({
  id: "notifications.matterNumber",
  defaultMessage: "M-{number}",
});

/** The same for a Request, whose human reference is R-### (INT-002). */
const NUMBERED_REQUEST = defineMessage({
  id: "notifications.requestNumber",
  defaultMessage: "R-{number}",
});

/** What a record with neither a title nor a number is called. */
const UNNAMED = defineMessage({
  id: "notifications.unnamedRecord",
  defaultMessage: "a record",
});

/** What an Obligation whose payload carries no label is called. */
const UNNAMED_OBLIGATION = defineMessage({
  id: "notifications.unnamedObligation",
  defaultMessage: "an obligation",
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

/**
 * How the sentence names the record: its snapshotted title or summary,
 * else its number, else neither.
 *
 * Two entity kinds, two pairs of payload keys, and the fallback chain is
 * the same for both — which is the point of asking it here rather than
 * in each arm.
 */
function recordName(intl: IntlShape, item: BellItem): string {
  if (item.entityType === "entity") {
    return text(item.payload, "entityLegalName") ?? intl.formatMessage(UNNAMED);
  }
  if (item.entityType === "request") {
    const summary = text(item.payload, "requestSummary");
    if (summary) return summary;
    const number = wholeNumber(item.payload, "requestNumber");
    return number === null
      ? intl.formatMessage(UNNAMED)
      : intl.formatMessage(NUMBERED_REQUEST, { number: String(number) });
  }
  if (item.entityType === "matter") {
    const title = text(item.payload, "matterTitle");
    if (title) return title;
    const number = wholeNumber(item.payload, "matterNumber");
    return number === null
      ? intl.formatMessage(UNNAMED)
      : intl.formatMessage(NUMBERED_MATTER, { number: String(number) });
  }
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
 * The address is built from the payload's number rather than from
 * `entityId`, because a record's own URL is its number (DD-011's human
 * reference, INT-002's R-###) and the row's `entity_id` is the internal
 * one. An item carrying no number cannot be addressed and says so.
 *
 * **A Request has one address per surface and no sections.** A
 * contract's prompt names the section it is about (DES-049 point 9)
 * because a contract record has routed tabs; a Request's whole page is
 * the answer, so a group-5 item lands on the portal detail and a staff
 * side's row — the arrival, or a mention — on the staff one (M21/5).
 * Which of the two is the arm's to say: the event knows who it was
 * written for, and the reader's role does not come into it.
 */
function hrefFor(item: BellItem, arm: Arm | undefined): string | null {
  if (item.eventType === "briefing.ready") return "/";
  if (item.entityType === "entity") {
    return arm?.section
      ? `/entities/${item.entityId}/${arm.section}`
      : `/entities/${item.entityId}`;
  }
  if (item.entityType === "request") {
    const number = wholeNumber(item.payload, "requestNumber");
    if (number === null) return null;
    return arm?.staffSide ? `/inbox/${number}` : `/portal/requests/${number}`;
  }
  if (item.entityType === "matter") {
    const number = wholeNumber(item.payload, "matterNumber");
    if (number === null) return null;
    return arm?.section ? `/matters/${number}/${arm.section}` : `/matters/${number}`;
  }
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
  const record = recordName(intl, item);
  const href = hrefFor(item, arm);
  if (!arm) {
    return {
      icon: Activity,
      sentence: intl.formatMessage(UNKNOWN, { contract: record, event: item.eventType }),
      href,
    };
  }
  const actor = text(item.payload, "actorName");
  return {
    icon: arm.icon,
    sentence: intl.formatMessage(arm.message, {
      // The one name, offered under both spellings. A contract's arms
      // call it `{contract}` and a Request's call it `{request}`,
      // because a translator reading one sentence should see the noun
      // that sentence is about — and ICU takes what it is given and
      // ignores what it does not use, which is the same property
      // `hasActor` below relies on.
      contract: record,
      request: record,
      obligation: text(item.payload, "label") ?? intl.formatMessage(UNNAMED_OBLIGATION),
      actor: actor ?? "",
      // Every arm gets this whether or not its sentence selects on it.
      hasActor: actor ? "yes" : "no",
    }),
    href,
  };
}
