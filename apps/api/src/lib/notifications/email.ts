// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What a notification says when it arrives as email (TECH-011, NOT-005).
 *
 * This is the template layer TECH-011 named and nothing had needed yet.
 * The two emails that existed before it — the set-password link and the
 * magic link — compose their text where they are sent, which was fine
 * while there were two of them and is not fine for a catalog: an event
 * added later must be a case here rather than a second place that knows
 * how an OpenLaw email is laid out.
 *
 * **Every message deep-links to its record.** NOT-005's whole promise
 * about a notification is that acting on it is one click, and an email
 * that describes a contract without saying where it is fails that on the
 * one channel where the reader is not already in the app.
 *
 * **The copy is authored here in English, not in the message catalog.**
 * That is the API's own convention (DES-013 puts the catalog in the web
 * app, and every refusal sentence in this API is written at its call
 * site) — the strings the M4 contract governs are the ones a browser
 * renders, and the bell's own strings arrive with the bell. What this
 * layer sends is the same class of copy as the invite email above it.
 *
 * **The body is plain text**, because `MailMessage` is. A rendered
 * alternative is TECH-011's to add, and adding it here would put two
 * copies of the wording in the same file.
 */

import type { NotificationEventType } from "@openlaw/db";
import type { MailMessage } from "../mailer.js";
import { civilInstant } from "../contract-term.js";

/** One notification, as the template layer needs it described. */
export interface NotificationMail {
  eventType: NotificationEventType;
  /** The record the item is about — its number is its address. */
  contractNumber: number;
  contractTitle: string;
  /** Who caused it, by display name. NULL where nobody did: an
   * integration or a scheduled round speaking (CTR-013's no-actor
   * narration, said in mail). */
  actorName: string | null;
  /** Who is being written to. */
  recipientName: string;
  /**
   * The rest of the row's payload, for the arms that name something
   * inside the record — the task that was assigned, say.
   *
   * It is read through {@link detail} and never indexed directly: the
   * payload is a snapshot taken by whichever build wrote the row, so an
   * arm asking for a key an older build never wrote must get nothing
   * rather than `undefined` spliced into a sentence.
   */
  details?: Record<string, unknown>;
}

/** This install's address, with any trailing slashes taken off, so every
 * link below is built by joining rather than by hoping. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** The deep link one notification points at: the record itself. */
function recordLink(baseUrl: string, contractNumber: number): string {
  return `${origin(baseUrl)}/contracts/${contractNumber}`;
}

/** One payload key as a non-empty string, or null. The bell narrator's
 * own defensive read, said on this side of the wire. */
function detail(notification: NotificationMail, key: string): string | null {
  const value = notification.details?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** One payload key as a whole number, or null. The version number's own
 * read: a round is `v3`, never `v[object Object]`. */
function count(notification: NotificationMail, key: string): number | null {
  const value = notification.details?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The subject and body one notification is sent as.
 *
 * `null` for a slug this layer has no words for yet. Group 3 is in that
 * state: its email is one morning briefing rather than one message per
 * reminder (NOT-003), and the digest that renders it arrives with the
 * dates slice. Answering `null` rather than improvising
 * is the `createUnconfiguredMailer` posture — a stub that sent would be
 * a real message nobody wrote — and answering it rather than **throwing**
 * is what lets the send job treat it as terminal: no retry writes copy,
 * so three attempts would only log the same gap three times.
 */
export function renderNotificationMail(
  notification: NotificationMail,
  to: string,
  baseUrl: string,
): MailMessage | null {
  const link = recordLink(baseUrl, notification.contractNumber);
  const who = notification.actorName ?? "Somebody";
  switch (notification.eventType) {
    case "approval.requested":
      return {
        to,
        subject: `Approval requested: ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} has asked you to approve ${notification.contractTitle}.`,
          "",
          link,
          "",
          "You can approve or reject it, with a note, on the record.",
        ].join("\n"),
      };
    case "contract.owner_assigned":
      return {
        to,
        subject: `You are now the owner of ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} has made you the owner of ${notification.contractTitle}.`,
          "",
          link,
          "",
          "The owner is the accountable person on a contract.",
        ].join("\n"),
      };
    case "contract.task_assigned": {
      // The task's own title, where the row carries it. A row written
      // by a build that did not is still a real prompt about a real
      // record, so it says "a task" rather than nothing at all.
      const task = detail(notification, "taskTitle");
      return {
        to,
        subject: task
          ? `Task assigned: ${task} (${notification.contractTitle})`
          : `Task assigned on ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          task
            ? `${who} has given you a task on ${notification.contractTitle}: ${task}.`
            : `${who} has given you a task on ${notification.contractTitle}.`,
          "",
          link,
          "",
          "The checklist is on the record.",
        ].join("\n"),
      };
    }
    case "comment.mentioned":
      return {
        to,
        subject: `You were mentioned on ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} mentioned you in a comment on ${notification.contractTitle}.`,
          "",
          link,
          "",
          // The comment itself is deliberately not here. The tier
          // (DD-016) is enforced on the thread, and a redact (CMT-006)
          // cannot reach an email that has already left.
          "The comment is on the record.",
        ].join("\n"),
      };
    // ---------------------------------------------------------------
    // Group 2 — activity on your records (NOT-002).
    //
    // These arms exist because the preferences pane makes the group's
    // email opt-in real (M18/5). Nobody receives one without having
    // asked for it, which is the whole reason the copy can be as short
    // as it is: an opted-in reader already knows why the message is
    // there, and the record is one click away.
    // ---------------------------------------------------------------
    case "contract.status_changed": {
      // The status the record moved *to*. Named `status` rather than
      // `to`, which is the recipient's address in this scope.
      const status = detail(notification, "to");
      return {
        to,
        subject: `${notification.contractTitle} moved${status ? ` to ${status}` : ""}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          status
            ? `${who} moved ${notification.contractTitle} to ${status}.`
            : `${who} moved ${notification.contractTitle} to another status.`,
          "",
          link,
          "",
          "The record's own feed has the full history.",
        ].join("\n"),
      };
    }
    case "comment.posted":
      return {
        to,
        subject: `New comment on ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} commented on ${notification.contractTitle}.`,
          "",
          link,
          "",
          // The words stay on the thread, for the mention arm's reason:
          // DD-016 is enforced there, and a redact (CMT-006) cannot
          // reach an email that has already left.
          "The comment is on the record.",
        ].join("\n"),
      };
    case "document.added": {
      const document = detail(notification, "documentTitle");
      return {
        to,
        subject: document
          ? `New document: ${document} (${notification.contractTitle})`
          : `New document on ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          document
            ? `${who} added ${document} to ${notification.contractTitle}.`
            : `${who} added a document to ${notification.contractTitle}.`,
          "",
          link,
          "",
          // The file is never attached, and never linked directly: a
          // download URL in mail would be a way past the wall the
          // record enforces on every read (DD-014).
          "The document list is on the record.",
        ].join("\n"),
      };
    }
    case "document.version_added": {
      const document = detail(notification, "documentTitle");
      const version = count(notification, "versionNumber");
      const round = version ? `v${version}` : "a new version";
      return {
        to,
        subject: document
          ? `New version of ${document} (${notification.contractTitle})`
          : `New document version on ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          document
            ? `${who} added ${round} of ${document} on ${notification.contractTitle}.`
            : `${who} added ${round} of a document on ${notification.contractTitle}.`,
          "",
          link,
          "",
          "The version history is on the record.",
        ].join("\n"),
      };
    }
    case "envelope.ended": {
      // No actor sentence. An envelope almost always ends because the
      // provider said so (CTR-013), and "Somebody signed it" would
      // name a person nobody can look up. The record is the subject.
      const status = detail(notification, "status");
      const ending =
        status === "signed"
          ? "has been signed"
          : status === "declined"
            ? "was declined"
            : status === "voided"
              ? "was voided"
              : "has ended";
      return {
        to,
        subject: `Signature ${status === "signed" ? "complete" : "update"}: ${notification.contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `The signature envelope on ${notification.contractTitle} ${ending}.`,
          "",
          link,
          "",
          "The signature panel on the record has the detail.",
        ].join("\n"),
      };
    }
    // Group 3 has no arm here on purpose, and `null` is the right answer
    // for it rather than an oversight: a date reminder's email is one
    // morning briefing for the whole day's dates (NOT-003), rendered by
    // {@link renderDigestMail} below. A row that somehow reached the
    // immediate send job is a row whose email is owed to a round that
    // has not run yet, and answering `null` settles it as skipped rather
    // than sending a reminder the digest is about to send again.
    default:
      return null;
  }
}

// -------------------------------------------------------------------
// The morning digest (NOT-003, NOT-004) — DES-051.
//
// **One message a day, not one per date.** NOT-003's whole argument is
// that date noise is the likeliest unsubscribe trigger, so the renewal
// calendar arrives as a briefing: the reader scans a list, and the nine
// separate mails the naive design would have sent are the thing this
// layer exists to prevent.
//
// **The order is the deadline union's** (CTR-009, M16/3): outward from
// today — what is still ahead nearest first, then what has gone by, most
// recently first. It is the order the record's own Key dates section
// draws, so a reader who follows a link is not re-sorting in their head.
//
// **The register is DES-051's**: a briefing states, it does not urge.
// -------------------------------------------------------------------

/** One line of the briefing, as the round hands it over. */
export interface DigestRow {
  /** Which of the three tracked dates this is (NOT-002 group 3). */
  eventType: NotificationEventType;
  contractNumber: number;
  contractTitle: string;
  /** The date itself, as a civil date. */
  date: string;
  /**
   * Whole days from the **reader's own** today, negative once the date
   * has gone by.
   *
   * Counted at send time rather than taken from the row's offset: a row
   * whose digest was missed rides the next one, and a briefing that said
   * "in 1 day" about yesterday would be worse than no briefing.
   */
  daysAway: number;
  /** What somebody called this date (CTR-009), or null on the two the
   * term derives — they are named by their kind, not by a person. */
  label: string | null;
}

/** What the round hands the template layer for one person. */
export interface DigestMail {
  recipientName: string;
  rows: readonly DigestRow[];
}

/** Which of the three sources leads when two dates fall on one day —
 * the deadline union's own rank (M16/3): the deadline that warns of the
 * expiry, then the expiry, then the record's own dates. */
const DIGEST_RANK: Record<string, number> = {
  "date.notice_deadline_approaching": 0,
  "date.expiry_approaching": 1,
  "date.key_date_approaching": 2,
};

/** What each kind of date is called when it has no name of its own. */
const DIGEST_KIND: Record<string, string> = {
  "date.notice_deadline_approaching": "Notice deadline",
  "date.expiry_approaching": "Expiry",
  "date.key_date_approaching": "Key date",
};

/** One date as a reader reads it: `Mar 12, 2026`. Rendered in UTC
 * because the value is a civil date and not a moment — shifting it into
 * a zone is what would move it a day. */
const DIGEST_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** How far away one date is, in the words a briefing uses. Digits rather
 * than words (DES-015 rule 9), and the two days either side of today are
 * named because that is how people say them. */
function whenIs(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway === -1) return "Yesterday";
  return daysAway > 0 ? `In ${daysAway} days` : `${-daysAway} days ago`;
}

/** One row's own headline: when, what kind of date, and which record. */
function digestLine(row: DigestRow): string {
  const kind = row.label ?? DIGEST_KIND[row.eventType] ?? "Date";
  const on = DIGEST_DATE.format(civilInstant(row.date));
  return `${whenIs(row.daysAway)} (${on}) — ${kind}: ${row.contractTitle} (#${row.contractNumber})`;
}

/**
 * The morning briefing one person is owed, or `null` when they are owed
 * none.
 *
 * `null` for an empty list is what lets the round call this
 * unconditionally: "nothing is due" and "a message went" are then one
 * branch at the caller rather than two, and no empty briefing can ever
 * leave — a daily email that says nothing happened is the noise NOT-003
 * exists to avoid.
 */
export function renderDigestMail(
  digest: DigestMail,
  to: string,
  baseUrl: string,
): MailMessage | null {
  if (digest.rows.length === 0) return null;
  const rows = [...digest.rows].sort((left, right) => {
    const leftPast = left.daysAway < 0;
    const rightPast = right.daysAway < 0;
    if (leftPast !== rightPast) return leftPast ? 1 : -1;
    if (left.date !== right.date) {
      const ascending = left.date < right.date ? -1 : 1;
      return leftPast ? -ascending : ascending;
    }
    const byRank = (DIGEST_RANK[left.eventType] ?? 9) - (DIGEST_RANK[right.eventType] ?? 9);
    if (byRank !== 0) return byRank;
    const byTitle = left.contractTitle.localeCompare(right.contractTitle);
    return byTitle !== 0 ? byTitle : left.contractNumber - right.contractNumber;
  });
  const count = rows.length;
  return {
    to,
    // Digits, sentence case, no full stop — a subject is a fragment
    // (DES-015 rules 6, 7, 9).
    subject: count === 1 ? "1 date on your contracts" : `${count} dates on your contracts`,
    text: [
      `Hello ${digest.recipientName},`,
      "",
      "These dates are coming up on your contracts, nearest first.",
      "",
      // One record per pair of lines: the sentence, then where to act on
      // it. The Key dates section is the address (DES-049 clause 9) —
      // landing a reader on the overview and making them find the date
      // they were just told about is one click short of the promise.
      ...rows.flatMap((row) => [
        digestLine(row),
        `${recordLink(baseUrl, row.contractNumber)}/key-dates`,
        "",
      ]),
      // The way out, on the one channel where the reader is not already
      // in the app. A digest with no way to turn it down is what trains
      // people to filter the sender.
      "Change what reaches you in your notification settings:",
      `${origin(baseUrl)}/settings/notifications`,
    ].join("\n"),
  };
}
