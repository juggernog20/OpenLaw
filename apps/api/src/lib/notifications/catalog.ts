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
 * **Groups 4 and 5 are slots.** `new_requests` waits for the Inbox
 * (M21) and `requester_events` for the portal (M20), so neither names
 * an event yet. The group value ships anyway, because
 * `notification_preferences` keys on it and a person may express an
 * opinion about a group before anything in it has fired.
 *
 * **Defaults follow interruptiveness** (NOT-002). Things done *to* you
 * interrupt; ambient activity does not; and every one of them is the
 * person's to change, so nothing here is enforcement.
 */

import type {
  NotificationChannel,
  NotificationEventGroup,
  NotificationEventType,
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
  /** Group 2 — ambient movement: the feed, and email only if asked
   * for. */
  activity_on_your_records: { inApp: true, email: false, emailTiming: "none" },
  /** Group 3 — dates: the bell per date, and one briefing a day
   * (NOT-003). */
  dates_approaching: { inApp: true, email: true, emailTiming: "digest" },
  /** Group 4 — Inbox arrivals: the queue is already the surface, so the
   * mail is opt-in. Nothing fires it until M21. */
  new_requests: { inApp: true, email: false, emailTiming: "none" },
  /** Group 5 — the portal audience's own events. Nothing fires it until
   * M20. */
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

/** Both channels, as `notification_preferences` names them. */
export const CHANNELS: readonly NotificationChannel[] = ["in_app", "email"];
