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

/** The deep link one notification points at: the record itself. */
function recordLink(baseUrl: string, contractNumber: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/contracts/${contractNumber}`;
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
    default:
      return null;
  }
}
