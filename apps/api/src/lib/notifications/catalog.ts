// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The event catalog (NOT-002, NOT-003): which group an event is in, and
 * what a person who has never opened settings gets from it.
 *
 * **It is enumerated in full here, not event by event as the milestones
 * that fire them arrive.** The whole point of a catalog is that a later
 * slice adds an event rather than a mechanism: the group decides the
 * audience rule, the defaults decide the channels, and the fan-out
 * behind the seam reads both. An event added below is a line in a table;
 * an event added without this table would be a second copy of the
 * decision.
 *
 * **Group 4 was a slot until M21/4**, and what it took to fire was one
 * line in each of the two tables below: the event's group, and the
 * group's email timing. That is the whole bill for a group that shipped
 * ahead of its events, and it is why the Inbox added a call rather than
 * a mechanism. Group 5 was a slot on the same terms until M20/8 named
 * its four events.
 *
 * **Defaults follow interruptiveness** (NOT-002). Things done *to* you
 * interrupt; ambient activity does not; and every one of them is the
 * person's to change, so nothing here is enforcement.
 */

import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel,
  type NotificationEventGroup,
  type NotificationEventType,
} from "@openlaw/db";

/**
 * When email leaves for an event group (NOT-003).
 *
 * `immediate` is one message per notification, sent off the pipeline's
 * own queue. `digest` is one morning briefing for the whole day's
 * reminders — the renewal calendar as a briefing, and the reason group 3
 * does not send nine emails. `none` is a group email never leaves for,
 * whatever a preference says: there is nothing to opt into.
 */
export const EMAIL_TIMINGS = ["immediate", "digest", "none"] as const;
export type EmailTiming = (typeof EMAIL_TIMINGS)[number];

/** What one event group does, before anybody has expressed an opinion. */
export interface EventGroupPolicy {
  /** The in-app default. In-app is default-on for every group
   * (NOT-001) — the feed is the cheap channel. */
  inApp: boolean;
  /** The email default. */
  email: boolean;
  /** How email leaves, when it leaves at all (NOT-003). */
  emailTiming: EmailTiming;
}

/**
 * The five groups' defaults, in NOT-002's own words.
 *
 * The map is total over the group union, so a group added to the schema
 * stops compiling here until somebody has decided what it does by
 * default — which is the one decision a new group cannot be allowed to
 * inherit by accident.
 */
export const EVENT_GROUP_POLICY: Record<NotificationEventGroup, EventGroupPolicy> = {
  /** Group 1 — done *to* you: it interrupts. */
  assigned_to_you: { inApp: true, email: true, emailTiming: "immediate" },
  /**
   * Group 2 — ambient movement: the feed, and email only if asked for.
   *
   * `immediate` is the **timing**, not the default: `email: false` is
   * what makes it opt-in, and the timing says what happens once
   * somebody has opted in. It shipped as `none` in M18/4, when nothing
   * could opt in yet and a `true` row would have claimed a debt the
   * system could not pay; the preferences pane is what makes the
   * opt-in real, so the timing is real with it (NOT-002's M18/4
   * addendum).
   */
  activity_on_your_records: { inApp: true, email: false, emailTiming: "immediate" },
  /** Group 3 — dates: the bell per date, and one briefing a day
   * (NOT-003). */
  dates_approaching: { inApp: true, email: true, emailTiming: "digest" },
  /**
   * Group 4 — Inbox arrivals: the queue is already the surface, so the
   * mail is opt-in.
   *
   * `immediate` is the **timing**, not the default, exactly as group
   * 2's is: `email: false` is what keeps it opt-in, and the timing only
   * says what happens once a Member+ has said yes. It shipped as `none`
   * while nothing fired the group, because a `true` row would have
   * claimed a debt the system could not pay; M21/4 gives the group its
   * first event, so the timing is real with it (NOT-002's M21/4
   * addendum, taking M18/5's shape).
   */
  new_requests: { inApp: true, email: false, emailTiming: "immediate" },
  /**
   * Group 5 — the portal audience's own events (INT-001/003).
   *
   * The one group whose email is on by default and interrupts. A
   * Requester does not live in the app: the portal is a place they come
   * back to, and NOT-001 made email the reach-out channel precisely so
   * that they never have to poll (INT-003 declined the status-poke
   * button on that promise).
   */
  requester_events: { inApp: true, email: true, emailTiming: "immediate" },
};

/**
 * Which group each event is in.
 *
 * Total over the event union for the group map's reason: an event added
 * to the schema and not placed in a group would have no audience rule
 * and no defaults, and the compiler is the only thing that can insist
 * somebody chooses.
 */
export const EVENT_GROUP: Record<NotificationEventType, NotificationEventGroup> = {
  // Group 1 — assigned to you. The mention is here rather than in
  // group 2 because a mention is done *to* you: somebody addressed a
  // question to you by name (settled in the M18 spec's grill).
  "contract.owner_assigned": "assigned_to_you",
  "contract.task_assigned": "assigned_to_you",
  "approval.requested": "assigned_to_you",
  "comment.mentioned": "assigned_to_you",
  // Group 2 — activity on your records.
  "contract.status_changed": "activity_on_your_records",
  "comment.posted": "activity_on_your_records",
  "document.added": "activity_on_your_records",
  "document.version_added": "activity_on_your_records",
  "envelope.ended": "activity_on_your_records",
  // Group 3 — dates approaching.
  "date.key_date_approaching": "dates_approaching",
  "date.notice_deadline_approaching": "dates_approaching",
  "date.expiry_approaching": "dates_approaching",
  // Group 4 — new requests. One act, two audiences: this is the staff
  // side of a submission (INT-006), and `request.created` below is the
  // Requester's own receipt for the same moment. They are two events
  // because they have two audiences, two defaults, and two bells.
  "request.submitted": "new_requests",
  // Group 5 — the portal audience's own events. The decline is here
  // rather than beside the status change it also is, because INT-006
  // makes "no" arrive with a why and a reason is a different message.
  "request.created": "requester_events",
  "request.status_changed": "requester_events",
  "request.replied": "requester_events",
  "request.declined": "requester_events",
};

/** What one person gets on one event group, once their own rows have
 * been read over the defaults. */
export interface ChannelChoice {
  inApp: boolean;
  email: boolean;
}

/**
 * One group's defaults as a channel choice — what somebody who has
 * never opened the Notifications pane gets.
 *
 * A group whose email never leaves (`none`) answers `email: false`
 * whatever the default says, so no caller has to ask the timing
 * question a second time to avoid writing a row it would never send.
 */
export function defaultChoice(group: NotificationEventGroup): ChannelChoice {
  const policy = EVENT_GROUP_POLICY[group];
  return { inApp: policy.inApp, email: policy.email && policy.emailTiming !== "none" };
}

/** How email leaves for one event, or `none` when it does not. */
export function emailTimingOf(eventType: NotificationEventType): EmailTiming {
  return EVENT_GROUP_POLICY[EVENT_GROUP[eventType]].emailTiming;
}

/**
 * Every event slug in one group.
 *
 * Derived from {@link EVENT_GROUP} rather than listed a second time, so
 * an event added there is in this answer at once. The bell's two scope
 * predicates ask it: NOT-001 has one table and two surfaces, and which
 * surface a row belongs to is a fact about the group's audience — group
 * 4 is the Inbox's own staff group, group 5 is the portal's.
 */
export function eventTypesIn(group: NotificationEventGroup): NotificationEventType[] {
  // The schema's own list rather than `Object.keys`, which answers
  // `string[]` and would need a cast back into the union. The map above
  // is total over it, so this reads every slug and invents none.
  return NOTIFICATION_EVENT_TYPES.filter((eventType) => EVENT_GROUP[eventType] === group);
}

/**
 * Whether an event is the Inbox's own — the staff side of a Request
 * (INT-006) rather than the Requester's (DD-013).
 *
 * Asked of a raw slug, because both callers read one off a row: the
 * fan-out's wall step and the send job's re-check of it. A slug this
 * build does not know answers `false`, which is the narrower of the two
 * rules and therefore the safe way to be wrong.
 */
export function isInboxEvent(eventType: string): boolean {
  return INBOX_EVENTS.has(eventType);
}

/** Group 4's slugs, as a set of plain strings — built once, because both
 * callers ask per row. */
const INBOX_EVENTS: ReadonlySet<string> = new Set<string>(eventTypesIn("new_requests"));

/** Both channels, as `notification_preferences` names them. */
export const CHANNELS: readonly NotificationChannel[] = ["in_app", "email"];
