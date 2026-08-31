// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `notification_preferences`, as the one place that reads and writes it
 * (NOT-001, NOT-002).
 *
 * **The table holds overrides, not a grid.** Somebody with no row for a
 * pair takes the group's default, and the defaults live in
 * {@link EVENT_GROUP_POLICY} rather than being seeded — so a default
 * that changes reaches everybody who never expressed an opinion, and
 * nobody who did. That is why nothing here backfills a row, why a save
 * writes exactly the one pair the person touched, and why a save back to
 * the group's own default **removes** the row rather than writing one
 * that agrees with it (M20/9).
 *
 * **It is here rather than in the Notifier because two callers read it.**
 * The fan-out asks "what does this group do for these people"; the
 * Personal → Notifications pane asks "what does every group do for me".
 * Both answers have to start from the same defaults and apply the same
 * rows, or the pane would draw a state the bell does not honour.
 */

import {
  and,
  eq,
  inArray,
  notificationPreferences,
  NOTIFICATION_EVENT_GROUPS,
  type Executor,
  type BriefingPreferenceGroup,
  type NotificationChannel,
  type NotificationEventGroup,
} from "@openlaw/db";
import { defaultChoice, type ChannelChoice } from "./catalog.js";

/** NOT-008's defaults for the five email-only section switches. Intake
 * follows its opt-in event group; every other briefing section is on. */
export const BRIEFING_PREFERENCE_DEFAULTS: Readonly<Record<BriefingPreferenceGroup, boolean>> = {
  "briefing.approvals": true,
  "briefing.tasks": true,
  "briefing.dates": true,
  "briefing.obligations": true,
  "briefing.intake": false,
};

/**
 * Lays one stored row over a choice that started as the group's
 * default.
 *
 * The channel is the whole branch, and it is written once here so the
 * fan-out and the pane cannot disagree about which column a row moves.
 */
function apply(choice: ChannelChoice, channel: NotificationChannel, enabled: boolean): void {
  if (channel === "in_app") choice.inApp = enabled;
  else choice.email = enabled;
}

/**
 * What these people get on this event group: their own rows over the
 * group's defaults.
 *
 * A missing row is not a missing answer — it is the default, read from
 * the catalog. Every person asked for is in the map, so the caller
 * never has to tell "no opinion" from "not asked about".
 */
export async function channelChoices(
  db: Executor,
  userIds: readonly string[],
  group: NotificationEventGroup,
): Promise<Map<string, ChannelChoice>> {
  const fallback = defaultChoice(group);
  const choices = new Map<string, ChannelChoice>(
    userIds.map((id) => [id, { ...fallback }] as const),
  );
  if (userIds.length === 0) return choices;
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        inArray(notificationPreferences.userId, [...userIds]),
        eq(notificationPreferences.eventGroup, group),
      ),
    );
  for (const row of rows) {
    const choice = choices.get(row.userId);
    if (choice) apply(choice, row.channel, row.enabled);
  }
  return choices;
}

/** One group's answer for one person, as the pane draws it. */
export interface GroupChoice extends ChannelChoice {
  eventGroup: NotificationEventGroup;
}

/**
 * What one person gets on **every** group — the pane's whole read.
 *
 * All six groups, in model order. Knowledge is the briefing section's
 * email preference, while the portal (M20) reads `requester_events`
 * from this same answer. Which groups and channels a **surface** draws
 * is the surface's business, not this function's.
 */
export async function myChannelChoices(db: Executor, userId: string): Promise<GroupChoice[]> {
  const choices = new Map<NotificationEventGroup, ChannelChoice>(
    NOTIFICATION_EVENT_GROUPS.map((group) => [group, { ...defaultChoice(group) }] as const),
  );
  const rows = await db
    .select({
      eventGroup: notificationPreferences.eventGroup,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  for (const row of rows) {
    // Briefing-section preferences share the override table but are not
    // part of this event-group grid. Find against the event vocabulary
    // to narrow the key before applying it.
    const eventGroup = NOTIFICATION_EVENT_GROUPS.find((group) => group === row.eventGroup);
    if (!eventGroup) continue;
    const choice = choices.get(eventGroup);
    if (choice) apply(choice, row.channel, row.enabled);
  }
  return NOTIFICATION_EVENT_GROUPS.map((group) => ({ eventGroup: group, ...choices.get(group)! }));
}

/**
 * Records one person's answer for one group on one channel.
 *
 * **A row is an override, so only a disagreement is stored** (M20/9).
 * Saving a value that differs from the group's default writes the
 * override; saving the value that already **is** the default removes it,
 * back to having no row at all. That is what makes the table honest
 * about its own name: a row that agrees with the default is not an
 * override of anything, and leaving one there would silently pin that
 * person against a default they never asked to be held apart from.
 *
 * The write is an upsert on the natural key rather than an insert,
 * because the row **is** the opinion: saying the same thing twice is
 * still the same opinion, and there is no version of it to conflict
 * with.
 *
 * **The effective answer is the same either way**, which is why this can
 * be settled here rather than at each surface: {@link myChannelChoices}
 * and {@link channelChoices} both start from the default and lay stored
 * rows over it, so "no row" and "a row that matches" read identically
 * today and differ only on the day a default moves.
 */
export async function saveChannelChoice(
  db: Executor,
  userId: string,
  eventGroup: NotificationEventGroup,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  const isDefault = defaultChoice(eventGroup)[channel === "in_app" ? "inApp" : "email"] === enabled;
  const naturalKey = and(
    eq(notificationPreferences.userId, userId),
    eq(notificationPreferences.eventGroup, eventGroup),
    eq(notificationPreferences.channel, channel),
  );
  if (isDefault) {
    // Back to no opinion. A delete that matches nothing is the ordinary
    // case — most people never had a row for this pair — and it is not
    // an error: the person asked for the default and the default is what
    // they now have.
    await db.delete(notificationPreferences).where(naturalKey);
    return;
  }
  await db
    .insert(notificationPreferences)
    .values({ userId, eventGroup, channel, enabled })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.eventGroup,
        notificationPreferences.channel,
      ],
      set: { enabled, updatedAt: new Date() },
    });
}
