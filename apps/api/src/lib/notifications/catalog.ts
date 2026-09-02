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
 * The event groups' defaults, in NOT-002's own words.
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
   * Knowledge publication is ambient: it writes no event or bell item.
   * The email choice controls the Knowledge section read directly by
   * the morning round.
   */
  knowledge: { inApp: true, email: true, emailTiming: "digest" },
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
  "matter.task_assigned": "assigned_to_you",
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
  "date.obligation_approaching": "dates_approaching",
  "briefing.ready": "dates_approaching",
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
  // The daily briefing's bell row points back to Home. It announces the
  // email that already left, so routing it into another email would loop
  // the summary through the digest machinery.
  if (eventType === "briefing.ready") return "none";
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
 * Which side of a Request an event is addressed to (M21/4, M21/5).
 *
 * `requester` is DD-013's one person, and every group-5 event is theirs.
 * `inbox` is INT-006's Member+ — group 4's arrival, and from M21/5 a
 * group-1 mention on a Request thread, because being named on a Request
 * is being named as staff.
 */
export type RequestSide = "requester" | "inbox";

/**
 * Which side each group speaks to when its event is about a Request, and
 * `null` for a group that raises no Request event at all.
 *
 * **The group decides, not the slug.** `comment.mentioned` is one slug on
 * two records, so a per-slug table would have to say two things about it;
 * the group says one thing about every event in it, which is why the side
 * is read here rather than passed by each method.
 *
 * **`null` is a third answer, not a missing one.** Groups 2 and 3 are a
 * contract's: a Request has no team table for a roster to come from and
 * no tracked dates (CTR-009), and its thread raises group 5 and group 1
 * instead. Naming them here as neither side is what keeps them off both
 * bells — the milestone that does raise one of them on a Request owes
 * this line a real answer first.
 *
 * Total over the group union, so a group added to the schema stops
 * compiling until somebody has chosen one of the three.
 */
const REQUEST_SIDE_BY_GROUP: Record<NotificationEventGroup, RequestSide | null> = {
  /** Group 1 — done *to* you. On a Request that is a mention, and a
   * Request's mention candidates are its Requester and Member+ staff
   * (CMT-010); the Requester's own news is group 5's, so what is left
   * here is the staff side. */
  assigned_to_you: "inbox",
  /** Group 2 — ambient movement on a record's roster. Neither side. */
  activity_on_your_records: null,
  /** Group 3 — dates approaching. Neither side. */
  dates_approaching: null,
  /** Group 4 — the Inbox's own arrival (INT-006). */
  new_requests: "inbox",
  /** Knowledge has no Request event. */
  knowledge: null,
  /** Group 5 — the portal audience's own events (DD-013). */
  requester_events: "requester",
};

/**
 * Which side of a Request one event speaks to — the **reach** question,
 * which every row that exists has to have an answer to.
 *
 * Asked of a raw slug, because every caller reads one off a row: the
 * fan-out's wall step, the send job's re-check of it, and the template
 * layer choosing which of the two messages this is. A slug this build
 * does not know, and a group named as neither side, both answer
 * `requester` — the narrower of the two standings, and therefore the safe
 * way to be wrong about a row nothing should have written.
 */
export function requestSideOf(eventType: string): RequestSide {
  return (Object.hasOwn(REQUEST_SIDE, eventType) ? REQUEST_SIDE[eventType] : null) ?? "requester";
}

/**
 * Every slug on one side of a Request — the **bell** question, which only
 * a decided group answers.
 *
 * A group named as neither side is on no bell rather than on the narrower
 * one: an item nobody has placed is better missing than shown to the
 * wrong reader, because a missing item gets noticed and a leaked one does
 * not. So the two answers do not cover the catalog between them, and that
 * gap is the decision.
 */
export function requestEventTypesOn(side: RequestSide): NotificationEventType[] {
  return NOTIFICATION_EVENT_TYPES.filter((eventType) => REQUEST_SIDE[eventType] === side);
}

/** Each slug's side, resolved once through its group — every caller asks
 * per row. Own-key reads only, because the slug comes off a row and
 * `event_type` deliberately carries no CHECK (NOT-002). */
const REQUEST_SIDE: Readonly<Record<string, RequestSide | null>> = Object.fromEntries(
  NOTIFICATION_EVENT_TYPES.map((eventType) => [
    eventType,
    REQUEST_SIDE_BY_GROUP[EVENT_GROUP[eventType]],
  ]),
);

/** Both channels, as `notification_preferences` names them. */
export const CHANNELS: readonly NotificationChannel[] = ["in_app", "email"];
