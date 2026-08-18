// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-004's reminder-offset list, as the one place that reads it.
 *
 * **One list, for every tracked date.** Key dates (CTR-009), notice
 * deadlines and expiries (CTR-006) all fire on the same offsets: NOT-004
 * declined per-date schedules, and the key-dates table says so in its own
 * header. So there is one column, one read, and one answer.
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
 * The offsets a round should fire on, from a stored list of whatever
 * shape.
 *
 * Whole days, never negative — an offset counts *forward* to a date, and
 * a date that has gone by is the deadline surface's business rather than
 * a reminder's. Deduplicated, because two copies of `7` would otherwise
 * be one date fired at twice and the dedup identity would collapse them
 * anyway. Ordered furthest-first, which is the order the pane draws and
 * the order a person reads a lead-time list in.
 */
export function usableOffsets(stored: unknown): number[] {
  if (!Array.isArray(stored)) return [...SEEDED_REMINDER_OFFSETS];
  const usable = [
    ...new Set(
      stored.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= MAX_REMINDER_OFFSET_DAYS,
      ),
    ),
  ].sort((left, right) => right - left);
  // An empty list is a real answer only if somebody chose it; an empty
  // *usable* list means nothing in the column could be read, and falling
  // back is what keeps a corrupt row from silencing every reminder.
  return usable.length > 0 ? usable : [...SEEDED_REMINDER_OFFSETS];
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
