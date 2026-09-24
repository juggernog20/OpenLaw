// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-004's reminder-offset lists, as the one place that reads them.
 *
 * The organization's lead times are the default for every tracked date.
 * A person may set their own list, which replaces the default for the
 * reminders they receive (NOT-004 addendum, 2026-09-24). Contract and
 * Matter Key dates may add lead times of their own (NOT-004, #807).
 *
 * **It is read live, on every round** — the read-on-every-decision
 * pattern the mailer resolver and the signing connector already follow.
 * An Administrator who shortens the list at 09:00 has shortened it for
 * the 10:00 round, with no restart and no cache to invalidate. The list
 * is three numbers on a singleton row, so reading it per round costs
 * nothing worth keeping.
 *
 * **What comes back is sanitised, not trusted.** The column is `jsonb`,
 * so its shape is the application's to hold rather than the database's:
 * a hand-edited row, a restored backup, or a build older than the pane
 * could put anything in there. A round that fired on `-3` or on `1.5`
 * would be a round nobody could explain, so the read drops what it
 * cannot use and carries on — the offsets it *can* read are still owed.
 */

import { orgSettings, type Executor } from "@openlaw/db";

/**
 * The list a fresh install starts on (NOT-004): a week ahead, the day
 * before, and the day itself.
 *
 * It is stated here as well as in the column's default because the two
 * answer different questions. The column's default is what a new row
 * gets; this is what a round uses when the row says nothing usable —
 * "the offsets an install has" must never be the empty list by accident,
 * because that is silence rather than configuration.
 */
export const SEEDED_REMINDER_OFFSETS: readonly number[] = [7, 1, 0];

/**
 * The furthest ahead an offset may look.
 *
 * A hundred years of lead time is not a reminder schedule; it is a
 * mistyped number, and honouring it would have the round read every date
 * the install holds on every tick. The bound is generous — a two-year
 * notice window is real — and it is a *filter* rather than a refusal,
 * for the same reason the rest of this read is.
 */
export const MAX_REMINDER_OFFSET_DAYS = 730;

/**
 * How many lead times one list may hold (NOT-004).
 *
 * A reminder schedule is a handful of numbers — a week out, the day
 * before, the day itself. Twenty is far past any real ladder and still
 * small enough that the round reads the whole column without thinking
 * about it. The bound exists so a scripted caller cannot turn one
 * settings row into a thousand reminders a day.
 */
export const MAX_REMINDER_OFFSETS = 20;

/**
 * Whether one stored value is a lead time this system can fire on.
 *
 * Whole days, never negative — an offset counts *forward* to a date, and
 * a date that has gone by is the deadline surface's business rather than
 * a reminder's.
 */
export function isUsableOffset(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_REMINDER_OFFSET_DAYS
  );
}

/**
 * The offsets in a stored list, **in the order they were saved**.
 *
 * This is what the pane draws and what the pane writes back, so the
 * order an Administrator arranged survives a reload (NOT-004 M18/7).
 * Deduplicated, because two copies of `7` would otherwise be one date
 * fired at twice and the dedup identity would collapse them anyway; the
 * first copy keeps the position.
 */
export function savedOffsets(stored: unknown): number[] {
  if (!Array.isArray(stored)) return [...SEEDED_REMINDER_OFFSETS];
  const usable = [...new Set(stored.filter(isUsableOffset))];
  // An empty list is a real answer only if somebody chose it; an empty
  // *usable* list means nothing in the column could be read, and falling
  // back is what keeps a corrupt row from silencing every reminder. The
  // pane cannot save an empty list, so the two cases never collide.
  return usable.length > 0 ? usable : [...SEEDED_REMINDER_OFFSETS];
}

/**
 * The offsets a round should fire on, from a stored list of whatever
 * shape.
 *
 * The saved list, ordered furthest-first — the order a person reads a
 * lead-time ladder in, and the order the round's own log lists. The
 * order is presentation either way: each offset names one day and the
 * comparison is equality, so no arrangement of the list can change which
 * day fires.
 */
export function usableOffsets(stored: unknown): number[] {
  return savedOffsets(stored).sort((left, right) => right - left);
}

/**
 * The install's current offset list, read from the singleton settings
 * row.
 *
 * An install with no settings row at all — which the migration makes
 * unrepresentable, and which a half-applied restore could still produce
 * — takes the seeded list, for {@link usableOffsets}' reason.
 */
export async function reminderOffsets(db: Executor): Promise<number[]> {
  const [row] = await db
    .select({ offsets: orgSettings.reminderOffsetDays })
    .from(orgSettings)
    .limit(1);
  return usableOffsets(row?.offsets);
}

/**
 * The offsets one person's reminders fire on: their own list when they
 * set one, otherwise the organization's.
 *
 * A stored list with no usable value falls back to the organization's
 * list, not to the seeded one. The person chose to differ from the
 * default; a row nobody can read should not also discard what the
 * Administrator set.
 */
export function personalOffsets(own: unknown, organization: readonly number[]): number[] {
  if (!Array.isArray(own)) return [...organization];
  const usable = [...new Set(own.filter(isUsableOffset))];
  return usable.length > 0 ? usable.sort((left, right) => right - left) : [...organization];
}
