// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What day it is where somebody is (NOT-003).
 *
 * The morning round is the one thing in this system that has to know a
 * person's own clock. Everything else here is a civil date — a day and
 * not a moment (`contract-term.ts`) — because a deadline is true in
 * every timezone. A **briefing** is not: "your morning" is 08:00 where
 * the reader is, and a digest that landed at 08:00 UTC would reach Dubai
 * at noon and San Francisco at one in the morning.
 *
 * **The zone is the person's profile timezone, and UTC when they have
 * not set one** (SET-006). `users.timezone` is NULL for everybody who
 * never opened the pane — the browser is what resolves it on the display
 * surfaces (DES-014), and a scheduled round has no browser to ask.
 *
 * **`Intl` does the arithmetic, and that is the decision.** A zone is
 * not a fixed offset: it moves twice a year, on dates that differ per
 * zone and change by legislation. Nothing here stores or computes an
 * offset — the formatter is asked what the wall clock reads at an
 * instant, which is the only question with a stable answer. Two
 * properties follow for free:
 *
 * - **Spring forward cannot skip a person.** The gate is "the local hour
 *   has *reached* 08:00", not "is 08:00", so a round that runs while the
 *   local clock jumps still serves them at the next tick.
 * - **Fall back cannot serve them twice.** A 25-hour day is still one
 *   local date, and the once-a-day rule is expressed over that date
 *   rather than over an elapsed number of hours.
 *
 * A zone name the runtime does not recognise is treated as UTC rather
 * than raised on: a junk string in one person's profile must not be able
 * to stop the round that serves everybody else.
 */

/** The hour a briefing is owed, in the reader's own zone (NOT-003: "one
 * daily morning digest"). Fixed rather than configurable — NOT-003
 * declined per-user schedules in v1 in as many words. */
export const DIGEST_LOCAL_HOUR = 8;

/**
 * One reusable formatter per zone.
 *
 * Building an `Intl.DateTimeFormat` is the expensive part of asking it
 * anything, and a round asks the same handful of zones once per person
 * per tick. The map is bounded by the number of distinct zones an
 * install's people have set, which is a number of people rather than a
 * number of rows.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The formatter for one zone, or the UTC one where the runtime does not
 * know the name. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const held = formatters.get(timeZone);
  if (held) return held;
  const build = (zone: string): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    });
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = build(timeZone);
  } catch {
    // An unrecognised zone name. Falling back to UTC serves the person
    // at the wrong hour; raising would leave every person after them
    // unserved, which is strictly worse.
    formatter = build("UTC");
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/** Where and when one person is, as the round reads them. */
export interface LocalMoment {
  /** The civil date on their own calendar — `YYYY-MM-DD`, the same shape
   * every stored date and every derived deadline carries. */
  date: string;
  /** The hour their clock reads, 0–23. */
  hour: number;
}

/**
 * What one person's clock reads at an instant.
 *
 * `timeZone` is their profile zone, or null for the people who have
 * never set one — which is most of them, and which reads as UTC.
 */
export function localMoment(now: Date, timeZone: string | null): LocalMoment {
  const parts = formatterFor(timeZone ?? "UTC").formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  // `hourCycle` is not pinned, so a zone can answer "24" for midnight on
  // some runtimes. It is the same hour as 0 and it must compare as one.
  const hour = Number(part("hour")) % 24;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour };
}

/**
 * Whether this person's morning has arrived at this instant.
 *
 * "Has reached", not "is": an install whose worker was down at their
 * 08:00 serves them at 09:00 instead, because the rows and the
 * once-a-day rule are what stop a second briefing — not the hour.
 */
export function morningHasArrived(moment: LocalMoment): boolean {
  return moment.hour >= DIGEST_LOCAL_HOUR;
}
