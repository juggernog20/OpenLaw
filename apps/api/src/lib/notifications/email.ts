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
}

/** The deep link one notification points at: the record itself. */
function recordLink(baseUrl: string, contractNumber: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/contracts/${contractNumber}`;
}

/**
 * The subject and body one notification is sent as.
 *
 * `null` for a slug this layer has no words for yet. Most of the
 * catalog is in that state in M18/1: their groups send no immediate
 * email at all (NOT-002/NOT-003), and the digest that renders group 3
 * arrives with the dates slice. Answering `null` rather than improvising
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
    default:
      return null;
  }
}
