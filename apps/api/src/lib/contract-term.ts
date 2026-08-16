// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-006's derived dates, in the one place that derives them.
 *
 * The term is five stored columns and two dates that are stored nowhere:
 * the **notice deadline** (the expiry minus the notice period) and
 * **days remaining** (the expiry minus today). Both are computed where
 * an answer is assembled, never written, and never seeded — so nothing
 * about them can go stale, and no job has to keep them true.
 *
 * They live here rather than inside the contracts module because two
 * surfaces now read them. The record's own row carries both (M16/1), and
 * the CTR-009 deadline union puts the notice deadline in a list beside
 * the expiry and the record's key dates (M16/3). A second copy of the
 * subtraction is a second copy that drifts the first time either half of
 * the rule moves, and this is exactly the date a missed renewal is
 * investigated with.
 *
 * **Every date here is a civil date — `YYYY-MM-DD`, a day and not a
 * moment.** The term columns are `date`, a deadline is day-granular
 * (SCHEMA.md, DES-014), and the arithmetic is therefore whole days in
 * one zone. The seam has no viewer to take a timezone from, so that zone
 * is UTC; what a reader's own calendar says is the client's to draw
 * (DES-041 clause 10).
 */

const DAY_MS = 86_400_000;

/** A civil date as the instant of its own UTC midnight, so every
 * subtraction below is done in one zone and stays whole days. */
export function civilInstant(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** That instant back as the `YYYY-MM-DD` the wire and the column both
 * carry. */
export function civilDate(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/** Today, as the seam counts it: the current UTC day, as a civil date.
 * It is what decides whether a date on a deadline surface is still
 * ahead, so one function answers it for every surface that asks. */
export function civilToday(now: Date = new Date()): string {
  return civilDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * CTR-006's notice deadline: the expiry minus the notice period.
 *
 * **Derived at read, stored nowhere.** It is null while either half is
 * missing: with no expiry there is nothing to subtract from, and with no
 * notice period there is nothing to subtract. An evergreen contract
 * holds no expiry, so it never has one — the blank falls out of the
 * model rather than being a case anybody writes.
 */
export function noticeDeadline(
  expiryDate: string | null,
  noticePeriodDays: number | null,
): string | null {
  if (expiryDate === null || noticePeriodDays === null) return null;
  return civilDate(civilInstant(expiryDate) - noticePeriodDays * DAY_MS);
}

/**
 * How many days are left of the term: the expiry minus today.
 *
 * **Derived at read, stored nowhere** — and so it needs no job, no
 * sweep, and no clock seam: it is a function of one column and the
 * calendar, and a test controls it by writing a date on either side of
 * now. Negative once the expiry has passed, because a record whose term
 * ran out has to be able to say so.
 */
export function daysRemaining(expiryDate: string | null, now: Date = new Date()): number | null {
  if (expiryDate === null) return null;
  return daysBetween(civilToday(now), expiryDate);
}

/** Whole days from one civil date to another, forward positive. The
 * count a deadline surface orders and splits on. */
export function daysBetween(from: string, to: string): number {
  return Math.round((civilInstant(to) - civilInstant(from)) / DAY_MS);
}
