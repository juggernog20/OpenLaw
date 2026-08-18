// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The morning round (M18/6, NOT-002 group 3, NOT-003, NOT-004,
 * TECH-007): the one thing in this system that starts a conversation
 * nobody asked it to.
 *
 * Every other event fires because somebody did something. A date
 * arriving is nobody's act, so there has to be a clock — and this is it.
 * Each round serves the people whose own morning has arrived, tells them
 * about the dates coming up on their records, and sends each of them one
 * briefing for that day.
 *
 * Six rules shape it, and five of them are older rules said again.
 *
 * **A round belongs to the install, not to a process.** It repeats, so
 * it is a cron on pg-boss's clock rather than a timer in the worker —
 * the boot-versus-schedule rule the reconciliation sweep settled (#277).
 * pg-boss elects one cron worker per queue, so two replicas produce one
 * round; the queue is a `singleton`, so a tick landing while a round is
 * still going waits for it rather than joining it. Both matter more here
 * than they did there: two rounds at once would be two briefings.
 *
 * **It ticks hourly and serves a person once a day.** The hour is what
 * lets "08:00 where the reader is" mean anything at all — a daily tick
 * could only ever be 08:00 in one zone. The gate is that the local hour
 * has **reached** 08:00 rather than that it *is* 08:00, so an install
 * whose worker was down at somebody's eight o'clock serves them at nine
 * instead of skipping their day (`local-day.ts`).
 *
 * **Derived dates are computed in the round's query and stored nowhere**
 * — M16's doctrine, and the reason there is no materialised column and
 * no job keeping one true. The notice deadline is `expiry_date −
 * notice_period_days`, subtracted in SQL, compared against the dates the
 * offsets name, and never written down.
 *
 * **The offset list is read live, every round** (NOT-004, the
 * read-on-every-decision pattern). An Administrator who shortens it at
 * 09:00 has shortened it for the 10:00 round.
 *
 * **The row is the record of the work owed; the round only wakes it.**
 * A reminder's bell row carries `email_owed` and its dedup identity, so
 * a second round writes nothing and a **moved** date is a different
 * identity and fires again. A briefing that was never sent leaves its
 * rows owed, and the next round sends them. The same doctrine reaches
 * the *other* half of the mail this system sends: the round re-asks for
 * every immediate email that is still owed past a small age bound, so a
 * wake-up lost between a commit and the queue costs a delay and never
 * the message (M12/6, said for mail).
 *
 * **The wall is re-applied at send time**, exactly as the immediate send
 * job re-applies it (M10, DD-014). A briefing carries record titles out
 * of the building, and a record can be walled off between the reminder
 * and the mail — so a row its reader can no longer open is settled as
 * skipped rather than sent.
 */

import {
  and,
  asc,
  contractKeyDates,
  contracts,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notifications,
  sql,
  users,
  type Db,
  type NotificationEventType,
} from "@openlaw/db";
import { civilDate, civilInstant, daysBetween } from "../lib/contract-term.js";
import type { MailerResolver } from "../lib/mailer.js";
import {
  contractRecordAudience,
  CONTRACT_ENTITY,
  reachedBy,
} from "../lib/notifications/audience.js";
import { renderDigestMail, type DigestRow } from "../lib/notifications/email.js";
import { localMoment, morningHasArrived } from "../lib/notifications/local-day.js";
import type { Notifier } from "../lib/notifications/notifier.js";
import { reminderOffsets } from "../lib/notifications/offsets.js";
import { reasonOf } from "./derivations.js";
import { boundedQueueAsk, type JobQueue } from "./jobs.js";
import type { PipelineLogger } from "./logger.js";

const DAY_MS = 86_400_000;

/**
 * How often a round runs.
 *
 * Hourly, on the hour, read in UTC — pg-boss's default and the only
 * timezone this install agrees on. The **round** is hourly; a **person**
 * is served once a day, at their own eight o'clock. Anything slower than
 * an hour could not serve a zone at 08:00 at all; anything faster would
 * ask the same questions more often to reach the same answer, because
 * every round after a person's first one that day writes nothing for
 * them.
 */
export const MORNING_ROUND_CRON = "0 * * * *";

/**
 * How old an immediate email's row has to be before the round decides
 * its wake-up was lost.
 *
 * The immediate queue gives a message three attempts over roughly a
 * minute and a half, and the job's own expiry is two minutes
 * (`NOTIFICATION_EMAIL_QUEUE_OPTIONS`), so a row younger than that may
 * simply be in flight. Fifteen minutes is comfortably past every one of
 * those bounds and still well inside the hour before the next round —
 * asking again for a message that is about to send would cost a second
 * job, which the queue's `short` policy collapses anyway, but it would
 * also make the round's own log unreadable.
 */
export const LOST_EMAIL_REASK_AFTER_MS = 15 * 60_000;

/**
 * How many lost wake-ups one round asks for.
 *
 * Whatever it does not reach is still owed — the rows say so — and the
 * next tick reads them again. The bound is what keeps an install whose
 * relay was down all weekend from turning one round into thousands of
 * queue sends.
 */
export const LOST_EMAIL_PAGE_SIZE = 200;

/**
 * How many refusals in a row end the re-ask for this round.
 *
 * The backfill sweep's bound, for its reason: a queue that refuses
 * several requests back to back is down rather than busy, and asking
 * once per owed row to be told the same thing costs a round trip each.
 */
export const LOST_EMAIL_REFUSAL_LIMIT = 5;

/**
 * How many dates one briefing carries.
 *
 * A day's own reminders never come near it: they are the dates due at
 * three offsets on the records one person is on. The bound is for the
 * install whose relay was down for a month — every briefing threw, so
 * every row stayed owed, and the morning the relay comes back a person
 * would otherwise be sent a thousand-line message. Oldest dates first,
 * and whatever is left over rides the next briefing, so the backlog
 * drains a day at a time instead of arriving at once.
 */
export const DIGEST_ROW_LIMIT = 100;

/** What the round is built from: the rows, the seam that writes bell
 * items, the relay, and somewhere to say what it did. */
export interface MorningRoundDeps {
  db: Db;
  log: PipelineLogger;
  /**
   * The notification seam (NOT-001). The round names the dates and the
   * people whose morning it is; the seam still decides who the record
   * lets them tell, what each person's preferences say, and what a row
   * owes.
   */
  notifier: Notifier;
  /** TECH-011's composition point, resolved per send — so a relay saved
   * in the wizard reaches tomorrow's briefing with no restart. */
  resolveMailer: MailerResolver;
  /** Where this install answers, so every line of the briefing can
   * deep-link to the record it is about (NOT-005). */
  baseUrl: string;
}

/** What a caller may vary about one round. */
export interface MorningRoundOptions {
  /**
   * The instant this round is running at. Defaults to now.
   *
   * It is a parameter because the whole of this file is a function of
   * the clock, and a suite that could not control the clock could only
   * assert the round by waiting for a real morning.
   */
  now?: Date;
  /**
   * Stops the round between people and between records.
   *
   * A container is stopped by a signal, and a round must not hold a
   * shutdown open. Whatever it did not reach is still owed, because the
   * rows are the record, and the next tick reaches it.
   */
  signal?: AbortSignal;
}

/** What one round did, for the operator's log. */
export interface MorningRoundSummary {
  /** People whose own morning had arrived at this tick. */
  served: number;
  /** Bell rows written — reminders that had not fired before. Zero on
   * every round after a person's first one that day, which is the dedup
   * identity working. */
  reminders: number;
  /** Briefings sent. At most one per person per local day. */
  digests: number;
  /** Briefing rows given up on: a record the reader can no longer open,
   * a row with no address on it, or an install with no relay. */
  skipped: number;
  /** Owed-and-unsent immediate emails whose wake-up was asked for
   * again. */
  reasked: number;
  /** Whether the round stopped before it reached the end. */
  stopped: boolean;
}

/** One person the round is serving, and what day it is where they are. */
interface Served {
  id: string;
  email: string;
  displayName: string;
  /** Their profile zone, or null where they never set one (SET-006).
   * Carried past the gate because the once-a-day rule has to read an
   * earlier briefing's instant on **their** calendar, not on UTC's. */
  timezone: string | null;
  /** Their own civil date — what "today" means for their reminders and
   * for the once-a-day rule. */
  today: string;
}

/** One date that has come due for one cohort, before anybody has been
 * told about it. */
interface DueDate {
  contractId: string;
  eventType: NotificationEventType;
  /** The date itself, as a civil date. */
  date: string;
  /** Which NOT-004 offset brought it up. */
  offsetDays: number;
  /** The key date's own row and name, on the one source that has them. */
  keyDateId?: string;
  label?: string;
}

/**
 * Runs one round: reminders, briefings, and the re-ask for lost mail.
 *
 * Answers what it did rather than throwing, the M12/6 rule: a round is
 * best effort, and the scheduler above it must not stop because one
 * person's briefing could not be sent.
 */
export async function runMorningRound(
  deps: MorningRoundDeps,
  jobs: JobQueue,
  options: MorningRoundOptions = {},
): Promise<MorningRoundSummary> {
  const now = options.now ?? new Date();
  const summary: MorningRoundSummary = {
    served: 0,
    reminders: 0,
    digests: 0,
    skipped: 0,
    reasked: 0,
    stopped: false,
  };

  const serving = await whoseMorningItIs(deps, now);
  summary.served = serving.length;

  if (serving.length > 0) {
    // Live, this round (NOT-004). Read once here rather than per person:
    // a list that changed mid-round would have two people in one cohort
    // reminded on different schedules, which is a difference nobody
    // could explain from the outside.
    const offsets = await reminderOffsets(deps.db);

    // Cohorts, because "today" is a fact about a person and not about
    // the round: at any tick the people being served are on at most two
    // civil dates, and each date names its own set of due dates.
    for (const [today, cohort] of cohorts(serving)) {
      if (options.signal?.aborted) {
        summary.stopped = true;
        return summary;
      }
      summary.reminders += await raiseReminders(deps, today, offsets, cohort, options.signal);
    }

    for (const person of serving) {
      if (options.signal?.aborted) {
        summary.stopped = true;
        return summary;
      }
      try {
        const outcome = await sendBriefing(deps, person, now);
        summary.digests += outcome.sent ? 1 : 0;
        summary.skipped += outcome.skipped;
      } catch (error) {
        // Best effort, per person — `raiseReminders`' guard, for a
        // stronger reason. A relay that refused one message would
        // otherwise take the whole round down with it: everybody after
        // this person would go unbriefed, and the re-ask below would
        // never run. Nothing was marked, so this person's rows are still
        // owed and the next round sends them.
        deps.log.error(
          { userId: person.id, reason: reasonOf(error) },
          "the morning round could not send somebody their digest",
        );
      }
    }
  }

  // Last, and unconditionally: it is nobody's morning at most ticks, and
  // a message whose wake-up was lost is owed whatever the hour is.
  summary.reasked = await reaskLostEmails(deps, jobs, now);
  return summary;
}

/**
 * The people whose own clock says the morning has arrived.
 *
 * **Everyone is asked, and the clock is the only filter.** Which of them
 * a given record may actually be mentioned to is the seam's question,
 * asked per record with the wall — this one is only about time.
 *
 * Archived people are out: somebody who has left is reached by nothing
 * (SET-005). Business users are out because group 3 is a full-platform
 * group (NOT-001) — their surface is the portal's own (M20), and
 * scanning them here would be a briefing query per portal account per
 * hour for a person who holds no contracts.
 */
async function whoseMorningItIs(deps: MorningRoundDeps, now: Date): Promise<Served[]> {
  const people = await deps.db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      timezone: users.timezone,
    })
    .from(users)
    .where(and(isNull(users.archivedAt), ne(users.role, "business_user")))
    .orderBy(asc(users.id));
  return people.flatMap((person) => {
    const moment = localMoment(now, person.timezone);
    if (!morningHasArrived(moment)) return [];
    return [{ ...person, today: moment.date }];
  });
}

/** The people being served, grouped by the civil date they are on. */
function cohorts(serving: readonly Served[]): Map<string, Served[]> {
  const byDate = new Map<string, Served[]>();
  for (const person of serving) {
    const held = byDate.get(person.today);
    if (held) held.push(person);
    else byDate.set(person.today, [person]);
  }
  return byDate;
}

/**
 * Tells one cohort about every date that has come due for them, and
 * answers how many bell rows that wrote.
 *
 * One transaction per record rather than one per date or one per round:
 * a record is the unit a failure should be about, and the two or three
 * dates one contract has due on one morning belong together.
 */
async function raiseReminders(
  deps: MorningRoundDeps,
  today: string,
  offsets: readonly number[],
  cohort: readonly Served[],
  signal: AbortSignal | undefined,
): Promise<number> {
  const due = await dueDates(deps.db, today, offsets);
  if (due.length === 0) return 0;
  const inCohort = new Set(cohort.map((person) => person.id));

  let written = 0;
  for (const [contractId, dates] of byContract(due)) {
    if (signal?.aborted) return written;
    // Who the record is about (NOT-002's group-2 audience, which is the
    // same question here): the Owner and everybody holding a team row.
    // The number and the title ride along, so the round never asks for
    // two columns it has already been handed.
    const audience = await contractRecordAudience(deps.db, contractId);
    // A record that went while the round was running is about nobody.
    if (!audience) continue;
    const userIds = audience.userIds.filter((userId) => inCohort.has(userId));
    if (userIds.length === 0) continue;

    try {
      written += await deps.notifier.notifying(async (tx) => {
        let rows = 0;
        for (const date of dates) {
          const event = {
            contractId,
            contractNumber: audience.contractNumber,
            contractTitle: audience.contractTitle,
            reminderDate: date.date,
            offsetDays: date.offsetDays,
            userIds,
          };
          if (date.eventType === "date.key_date_approaching") {
            rows += await deps.notifier.keyDateApproaching(tx, {
              ...event,
              keyDateId: date.keyDateId!,
              label: date.label!,
            });
          } else if (date.eventType === "date.notice_deadline_approaching") {
            rows += await deps.notifier.noticeDeadlineApproaching(tx, event);
          } else {
            rows += await deps.notifier.expiryApproaching(tx, event);
          }
        }
        return rows;
      });
    } catch (error) {
      // Best effort, per record. The dates beside it are still due, and
      // a record whose reminders could not be written this round is
      // still due at the next tick — nothing has been marked.
      deps.log.error(
        { contractId, reason: reasonOf(error) },
        "the morning round could not raise a record's date reminders",
      );
    }
  }
  return written;
}

/** The due dates one contract has, grouped so one transaction covers
 * them. */
function byContract(due: readonly DueDate[]): Map<string, DueDate[]> {
  const byId = new Map<string, DueDate[]>();
  for (const date of due) {
    const held = byId.get(date.contractId);
    if (held) held.push(date);
    else byId.set(date.contractId, [date]);
  }
  return byId;
}

/**
 * Every tracked date that is exactly one of the offsets away from this
 * cohort's today.
 *
 * **Three sources, one union** — CTR-009's, read from the other end. The
 * key dates are rows; the expiry is a column; the notice deadline is a
 * subtraction, **done here in SQL and stored nowhere** (CTR-006, M16).
 *
 * **The comparison is equality, never a window.** An offset names one
 * day, and a date that is six days away is not the seven-day reminder
 * arriving early — it is the seven-day reminder that already went.
 *
 * **An ended contract is skipped** (CTR-019, and the spec in as many
 * words): a dead deal does not clutter anybody's briefing. So is an
 * archived one — archiving freezes a record, and a frozen record is not
 * waiting on anybody, which is the same reading `renewalPending` takes
 * of the same two columns.
 */
async function dueDates(db: Db, today: string, offsets: readonly number[]): Promise<DueDate[]> {
  // The dates the offsets name, and which offset named each. Offsets are
  // deduplicated upstream, so no date is named twice.
  const offsetOf = new Map<string, number>();
  for (const offset of offsets) {
    offsetOf.set(civilDate(civilInstant(today) + offset * DAY_MS), offset);
  }
  const dates = [...offsetOf.keys()];
  const live = and(isNull(contracts.endedAt), isNull(contracts.archivedAt));

  const expiries = await db
    .select({ contractId: contracts.id, date: contracts.expiryDate })
    .from(contracts)
    .where(and(live, inArray(contracts.expiryDate, dates)));

  // The derivation, in the round's own query. `date - integer` is a date
  // in Postgres, so the notice deadline is one expression and never a
  // column.
  const noticeDeadline = sql<string>`${contracts.expiryDate} - ${contracts.noticePeriodDays}`;
  const deadlines = await db
    .select({ contractId: contracts.id, date: noticeDeadline })
    .from(contracts)
    .where(
      and(
        live,
        isNotNull(contracts.expiryDate),
        isNotNull(contracts.noticePeriodDays),
        inArray(noticeDeadline, dates),
      ),
    );

  const keyDates = await db
    .select({
      contractId: contractKeyDates.contractId,
      date: contractKeyDates.date,
      keyDateId: contractKeyDates.id,
      label: contractKeyDates.label,
    })
    .from(contractKeyDates)
    .innerJoin(contracts, eq(contractKeyDates.contractId, contracts.id))
    .where(and(live, inArray(contractKeyDates.date, dates)));

  const due: DueDate[] = [];
  for (const row of expiries) {
    due.push({
      contractId: row.contractId,
      eventType: "date.expiry_approaching",
      date: row.date!,
      offsetDays: offsetOf.get(row.date!)!,
    });
  }
  for (const row of deadlines) {
    due.push({
      contractId: row.contractId,
      eventType: "date.notice_deadline_approaching",
      date: row.date,
      offsetDays: offsetOf.get(row.date)!,
    });
  }
  for (const row of keyDates) {
    due.push({
      contractId: row.contractId,
      eventType: "date.key_date_approaching",
      date: row.date,
      offsetDays: offsetOf.get(row.date)!,
      keyDateId: row.keyDateId,
      label: row.label,
    });
  }
  return due;
}

/** What one person's briefing did. */
interface BriefingOutcome {
  sent: boolean;
  /** Rows settled as skipped: unreachable, unaddressable, or an install
   * with no relay. */
  skipped: number;
}

const NOTHING: BriefingOutcome = { sent: false, skipped: 0 };

/**
 * Sends one person the briefing they are owed, or answers why none went.
 *
 * **What is owed is read from the rows, not from what this round just
 * wrote.** A reminder whose briefing was missed — the process died
 * between the write and the send, or the person had already had their
 * one briefing that day — is still `email_owed` with nothing recorded
 * against it, so it rides this one. That is the M12 doctrine: the row is
 * the record of the work, and a lost send costs a delay rather than the
 * message.
 *
 * **At most one a day** (NOT-003). The proof is the rows again: the
 * newest briefing this person has ever been sent is the newest
 * `emailed_at` on their reminder rows, and if that instant falls on
 * their own today then today's briefing has gone. Read as a **local**
 * date rather than as an elapsed number of hours, so a 25-hour day at a
 * daylight-saving boundary is still one day.
 */
async function sendBriefing(
  deps: MorningRoundDeps,
  person: Served,
  now: Date,
): Promise<BriefingOutcome> {
  const owed = await deps.db
    .select({
      id: notifications.id,
      eventType: notifications.eventType,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      payload: notifications.payload,
      reminderDate: notifications.reminderDate,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, person.id),
        // A group-3 row and nothing else: the reminder identity is what
        // a date reminder has and no other event does.
        isNotNull(notifications.reminderDate),
        eq(notifications.emailOwed, true),
        isNull(notifications.emailedAt),
        isNull(notifications.emailSkippedAt),
      ),
    )
    .orderBy(asc(notifications.reminderDate), asc(notifications.id))
    .limit(DIGEST_ROW_LIMIT);
  if (owed.length === 0) return NOTHING;

  const [lastSent] = await deps.db
    .select({ at: notifications.emailedAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, person.id),
        isNotNull(notifications.reminderDate),
        isNotNull(notifications.emailedAt),
      ),
    )
    .orderBy(desc(notifications.emailedAt))
    .limit(1);
  if (lastSent?.at && localMoment(lastSent.at, person.timezone).date === person.today) {
    // Their briefing has gone today. These rows are not lost — they stay
    // owed, and the next day's briefing carries them.
    return NOTHING;
  }

  // The wall, live and per record (M10, DD-014). A row about a record
  // this reader can no longer open is settled rather than sent: a
  // briefing carries titles out of the building.
  const reachable = new Set<string>();
  const unreadable = new Set<string>();
  for (const entityId of new Set(owed.map((row) => row.entityId))) {
    const rows = owed.filter((row) => row.entityId === entityId);
    // Failing closed on an entity with no reach rule, as the immediate
    // send job does: M18 writes `contract` alone, and a row about
    // something with no rule yet must not be the one thing that leaves
    // unchecked.
    if (rows[0]!.entityType !== CONTRACT_ENTITY) {
      unreadable.add(entityId);
      continue;
    }
    const reaches = await reachedBy(deps.db, entityId, [person.id]);
    if (reaches.has(person.id)) reachable.add(entityId);
    else unreadable.add(entityId);
  }

  const rows: DigestRow[] = [];
  const sending: string[] = [];
  const skipping: string[] = [];
  for (const row of owed) {
    if (!reachable.has(row.entityId)) {
      skipping.push(row.id);
      continue;
    }
    const line = digestRow(row, person.today);
    // A row with no number or no title has no address, and a line
    // pointing at `/contracts/NaN` is worse than a line left out.
    if (!line) {
      skipping.push(row.id);
      continue;
    }
    rows.push(line);
    sending.push(row.id);
  }

  if (rows.length === 0) {
    await settle(deps, skipping, "skipped", now);
    if (unreadable.size > 0) {
      deps.log.warn(
        { userId: person.id, records: unreadable.size },
        "a morning briefing was skipped: its reader no longer reaches the records it was about",
      );
    }
    return { sent: false, skipped: skipping.length };
  }

  const { mailer, from } = await deps.resolveMailer();
  if (!mailer.configured || !from) {
    // TECH-011's posture, and the immediate job's sentence: no retry
    // configures SMTP, so the rows settle and the operator's log says
    // `unconfigured` in as many words. The bell items are untouched.
    await settle(deps, [...sending, ...skipping], "skipped", now);
    deps.log.error(
      { userId: person.id, reason: "unconfigured", rows: sending.length },
      "email is unconfigured, so a morning digest was skipped — " +
        "the bell items are unaffected; set SMTP_URL and SMTP_FROM, or " +
        "configure email in Settings",
    );
    return { sent: false, skipped: sending.length + skipping.length };
  }

  const message = renderDigestMail(
    { recipientName: person.displayName, rows },
    person.email,
    deps.baseUrl,
  );
  // Unreachable: the list is non-empty, which is the only thing the
  // renderer refuses on. Loud rather than silent if that ever changes.
  if (!message) return NOTHING;
  await mailer.send(message);
  // Only after the relay took it. A send that threw leaves every row
  // owed, and the next round sends them — the whole point of the column.
  await settle(deps, sending, "sent", now);
  await settle(deps, skipping, "skipped", now);
  return { sent: true, skipped: skipping.length };
}

/** One owed row as a line of the briefing, or null where the payload
 * carries no address. The payload is a snapshot taken by whichever build
 * wrote the row, so every field is read defensively. */
function digestRow(
  row: {
    eventType: string;
    payload: Record<string, unknown>;
    reminderDate: string | null;
  },
  today: string,
): DigestRow | null {
  const contractNumber = Number(row.payload.contractNumber);
  const contractTitle =
    typeof row.payload.contractTitle === "string" ? row.payload.contractTitle : "";
  if (!Number.isSafeInteger(contractNumber) || contractNumber <= 0) return null;
  if (contractTitle === "" || row.reminderDate === null) return null;
  const label =
    typeof row.payload.label === "string" && row.payload.label ? row.payload.label : null;
  return {
    eventType: row.eventType as NotificationEventType,
    contractNumber,
    contractTitle,
    date: row.reminderDate,
    // Counted against the reader's own today rather than taken from the
    // row's offset: a reminder that missed its briefing rides the next
    // one, and "in 1 day" about yesterday would be a lie.
    daysAway: daysBetween(today, row.reminderDate),
    label,
  };
}

/**
 * Marks a batch of briefing rows settled, whichever way they went.
 *
 * Guarded on "still owed and still unanswered", so a row something else
 * settled in the meantime is left as it stands.
 *
 * **The stamp is the round's own tick, not the wall clock.** It is what
 * the once-a-day rule reads back, so the two have to be the same
 * instant: a briefing sent by a round that began at 08:00 belongs to
 * that round's day and not to whatever minute the relay answered in.
 */
async function settle(
  deps: MorningRoundDeps,
  ids: readonly string[],
  outcome: "sent" | "skipped",
  now: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await deps.db
    .update(notifications)
    .set(outcome === "sent" ? { emailedAt: now } : { emailSkippedAt: now })
    .where(
      and(
        inArray(notifications.id, [...ids]),
        eq(notifications.emailOwed, true),
        isNull(notifications.emailedAt),
        isNull(notifications.emailSkippedAt),
      ),
    );
}

/**
 * Asks again for every immediate email that is still owed and still
 * unsent past {@link LOST_EMAIL_REASK_AFTER_MS}.
 *
 * **This is M12/6's backfill sweep, said for mail.** The Notifier writes
 * the row inside the mutation's transaction and asks the queue after it
 * commits, and that ask is allowed to fail quietly — a mutation must not
 * fail because the pipeline is down. What makes that safe is this: the
 * row says an email is owed, so a wake-up lost between the commit and
 * the send costs a delay and never the message.
 *
 * **Digest rows are not here.** They are this round's own business and
 * are settled by the briefing above; a reminder id handed to the
 * immediate send job would find no copy for its event and settle itself
 * as skipped, which would silence the briefing the row is waiting for.
 *
 * **Asking twice is free.** The queue's `short` policy collapses a
 * second request for a row whose job is still waiting, and the send job
 * stops early on a row that has already been answered for.
 */
async function reaskLostEmails(deps: MorningRoundDeps, jobs: JobQueue, now: Date): Promise<number> {
  const lost = await deps.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.emailOwed, true),
        isNull(notifications.emailedAt),
        isNull(notifications.emailSkippedAt),
        isNull(notifications.reminderDate),
        lt(notifications.createdAt, new Date(now.getTime() - LOST_EMAIL_REASK_AFTER_MS)),
      ),
    )
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .limit(LOST_EMAIL_PAGE_SIZE);

  let asked = 0;
  let refused = 0;
  let reported = false;
  for (const row of lost) {
    try {
      await boundedQueueAsk(jobs.requestNotificationEmail(row.id));
      asked += 1;
      refused = 0;
    } catch (error) {
      refused += 1;
      if (!reported) {
        reported = true;
        deps.log.warn(
          { notificationId: row.id, reason: reasonOf(error) },
          "the morning round could not ask the pipeline to send an owed notification email",
        );
      }
      // A queue refusing several asks in a row is down, not busy. Every
      // row is still owed, so the next round asks again.
      if (refused >= LOST_EMAIL_REFUSAL_LIMIT) return asked;
    }
  }
  return asked;
}
