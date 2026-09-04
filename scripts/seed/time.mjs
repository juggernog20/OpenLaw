/* Dates, relative to the day the seed runs.
 *
 * Everything the seed writes is anchored to today rather than to a fixed
 * calendar, so the instance still reads correctly a month later: things
 * are still overdue, still due this week, still expiring next quarter.
 * A seed with hard-coded dates goes stale the day after it runs, and a
 * dashboard full of deadlines from last year reviews badly.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Midnight today, in UTC, as the anchor everything else is offset from. */
export function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** `YYYY-MM-DD`, which is the only date shape the API accepts. */
export function iso(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY);
}

export function addMonths(date, months) {
  const moved = new Date(date.getTime());
  const targetDay = moved.getUTCDate();
  moved.setUTCDate(1);
  moved.setUTCMonth(moved.getUTCMonth() + months);
  // Clamp, so adding a month to the 31st lands on the last day of a
  // shorter month rather than skipping into the next one.
  const lastDay = new Date(
    Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0),
  ).getUTCDate();
  moved.setUTCDate(Math.min(targetDay, lastDay));
  return moved;
}

/** `YYYY-MM-DD`, `days` from today. Negative is in the past. */
export function daysFromToday(days) {
  return iso(addDays(today(), days));
}

/** `YYYY-MM-DD`, `months` from today. */
export function monthsFromToday(months) {
  return iso(addMonths(today(), months));
}
