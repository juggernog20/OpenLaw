// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-014 formatting helper layer (#43): every date, number, and
 * currency the UI shows resolves to one of these named conventions.
 * Thin wrappers over Intl.* — no third-party formatting library.
 *
 * Storage is always UTC ISO 8601 (DES-014); helpers accept the stored
 * string (or a Date) and render in the user's timezone, resolved as
 * stored override → browser-detected → UTC. The locale rides the same
 * seam (DES-013; en-US is the only v1 locale). Components stay
 * declarative — changing a convention is a change in this file only.
 */

import { createIntl, createIntlCache, ReactIntlErrorCode, type IntlShape } from "react-intl";

/** Per-call overrides; tests inject all three for locked-string output. */
export interface FormatOptions {
  locale?: string;
  timeZone?: string;
  /** Reference instant for relative output and year elision. */
  now?: Date;
}

/**
 * Session-level preferences, set once when the signed-in user loads
 * (locale and timezone live on the user record; null means "detect").
 */
let configured: { locale?: string; timeZone?: string } = {};

export function configureFormatting(next: {
  locale?: string | null;
  timeZone?: string | null;
}): void {
  configured = {
    locale: next.locale ?? undefined,
    timeZone: next.timeZone ?? undefined,
  };
}

function resolveLocale(options?: FormatOptions): string {
  return options?.locale ?? configured.locale ?? "en-US";
}

function resolveTimeZone(options?: FormatOptions): string {
  return (
    options?.timeZone ??
    configured.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC"
  );
}

/**
 * A bare `YYYY-MM-DD` is a civil calendar date, not an instant. Pin it
 * to UTC midnight and format it in UTC so the calendar date survives
 * every display timezone — `new Date("2026-05-10")` alone renders as
 * May 9 in negative-offset zones. Timestamps stay instants.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseValue(value: Date | string): { date: Date; dateOnly: boolean } {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return { date: new Date(`${value}T00:00:00Z`), dateOnly: true };
  }
  return { date: typeof value === "string" ? new Date(value) : value, dateOnly: false };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Intl constructors are costly; instances are immutable, so cache them. */
const formatterCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key) as Intl.DateTimeFormat | undefined;
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key) as Intl.NumberFormat | undefined;
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeCache.get(locale);
  if (!formatter) {
    // numeric "auto" is what turns day offsets into "yesterday" /
    // "today" / "tomorrow" per the DES-014 activity-feed examples.
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeCache.set(locale, formatter);
  }
  return formatter;
}

/** ICU-catalog access outside components, for helper-owned copy. */
const intlCache = createIntlCache();
const intls = new Map<string, IntlShape>();

function intlFor(locale: string): IntlShape {
  let intl = intls.get(locale);
  if (!intl) {
    intl = createIntl(
      {
        locale,
        defaultLocale: "en-US",
        // No catalog exists yet for any locale: the inline defaultMessage
        // IS the en-US copy (DES-013), so falling back to it elsewhere is
        // the design, not an error worth logging.
        onError: (error) => {
          if (error.code !== ReactIntlErrorCode.MISSING_TRANSLATION) console.error(error);
        },
      },
      intlCache,
    );
    intls.set(locale, intl);
  }
  return intl;
}

/** The calendar date (not instant) a timestamp falls on in a timezone. */
function civilDate(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = dateFormatter("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Today, as the reader's own calendar says it: a bare `YYYY-MM-DD`.
 *
 * A surface that has to place today *among* stored civil dates — a
 * timeline's today line, say — needs the same kind of value they are,
 * not an instant. The day is the reader's, resolved through the same
 * stored-override → browser-detected → UTC seam every other helper
 * reads (DES-014), so a card and the reader's calendar cannot disagree
 * about which day it is.
 */
export function civilToday(options?: FormatOptions): string {
  const { year, month, day } = civilDate(options?.now ?? new Date(), resolveTimeZone(options));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The two instants a civil date covers, in the reader's own timezone.
 *
 * A date picker answers `2026-08-01`, which is a calendar date and not
 * a moment. An API filtering on a timestamp needs moments, and they have
 * to be the reader's: an Administrator in Dubai scoping an answer to
 * August means their August, not UTC's (DES-014). Returns `null` for
 * anything that is not a bare civil date, so an empty or half-typed
 * field simply drops the bound.
 *
 * A day that starts on a DST shift can be an hour off at its edge. The
 * offset is read at noon, which no shift moves across a date boundary,
 * so the date itself is always the right one.
 */
export function dayBounds(
  civil: string,
  options?: FormatOptions,
): { start: string; end: string } | null {
  if (!DATE_ONLY.test(civil)) return null;
  // The pattern admits `2026-13-45`, which is a shape and not a date.
  // An impossible one would reach Intl as an Invalid Date and throw,
  // and a rolled-over one (`2026-02-31`) would silently answer March.
  // Both are the same answer here: this is not a date, so there is no
  // bound to take from it.
  const noon = new Date(`${civil}T12:00:00Z`);
  if (Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== civil) return null;
  const timeZone = resolveTimeZone(options);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(noon);
  const zoneName = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  // `longOffset` answers "GMT" flat for UTC and "GMT+04:00" elsewhere.
  const offset = /GMT([+-]\d{2}:\d{2})/.exec(zoneName)?.[1] ?? "+00:00";
  return {
    start: new Date(`${civil}T00:00:00.000${offset}`).toISOString(),
    end: new Date(`${civil}T23:59:59.999${offset}`).toISOString(),
  };
}

/**
 * Activity-feed rule: relative within 7 days ("12 minutes ago",
 * "3 hours ago", "yesterday"), short absolute beyond ("Apr 28", year
 * only when not current). Sub-minute renders as "this minute".
 */
export function formatRelativeOrShort(value: Date | string, options?: FormatOptions): string {
  const { date } = parseValue(value);
  const now = options?.now ?? new Date();
  const diff = date.getTime() - now.getTime();
  const distance = Math.abs(diff);
  if (distance <= 7 * DAY) {
    const relative = relativeFormatter(resolveLocale(options));
    if (distance < HOUR) return relative.format(Math.trunc(diff / MINUTE), "minute");
    if (distance < DAY) return relative.format(Math.trunc(diff / HOUR), "hour");
    return relative.format(Math.trunc(diff / DAY), "day");
  }
  return formatShortDate(value, options);
}

/**
 * Upload-column rule: "May 3", growing a year only when the date's
 * year (in the display timezone) is not the current one — "May 3, 2025".
 */
export function formatShortDate(value: Date | string, options?: FormatOptions): string {
  const { date, dateOnly } = parseValue(value);
  const displayZone = resolveTimeZone(options);
  // Date-only values format in UTC to keep their calendar date; the
  // "current year" still comes from the viewer's timezone.
  const timeZone = dateOnly ? "UTC" : displayZone;
  const currentYear = civilDate(options?.now ?? new Date(), displayZone).year;
  const withYear = civilDate(date, timeZone).year !== currentYear;
  return dateFormatter(resolveLocale(options), {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone,
  }).format(date);
}

/**
 * Date-input rule: "May 3, 2026" — always the year. A picker showing
 * the value it will write cannot elide the year the way a list column
 * can; "Jan 1" in a form is a guess.
 */
export function formatFullDate(value: Date | string, options?: FormatOptions): string {
  const { date, dateOnly } = parseValue(value);
  return dateFormatter(resolveLocale(options), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : resolveTimeZone(options),
  }).format(date);
}

/**
 * The one canonical human-readable absolute time (audit log, file
 * metadata, and every timestamp tooltip): "May 3, 2026, 2:34 PM PDT" —
 * always the year, hours and minutes but no seconds, and the timezone
 * label cross-region readers need.
 */
export function formatLongDateTime(value: Date | string, options?: FormatOptions): string {
  return dateFormatter(resolveLocale(options), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: resolveTimeZone(options),
  }).format(parseValue(value).date);
}

/**
 * Due-date rule: short absolute plus a relative qualifier while it is
 * relevant — "May 10 (in 7 days)", "May 1 (3 days overdue)",
 * "May 3 (today)". The qualifier drops beyond 30 calendar days out,
 * where the absolute date alone reads better. Day math is calendar
 * days in the display timezone, not 24-hour blocks.
 */
export function formatDeadline(value: Date | string, options?: FormatOptions): string {
  const { date, dateOnly } = parseValue(value);
  const timeZone = resolveTimeZone(options);
  const target = civilDate(date, dateOnly ? "UTC" : timeZone);
  const today = civilDate(options?.now ?? new Date(), timeZone);
  const days = Math.round(
    (Date.UTC(target.year, target.month - 1, target.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
      DAY,
  );
  const absolute = formatShortDate(value, options);
  if (Math.abs(days) > 30) return absolute;
  const locale = resolveLocale(options);
  const qualifier =
    days >= 0
      ? relativeFormatter(locale).format(days, "day")
      : intlFor(locale).formatMessage(
          {
            id: "format.deadline.overdue",
            defaultMessage: "{days, plural, one {# day} other {# days}} overdue",
          },
          { days: -days },
        );
  // The date-with-qualifier composition is an ICU message too — the
  // parenthesis pattern is locale copy, not code.
  return intlFor(locale).formatMessage(
    {
      id: "format.deadline.withQualifier",
      defaultMessage: "{date} ({qualifier})",
    },
    { date: absolute, qualifier },
  );
}

/**
 * Deadline-surface rule: how far off a date is, in the largest unit that
 * still reads — "in 3 days", "in 8 weeks", "in 5 months", "next year".
 *
 * It takes a **day count** rather than a date, because the count is the
 * seam's (CTR-009's deadline union answers `daysAway` beside every
 * entry, DES-040 clause 4's reason). A surface that recomputed it from
 * the date would be a second copy of the rule that orders the list, and
 * the first thing to disagree would be the row the list calls next.
 *
 * The unit steps up as the distance grows, so a date most of a year out
 * does not read as "in 291 days": days inside a week, weeks inside two
 * months, months inside a year, years beyond. `numeric: "auto"` is what
 * turns the small offsets into "today", "tomorrow", and "yesterday".
 * Negative counts read backwards — "8 weeks ago" — and a surface that
 * would rather flatten the past into one word says so in its own copy.
 */
export function formatDayDistance(days: number, options?: FormatOptions): string {
  const relative = relativeFormatter(resolveLocale(options));
  const distance = Math.abs(days);
  if (distance < 7) return relative.format(days, "day");
  if (distance < 60) return relative.format(Math.round(days / 7), "week");
  // The average lengths, not 30 and 365: rounding "in 12 months" down to
  // eleven on a leap year is the kind of error nobody can explain.
  //
  // The step to years is decided on the **rounded** month count rather
  // than on the day count, so no distance can round its way to "in 24
  // months" — a number a reader has to divide before it means anything.
  // Twelve rather than eighteen, so the year unit can carry the value
  // one: at eighteen, "next year" was unreachable and a date eighteen
  // months out rounded straight to "in 2 years".
  const months = Math.round(days / 30.436875);
  if (Math.abs(months) < 12) return relative.format(months, "month");
  return relative.format(Math.round(days / 365.25), "year");
}

/** Count rule: full digits with locale grouping — never "1.2K". */
export function formatCount(value: number, options?: FormatOptions): string {
  return numberFormatter(resolveLocale(options), {}).format(value);
}

/** Percentage rule: "42.5%" — one fraction digit unless overridden. */
export function formatPercent(
  value: number,
  options?: FormatOptions & { maximumFractionDigits?: number },
): string {
  return numberFormatter(resolveLocale(options), {
    style: "percent",
    maximumFractionDigits: options?.maximumFractionDigits ?? 1,
  }).format(value);
}

/**
 * File-size rule: Intl unit style ("1.5 MB"), SI decimal steps —
 * 1 kB = 1000 bytes, matching what the unit labels actually mean.
 */
export function formatFileSize(bytes: number, options?: FormatOptions): string {
  const bytesStep = { unit: "byte", threshold: 1 };
  const steps = [
    { unit: "terabyte", threshold: 1e12 },
    { unit: "gigabyte", threshold: 1e9 },
    { unit: "megabyte", threshold: 1e6 },
    { unit: "kilobyte", threshold: 1e3 },
  ];
  const magnitude = Math.abs(bytes);
  const step = steps.find((s) => magnitude >= s.threshold) ?? bytesStep;
  return numberFormatter(resolveLocale(options), {
    style: "unit",
    unit: step.unit,
    maximumFractionDigits: 1,
  }).format(bytes / step.threshold);
}

/**
 * A money value as stored (DES-014): integer amount in the currency's
 * smallest unit plus its ISO 4217 code — never a bare number, never
 * floats.
 */
export interface Money {
  amount: number;
  currency: string;
}

/**
 * Currency rule: locale-correct symbol, separators, and precision from
 * the ISO code ("$10,000.00" for USD cents, "¥5,000" for yen — whose
 * smallest unit is the yen). Multi-currency surfaces pass
 * `showCode: true` to append the code: "$10,000.00 USD".
 */
export function formatCurrency(
  value: Money,
  options?: FormatOptions & { showCode?: boolean },
): string {
  const formatter = numberFormatter(resolveLocale(options), {
    style: "currency",
    currency: value.currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const formatted = formatter.format(value.amount / 10 ** digits);
  return options?.showCode ? `${formatted} ${value.currency}` : formatted;
}

/**
 * How many digits separate a currency's major unit from the smallest
 * unit it is stored in: 2 for USD (cents), 0 for JPY (the yen is the
 * smallest unit), 3 for BHD. Read from the ISO code through Intl, so no
 * table of exceptions is kept anywhere.
 */
export function currencyFractionDigits(currency: string, options?: FormatOptions): number {
  return (
    numberFormatter(resolveLocale(options), { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * The two directions between what a person types and what is stored
 * (DES-014: storage is an integer count of the smallest unit, never a
 * float). A form takes major units — 480000 dollars — and the column
 * holds 48000000 cents.
 */
export function toMinorUnits(major: number, currency: string, options?: FormatOptions): number {
  return Math.round(major * 10 ** currencyFractionDigits(currency, options));
}

export function toMajorUnits(minor: number, currency: string, options?: FormatOptions): number {
  return minor / 10 ** currencyFractionDigits(currency, options);
}

/** One entry in a currency picker: the ISO 4217 code that is committed
 * and the name of the currency in the reader's own language. */
export interface CurrencyOption {
  code: string;
  displayName: string;
}

const currencyOptionCache = new Map<string, CurrencyOption[]>();

/**
 * Every currency this runtime knows, named in the reader's locale and
 * ordered by that name. The list comes from the runtime's own ICU
 * tables rather than a table checked into the repository: a hand-kept
 * list goes stale, and shortening it would decide for a self-hoster
 * which currencies they may trade in.
 */
export function currencyOptions(options?: FormatOptions): CurrencyOption[] {
  const locale = resolveLocale(options);
  let list = currencyOptionCache.get(locale);
  if (!list) {
    const names = new Intl.DisplayNames(locale, { type: "currency" });
    list = Intl.supportedValuesOf("currency")
      .map((code) => ({ code, displayName: names.of(code) ?? code }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, locale));
    currencyOptionCache.set(locale, list);
  }
  return list;
}
