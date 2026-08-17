// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-006's derived dates, in the one place that derives them.
 *
 * The term is five stored columns and four answers that are stored
 * nowhere: the **notice deadline** (the expiry minus the notice period),
 * **days remaining** (the expiry minus today), whether the record is
 * **pending confirmation** of a roll (an auto-renewing, unarchived
 * contract whose expiry has passed), and where a confirmed roll would
 * take the expiry (M16/4). All four are computed where an answer is
 * assembled, never written, and never seeded — so nothing about them can
 * go stale, and no job has to keep them true.
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

/**
 * A civil date shifted by whole months, clamped to the target month's
 * last day — `2026-01-31` forward one month is February's 28th, not
 * March's 3rd.
 *
 * A renewal period is counted in months (CTR-006), and a month is not a
 * fixed number of days, so a roll cannot be day arithmetic. The clamp is
 * the only honest answer for a term that ends on a month's last day:
 * rolling it into a shorter month has to land on that month's last day
 * rather than spill into the next one.
 */
export function shiftMonths(date: string, months: number): string {
  // A civil date is fixed-width `YYYY-MM-DD`, so its three parts are
  // slices rather than a split whose length nothing guarantees.
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return civilDate(target.getTime());
}

/** The term columns the two renewal derivations read. Narrower than the
 * row on purpose: these are functions of five columns and the calendar,
 * and nothing else about a contract can change what they answer. */
interface RenewableTerm {
  termType: string;
  expiryDate: string | null;
  renewalPeriodMonths: number | null;
  archivedAt: Date | null;
  /** CTR-019's queryable summary of the ended stage. An ended contract
   * is a dead deal, and a dead deal stops asking to be rolled. */
  endedAt: Date | null;
}

/**
 * CTR-006's "renewal pending confirmation": an auto-renewing contract
 * that has passed its expiry with nobody confirming the roll.
 *
 * **A predicate, not a state.** No column holds it, no job sets it, and
 * nothing schedules its arrival — it is true because the record's own
 * dates say so, and it goes false the moment the expiry advances or the
 * term is re-typed. That is the whole of CTR-006's notify-only promise
 * said in one function: the system never advances a date, so the record
 * says the date has passed and waits for a person.
 *
 * An archived record is out: archiving freezes a record, and a frozen
 * record is not waiting on anybody. An ended record is out: the deal is
 * dead, and a dead deal stops asking to be rolled (CTR-019). A fixed or
 * evergreen term is out because neither rolls — a fixed term that ran
 * out has simply ended.
 */
export function renewalPending(term: RenewableTerm, now: Date = new Date()): boolean {
  if (term.termType !== "auto_renew" || term.archivedAt !== null || term.endedAt !== null)
    return false;
  if (term.expiryDate === null) return false;
  // Civil dates are zero-padded ISO, so a string compare is a date
  // compare — no parsing, and no timezone to get it wrong.
  return term.expiryDate < civilToday(now);
}

/**
 * Where a confirmed roll would take the expiry: the current expiry plus
 * the renewal period (CTR-006).
 *
 * **Derived at read and stored nowhere**, for the reason DES-040 clause
 * 4 keeps days remaining at the seam: it is one date two places could
 * disagree about, and the dialog that proposes it and the write that
 * commits it must not each own a copy of the month arithmetic. Null
 * whenever the record cannot roll — a term that does not auto-renew, an
 * expiry nobody recorded, or a renewal period nobody recorded — which is
 * exactly when the record has nothing to propose.
 *
 * It is a proposal and never a commitment. The person confirming may
 * put a different date in, because a roll whose dates shifted in
 * negotiation is recorded as it really landed (CTR-007).
 */
export function proposedRollExpiry(term: RenewableTerm): string | null {
  if (term.termType !== "auto_renew") return null;
  if (term.expiryDate === null || term.renewalPeriodMonths === null) return null;
  return shiftMonths(term.expiryDate, term.renewalPeriodMonths);
}
