// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Notifications (NOT-001–NOT-005) — one system rendered on two surfaces.
 *
 * A notification is an **ephemeral prompt**, not a history. The activity
 * log (DD-017) is the durable record of what happened on a record; this
 * table is what tells a person that something they care about has
 * happened, once, in the two channels NOT-001 names: the bell in the
 * full platform (and, from M20, in the portal) and email.
 *
 * `entity_type` / `entity_id` is the polymorphic pair SCHEMA.md
 * documents as the exception to separate-tables-with-view, so there is
 * no foreign key on the entity. The CHECK admits the documented
 * vocabulary; the API writes `contract` alone until the other records
 * arrive.
 *
 * `event_type` carries **no** CHECK, and that is deliberate rather than
 * an oversight. It is `activity_log.action`'s reasoning one table over:
 * a row outlives the build that wrote it, so a closed constraint would
 * be a schema change every time the catalog grows and a read that could
 * not answer for a slug an older build wrote. The closed union lives in
 * TypeScript ({@link NOTIFICATION_EVENT_TYPES}), which is where the
 * compiler can hold both ends of it.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";

/**
 * NOT-002's five event groups, in the decision's own order.
 *
 * The group is what a preference is expressed about — a person turns
 * email off for "activity on my records", never for one verb — so it is
 * the column `notification_preferences` keys on and the unit the
 * defaults are stated in. Fixed rather than configurable: the defaults
 * follow interruptiveness and code branches on which group an event is
 * in, so a renameable label could not carry it.
 *
 * Groups 4 and 5 are **slots**. Their first events belong to the Inbox
 * (M21) and the portal (M20); the group ships now so that those
 * milestones add events rather than machinery.
 */
export const NOTIFICATION_EVENT_GROUPS = [
  /** Things done *to* you: an assignment, an approval request, a mention. */
  "assigned_to_you",
  /** Ambient movement on records you are on. */
  "activity_on_your_records",
  /** Tracked dates arriving, at the NOT-004 offsets. */
  "dates_approaching",
  /** Inbox arrivals (INT-006) — the slot; M21 fires it. */
  "new_requests",
  /** The portal audience's own events (INT-001/003/006) — the slot;
   * M20 fires it. */
  "requester_events",
] as const;
export type NotificationEventGroup = (typeof NOTIFICATION_EVENT_GROUPS)[number];

/**
 * The two channels one system renders on (NOT-001). Fixed for the event
 * group's reason: the fan-out branches on each of them by name.
 */
export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Every event the catalog names, grouped as NOT-002 groups them.
 *
 * The whole catalog for the three groups this milestone serves is here,
 * not only the one event M18/1 fires, because the enumeration is what
 * makes a later slice an event rather than a machinery change. Which of
 * them a build actually writes is a fact about the call sites, not
 * about this list.
 */
export const NOTIFICATION_EVENT_TYPES = [
  // Group 1 — assigned to you.
  /** A contract was handed to somebody as its Owner (CTR-004, MTR-003). */
  "contract.owner_assigned",
  /** A task on a contract was assigned (CTR-017, MTR-005). */
  "contract.task_assigned",
  /** Somebody was asked to sign a contract off (CTR-012). */
  "approval.requested",
  /** A comment addressed somebody by name (CMT-007, DD-016). */
  "comment.mentioned",
  // Group 2 — activity on your records.
  "contract.status_changed",
  "comment.posted",
  "document.added",
  "document.version_added",
  "envelope.ended",
  // Group 3 — dates approaching.
  "date.key_date_approaching",
  "date.notice_deadline_approaching",
  "date.expiry_approaching",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** What a notification can hang off. Only `contract` is written in M18;
 * the vocabulary is the `comments` and `activity_log` precedent. */
export const NOTIFICATION_ENTITY_TYPES = ["matter", "contract", "document", "request"] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export const notifications = pgTable(
  "notifications",
  {
    id: uuidPk(),
    // No cascade: a person is archived, never deleted (SET-005), so
    // there is nothing here for a delete to cascade from.
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** The catalog slug — see the file header on why it has no CHECK. */
    eventType: text("event_type").notNull(),
    entityType: text("entity_type", { enum: NOTIFICATION_ENTITY_TYPES }).notNull(),
    /** Polymorphic with entity_type, so no FK (SCHEMA.md). */
    entityId: text("entity_id").notNull(),
    /**
     * What the bell and the email need to render the item, taken at
     * write time.
     *
     * It is a snapshot on purpose: the record's title is what the item
     * says, and re-reading it at render time would need the reader to
     * reach a record the wall may since have closed. The deep link
     * shows current truth; the item says what was true when it fired.
     */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** NULL until the notification center has shown it (NOT-005:
     * opening the center marks the visible items read). */
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * Whether email was owed for this row **at the moment it was
     * written**, decided from the group's default and the person's own
     * preference.
     *
     * The refinement M18 settles: without it, "owed and never sent" and
     * "never owed" are the same NULL `emailed_at`, so nothing could
     * re-ask for a wake-up that was lost without emailing every person
     * who had switched email off. With it, the row is the record of
     * work owed — the M12 doctrine, applied to mail.
     *
     * It records the **debt, not the route**. A group-3 row owes an
     * email that leaves in the next morning digest (NOT-003) and is
     * `true` here just as a group-1 row is; which of them is woken by
     * the queue and which is picked up by the scheduled round is read
     * from the event's group, not from this column. A group whose email
     * never leaves owes none, whatever a stale preference row says.
     */
    emailOwed: boolean("email_owed").notNull().default(false),
    /** When the email went. NULL while it is still owed, and NULL for
     * ever on a row that never owed one. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /**
     * When the email was given up on: an install with no relay
     * configured, or a record that was walled off between the write and
     * the send.
     *
     * It is the M12 `failed` state said for mail — the row settles, so
     * nothing re-asks for it for ever — and it is a separate column
     * from `emailed_at` because "sent" and "skipped" are different
     * outcomes and the operator is owed the difference. Why it was
     * skipped is in the log, not in a column beside this one: the
     * executed-copy fetch settles its own failures the same way.
     */
    emailSkippedAt: timestamp("email_skipped_at", { withTimezone: true }),
    /**
     * The date a group-3 reminder is about, and how many days ahead of
     * it this row fired (NOT-004's offsets). Both NULL on every other
     * event.
     *
     * They are the two halves of the dedup identity the unique index
     * below holds, and they are **defined now and written from the
     * dates slice**: the identity is what makes a re-ask a no-op and
     * makes a date that *moves* correctly fire again for its new value,
     * and both properties have to be in the schema before the first
     * round runs rather than retrofitted around rows that have no key.
     */
    reminderDate: date("reminder_date"),
    reminderOffsetDays: integer("reminder_offset_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** "This person's bell, newest first" — the list's keyset order,
     * and the only read the center makes. */
    index("notifications_user_idx").on(table.userId, table.createdAt, table.id),
    /** The badge (NOT-005). Partial, because the count is only ever
     * asked of the unread ones and they are the small end of the
     * table. */
    index("notifications_unread_idx")
      .on(table.userId)
      .where(sql`read_at is null`),
    /**
     * The dedup identity of a date reminder (NOT-003/004): one person,
     * one event, one entity, one date value, one offset.
     *
     * Partial, because it is a rule about reminders and nothing else —
     * two approval requests for the same person on the same contract
     * are two real notifications, and a unique index over the whole
     * table would refuse the second one.
     */
    uniqueIndex("notifications_reminder_idx")
      .on(
        table.userId,
        table.eventType,
        table.entityId,
        table.reminderDate,
        table.reminderOffsetDays,
      )
      .where(sql`reminder_date is not null`),
    check(
      "notifications_entity_type_check",
      sql`${table.entityType} in ('matter', 'contract', 'document', 'request')`,
    ),
    /** A reminder carries both halves of its identity or neither. Half
     * a key is a row the unique index above cannot hold. */
    check(
      "notifications_reminder_pair",
      sql`(${table.reminderDate} is null) = (${table.reminderOffsetDays} is null)`,
    ),
    /** An email is sent or given up on, never both. */
    check(
      "notifications_email_outcome",
      sql`not (${table.emailedAt} is not null and ${table.emailSkippedAt} is not null)`,
    ),
    /** Neither outcome is reachable on a row that never owed an email.
     * This is what keeps `email_owed` readable as the record of work
     * owed rather than as a hint. */
    check(
      "notifications_email_owed",
      sql`${table.emailOwed} or (${table.emailedAt} is null and ${table.emailSkippedAt} is null)`,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;

/**
 * One person's answer for one event group on one channel (NOT-001).
 *
 * **The table is a set of overrides, not a full grid.** A person with no
 * row for a pair takes the group's default, which is stated in
 * application code (NOT-002) rather than seeded here — so a default that
 * changes reaches everybody who never expressed an opinion, and nobody
 * who did. That is why there is no `enabled` default on the column: a
 * row exists precisely because somebody said something.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    // No cascade, for the reason `notifications.user_id` has none.
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    eventGroup: text("event_group", { enum: NOTIFICATION_EVENT_GROUPS }).notNull(),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "notification_preferences_pkey",
      columns: [table.userId, table.eventGroup, table.channel],
    }),
    check(
      "notification_preferences_group_check",
      sql`${table.eventGroup} in ('assigned_to_you', 'activity_on_your_records', 'dates_approaching', 'new_requests', 'requester_events')`,
    ),
    check("notification_preferences_channel_check", sql`${table.channel} in ('in_app', 'email')`),
  ],
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
