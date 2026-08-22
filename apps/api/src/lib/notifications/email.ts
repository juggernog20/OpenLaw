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
 * **There is one register and two surfaces** (NOT-001). A staff message
 * links to the record in the application; a requester's message links to
 * the Request in the portal. Which of the two a message is, is read from
 * the record it carries and — for a Request, which is read from both
 * sides — from the event's group: group 4 is the Inbox's own arrival and
 * addresses the staff detail (INT-006), group 5 is the Requester's and
 * addresses the portal (DD-013). The arms are split so that one file
 * still holds how an OpenLaw email is laid out.
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

import type { NotificationEventType, RequestStatus, SeverityLevel } from "@openlaw/db";
import type { MailMessage } from "../mailer.js";
import { civilInstant } from "../contract-term.js";
import { requestSideOf } from "./catalog.js";

/**
 * The record a notification is about, and how it names and addresses
 * itself.
 *
 * Two arms, because the two audiences read on two surfaces (NOT-001): a
 * contract's number addresses the staff application, a Request's
 * addresses the portal. Every message names its record and links to it,
 * and this is the one place that knows which is which.
 */
export type MailRecord =
  | { entityType: "contract"; number: number; title: string }
  | { entityType: "request"; number: number; summary: string };

/** One notification, as the template layer needs it described. */
export interface NotificationMail {
  eventType: NotificationEventType;
  /** The record the item is about — its number is its address. */
  record: MailRecord;
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
 * link below is built by joining rather than by hoping.
 *
 * Trimmed by hand rather than by `/\/+$/`, which backtracks polynomially
 * on an address that is mostly slashes. `BASE_URL` is an operator's own
 * setting and not a caller's, so nobody can reach this from outside —
 * but a scan cannot know that, and the loop is plainer than the argument
 * for keeping the regex would have been. */
function origin(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end -= 1;
  return baseUrl.slice(0, end);
}

/** The deep link one notification points at: the record itself. */
function recordLink(baseUrl: string, contractNumber: number): string {
  return `${origin(baseUrl)}/contracts/${contractNumber}`;
}

/**
 * The deep link a group-5 message points at: the Request in the portal.
 *
 * The portal's own address, not the staff application's, because the
 * reader is a Requester (NOT-001). A visit with no session lands on the
 * portal entry screen, where the one thing they need is another link
 * (the INT-001 M20/2 addendum), and a visit with one lands on the
 * Request — so the link in an old email is never a dead end.
 */
function portalRequestLink(baseUrl: string, requestNumber: number): string {
  return `${origin(baseUrl)}/portal/requests/${requestNumber}`;
}

/**
 * The deep link a group-4 message points at: the Request in the Inbox.
 *
 * The staff application's own address (#414), not the portal's, because
 * the reader is a triager. One act writes two messages about one
 * Request, and each of them points at the surface its reader works on.
 */
function inboxRequestLink(baseUrl: string, requestNumber: number): string {
  return `${origin(baseUrl)}/inbox/${requestNumber}`;
}

/** R-###, INT-002's reference — what a requester quotes and what the
 * subject line names the Request by. */
function requestReference(requestNumber: number): string {
  return `R-${requestNumber}`;
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
  const { record } = notification;
  if (record.entityType === "contract") return contractMail(notification, record, to, baseUrl);
  // A Request is read from two sides, so the group is what says which
  // message this is. The record alone cannot: both audiences hold rows
  // about the same Request, and one of them is staff.
  return requestSideOf(notification.eventType) === "inbox"
    ? staffRequestMail(notification, record, to, baseUrl)
    : requestMail(notification, record, to, baseUrl);
}

/**
 * The staff side's messages about a Request: NOT-002's group 4 arrival
 * (INT-006) and, from M21/5, group 1's mention on a Request thread.
 *
 * **Both address the staff detail** (#414), because both readers are
 * triagers. The portal address is the Requester's, and a message that
 * sent staff there would land them on somebody else's window.
 *
 * **Every message names the Request as `R-### · summary`**, the way the
 * requester's own messages do: the reference is what gets quoted, the
 * summary is what gets recognised.
 *
 * **The register is DES-051's**, like every other message here.
 */
function staffRequestMail(
  notification: NotificationMail,
  record: Extract<MailRecord, { entityType: "request" }>,
  to: string,
  baseUrl: string,
): MailMessage | null {
  const named = `${requestReference(record.number)} · ${record.summary}`;
  const link = inboxRequestLink(baseUrl, record.number);
  const hello = `Hello ${notification.recipientName},`;
  const who = notification.actorName ?? "Somebody";
  switch (notification.eventType) {
    case "request.submitted": {
      // **Opt-in, so the copy can be short.** Nobody receives one
      // without having asked for it, and the queue is already the
      // surface — this is for the Member+ who wants the arrival to reach
      // them wherever they are. It names the two facts a triager weighs
      // before opening anything, the request type and the urgency, and
      // then gets out of the way.
      const requestType = detail(notification, "requestType");
      const urgency = urgencyWord(detail(notification, "urgency"));
      return {
        to,
        subject: `New request: ${named}`,
        text: [
          hello,
          "",
          `${who} submitted a new request: ${named}.`,
          // Both lines are conditional for the payload's own reason: the
          // row is a snapshot taken by whichever build wrote it, and a
          // label reading "Type: undefined" is worse than no label.
          ...(requestType || urgency ? [""] : []),
          ...(requestType ? [`Type: ${requestType}`] : []),
          ...(urgency ? [`Urgency: ${urgency}`] : []),
          "",
          link,
          "",
          "The Inbox has everything they sent, and the request is yours to triage from there.",
        ].join("\n"),
      };
    }
    case "comment.mentioned":
      // On by default and interrupting, because being named is done *to*
      // you whatever record it happened on (NOT-002's M18/1 addendum).
      return {
        to,
        subject: `You were mentioned on ${named}`,
        text: [
          hello,
          "",
          `${who} mentioned you in a comment on the request ${named}.`,
          "",
          link,
          "",
          // The comment itself is deliberately not here, for the
          // contract mention's reason: the tier (DD-016) is enforced on
          // the thread, and a redact (CMT-006) cannot reach an email
          // that has already left.
          "The comment is on the request.",
        ].join("\n"),
      };
    // A staff-side slug with no copy — a contract's group-1 or group-2
    // event on a Request row, which no build writes. `null` settles it
    // as skipped rather than improvising a message nobody wrote.
    default:
      return null;
  }
}

/**
 * What each urgency level is called in a message (INT-002).
 *
 * Keyed by the severity union, so a level added to the scale stops
 * compiling here until somebody has decided what it is called. Written
 * out rather than capitalised from the slug, because the words are copy
 * and a slug is a key.
 */
const URGENCY_WORDS: Record<SeverityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

/** One payload urgency as the word a line uses, or null — the status
 * word's own defensive read, one field over. */
function urgencyWord(urgency: string | null): string | null {
  if (urgency === null) return null;
  return Object.hasOwn(URGENCY_WORDS, urgency) ? URGENCY_WORDS[urgency as SeverityLevel] : null;
}

/**
 * The staff messages: groups 1 and 2, every one of them about a
 * contract.
 *
 * A slug from another group answers `null` here, which is the same
 * answer a slug with no copy gets — the record and the event have to
 * agree, and a group-5 slug on a contract row is a row no build wrote.
 */
function contractMail(
  notification: NotificationMail,
  record: Extract<MailRecord, { entityType: "contract" }>,
  to: string,
  baseUrl: string,
): MailMessage | null {
  const link = recordLink(baseUrl, record.number);
  const who = notification.actorName ?? "Somebody";
  const contractTitle = record.title;
  switch (notification.eventType) {
    case "approval.requested":
      return {
        to,
        subject: `Approval requested: ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} has asked you to approve ${contractTitle}.`,
          "",
          link,
          "",
          "You can approve or reject it, with a note, on the record.",
        ].join("\n"),
      };
    case "contract.owner_assigned":
      return {
        to,
        subject: `You are now the owner of ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} has made you the owner of ${contractTitle}.`,
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
          ? `Task assigned: ${task} (${contractTitle})`
          : `Task assigned on ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          task
            ? `${who} has given you a task on ${contractTitle}: ${task}.`
            : `${who} has given you a task on ${contractTitle}.`,
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
        subject: `You were mentioned on ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} mentioned you in a comment on ${contractTitle}.`,
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
        subject: `${contractTitle} moved${status ? ` to ${status}` : ""}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          status
            ? `${who} moved ${contractTitle} to ${status}.`
            : `${who} moved ${contractTitle} to another status.`,
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
        subject: `New comment on ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} commented on ${contractTitle}.`,
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
          ? `New document: ${document} (${contractTitle})`
          : `New document on ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          document
            ? `${who} added ${document} to ${contractTitle}.`
            : `${who} added a document to ${contractTitle}.`,
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
          ? `New version of ${document} (${contractTitle})`
          : `New document version on ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          document
            ? `${who} added ${round} of ${document} on ${contractTitle}.`
            : `${who} added ${round} of a document on ${contractTitle}.`,
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
        subject: `Signature ${status === "signed" ? "complete" : "update"}: ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `The signature envelope on ${contractTitle} ${ending}.`,
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

/**
 * The requester's messages: NOT-002's group 5, every one of them about a
 * Request in the portal (INT-001, INT-003).
 *
 * **These are the one group whose email is on by default**, because a
 * Requester does not live in the app. INT-003 declined the status-poke
 * button on the promise that notifications would reach them instead, so
 * the copy is written for somebody who may not have opened the portal
 * since they submitted: every message names the Request by its R-###
 * reference and by the summary they wrote, and every one of them links
 * to it.
 *
 * **The register is DES-051's**, like every other message here: warm,
 * direct, short sentences, and no urging.
 */
function requestMail(
  notification: NotificationMail,
  record: Extract<MailRecord, { entityType: "request" }>,
  to: string,
  baseUrl: string,
): MailMessage | null {
  const link = portalRequestLink(baseUrl, record.number);
  const reference = requestReference(record.number);
  const who = notification.actorName ?? "Somebody";
  const hello = `Hello ${notification.recipientName},`;
  // Reference then summary, the way the portal's own detail page titles
  // itself: the reference is what a requester quotes, and the summary is
  // what they recognise.
  const named = `${reference} · ${record.summary}`;
  switch (notification.eventType) {
    case "request.created":
      return {
        to,
        // The one message in the catalog addressed to the person who
        // caused the event (INT-001). It is a receipt, so it says the
        // thing arrived and gives them the reference to quote.
        subject: `We have your request: ${named}`,
        text: [
          hello,
          "",
          `Your request ${named} has reached Legal.`,
          "",
          link,
          "",
          "You can follow it and reply to Legal here. We will let you know when anything changes.",
        ].join("\n"),
      };
    case "request.status_changed": {
      const moved = statusWord(detail(notification, "to"));
      return {
        to,
        subject: moved ? `Your request is ${moved}: ${named}` : `An update on ${named}`,
        text: [
          hello,
          "",
          moved
            ? `Your request ${named} is now ${moved}.`
            : `Your request ${named} has moved to another status.`,
          "",
          link,
          "",
          "The request page has the detail, and your conversation with Legal is on it.",
        ].join("\n"),
      };
    }
    case "request.replied":
      return {
        to,
        subject: `Legal replied on ${named}`,
        text: [
          hello,
          "",
          `${who} replied on your request ${named}.`,
          "",
          link,
          "",
          // The words stay on the thread, for the contract thread's
          // reason: DD-016 is enforced there, and a redact (CMT-006)
          // cannot reach an email that has already left.
          "The reply is on the request, and you can answer it there.",
        ].join("\n"),
      };
    case "request.declined": {
      // The reason itself, because INT-006 makes "no" arrive with a why
      // and a line *about* a reason is not the reason. A row written
      // without one still says the honest thing.
      const reason = detail(notification, "reason");
      return {
        to,
        subject: `Your request was declined: ${named}`,
        text: [
          hello,
          "",
          `Legal has declined your request ${named}.`,
          ...(reason ? ["", reason] : []),
          "",
          link,
          "",
          "The reason is on the request, and you can reply to Legal there.",
        ].join("\n"),
      };
    }
    default:
      return null;
  }
}

/**
 * What each lifecycle arm is called in a sentence (INT-007).
 *
 * Keyed by the status union, so an arm added to the lifecycle stops
 * compiling here until somebody has decided what it is called. The words
 * are written out rather than derived from the slug: `converted` is a
 * fact about Legal's machinery, and "in progress" is what it means to
 * the person who asked.
 */
const REQUEST_STATUS_WORDS: Record<RequestStatus, string> = {
  new: "open",
  converted: "in progress",
  resolved: "resolved",
  declined: "declined",
};

/**
 * One payload status as the word a sentence uses, or null.
 *
 * The payload is a snapshot taken by whichever build wrote the row, so
 * a slug this build has no word for — a status an older build had —
 * answers null, and the arm says the honest general thing instead of
 * splicing `undefined` into a subject line.
 */
function statusWord(status: string | null): string | null {
  if (status === null) return null;
  return Object.hasOwn(REQUEST_STATUS_WORDS, status)
    ? REQUEST_STATUS_WORDS[status as RequestStatus]
    : null;
}

// -------------------------------------------------------------------
// The morning digest (NOT-003, NOT-004) — anatomy in NOT-006, register
// in DES-051. Two records, one file: NOT-006 says which lines go and in
// what order, DES-051 says how each one is written.
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
