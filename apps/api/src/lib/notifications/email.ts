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
 * sides — from the side the event's group speaks to (M21/5): the staff
 * side's messages, the arrival and the mention, address the staff detail
 * (INT-006), and the Requester's address the portal (DD-013). The arms
 * are split so that one file still holds how an OpenLaw email is laid
 * out.
 *
 * **The copy is authored here in English, not in the message catalog.**
 * That is the API's own convention (DES-013 puts the catalog in the web
 * app, and every refusal sentence in this API is written at its call
 * site) — the strings the M4 contract governs are the ones a browser
 * renders, and the bell's own strings arrive with the bell. What this
 * layer sends is the same class of copy as the invite email above it.
 *
 * Contract and Matter events pair the authored text with the DES-093 layout.
 */

import type { NotificationEventType, RequestStatus, SeverityLevel } from "@openlaw/db";
import {
  renderEmailLayout,
  type EmailBrand,
  type EmailModel,
  type EmailRecord,
} from "../email-layout.js";
export { escapeHtml } from "../email-layout.js";
import type { MailMessage } from "../mailer.js";
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
  | { entityType: "matter"; number: number; title: string }
  | { entityType: "contract"; number: number; title: string }
  | { entityType: "request"; number: number; title: string };

/** One notification, as the template layer needs it described. */
export interface NotificationMail {
  recipientRole?: string;
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
 * for keeping the regex would have been.
 *
 * Shared with the briefing template, which builds its links the same
 * way from the same setting. */
export function origin(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end -= 1;
  return baseUrl.slice(0, end);
}

/** The deep link one notification points at: the record itself. */
export function recordLink(baseUrl: string, contractNumber: number): string {
  return `${origin(baseUrl)}/contracts/${contractNumber}`;
}

export function matterLink(baseUrl: string, matterNumber: number): string {
  return `${origin(baseUrl)}/matters/${matterNumber}`;
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
 * The deep link a staff-side message points at: the Request in the Inbox.
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
  brand: EmailBrand = {},
): MailMessage | null {
  const { record } = notification;
  if (record.entityType === "matter") return matterMail(notification, record, to, baseUrl, brand);
  if (record.entityType === "contract")
    return contractMail(notification, record, to, baseUrl, brand);
  // A Request is read from two sides, so the group is what says which
  // message this is. The record alone cannot: both audiences hold rows
  // about the same Request, and one of them is staff.
  return requestSideOf(notification.eventType) === "inbox"
    ? staffRequestMail(notification, record, to, baseUrl)
    : requestMail(notification, record, to, baseUrl);
}

/** The shared record facts; each event supplies its own copy and extra facts. */
function recordLayout(
  notification: NotificationMail,
  baseUrl: string,
  brand: EmailBrand,
  model: Omit<EmailModel, "baseUrl" | "surface" | "greeting" | "record"> & {
    record?: Partial<EmailRecord>;
  },
): ReturnType<typeof renderEmailLayout> {
  const matter = notification.record.entityType === "matter";
  return renderEmailLayout(
    {
      ...model,
      baseUrl,
      surface: notification.recipientRole === "business_user" ? "portal" : "staff",
      greeting: `Hello ${notification.recipientName},`,
      preheader: model.preheader ?? model.body?.join(" "),
      record: {
        kind: matter ? "Matter" : "Contract",
        ref: `${matter ? "M" : "C"}-${notification.record.number}`,
        title: notification.record.title,
        href: matter
          ? matterLink(baseUrl, notification.record.number)
          : recordLink(baseUrl, notification.record.number),
        ...(notification.actorName ? { actor: notification.actorName } : {}),
        ...model.record,
      },
    },
    brand,
  );
}

function matterMail(
  notification: NotificationMail,
  record: Extract<MailRecord, { entityType: "matter" }>,
  to: string,
  baseUrl: string,
  brand: EmailBrand,
): MailMessage | null {
  const named = `M-${record.number} · ${record.title}`;
  const link = matterLink(baseUrl, record.number);
  const who = notification.actorName ?? "Somebody";
  if (notification.eventType === "matter.task_assigned") {
    const task = detail(notification, "taskTitle");
    return {
      ...recordLayout(notification, baseUrl, brand, {
        subject: task ? `Task assigned: ${task} (${named})` : `Task assigned on ${named}`,
        tone: "assigned",
        label: "Task assigned",
        headline: task ?? "Task assigned",
        body: [
          task
            ? `${who} has given you a Task on ${named}: ${task}.`
            : `${who} has given you a Task on ${named}.`,
        ],
        record: { facts: task ? [{ label: "Task", value: task }] : [] },
        action: {
          label: "Open tasks",
          href: `${link}/tasks`,
          line: "The checklist is on the Matter record.",
        },
        footer: { kind: "notification", why: "The task is assigned to you." },
      }),
      to,
      subject: task ? `Task assigned: ${task} (${named})` : `Task assigned on ${named}`,
      text: [
        `Hello ${notification.recipientName},`,
        "",
        task
          ? `${who} has given you a Task on ${named}: ${task}.`
          : `${who} has given you a Task on ${named}.`,
        "",
        `${link}/tasks`,
        "",
        "The checklist is on the Matter record.",
      ].join("\n"),
    };
  }
  if (notification.eventType === "comment.mentioned") {
    return {
      to,
      subject: `You were mentioned on ${named}`,
      text: [
        `Hello ${notification.recipientName},`,
        "",
        `${who} mentioned you in a comment on ${named}.`,
        "",
        link,
        "",
        "The comment is on the matter.",
      ].join("\n"),
    };
  }
  if (notification.eventType === "comment.posted") {
    return {
      to,
      subject: `New comment on ${named}`,
      text: [
        `Hello ${notification.recipientName},`,
        "",
        `${who} commented on ${named}.`,
        "",
        link,
        "",
        "The comment is on the matter.",
      ].join("\n"),
    };
  }
  return null;
}

/**
 * The staff side's messages about a Request: NOT-002's group 4 arrival
 * (INT-006) and, from M21/5, group 1's mention on a Request thread.
 *
 * **Both address the staff detail** (#414), because both readers are
 * triagers. The portal address is the Requester's, and a message that
 * sent staff there would land them on somebody else's window.
 *
 * **Every message names the Request as `R-### · title`**, the way the
 * requester's own messages do: the reference is what gets quoted, the
 * title is what gets recognised.
 *
 * **The register is DES-051's**, like every other message here.
 */
function staffRequestMail(
  notification: NotificationMail,
  record: Extract<MailRecord, { entityType: "request" }>,
  to: string,
  baseUrl: string,
): MailMessage | null {
  const named = `${requestReference(record.number)} · ${record.title}`;
  const link = inboxRequestLink(baseUrl, record.number);
  const hello = `Hello ${notification.recipientName},`;
  const who = notification.actorName ?? "Somebody";
  switch (notification.eventType) {
    case "request.assigned":
      return {
        to,
        subject: `Request assigned for triage: ${named}`,
        text: [hello, "", `${who} assigned you to triage ${named}.`, "", link].join("\n"),
      };
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
    case "request.conversion_draft_finished": {
      // Opt-in through group 4, and addressed to the one person who asked
      // for the draft and then closed the dialog (INT-008). The link
      // reopens the Convert dialog for the module they were converting
      // to, so the draft is one click from being reviewed.
      const module = detail(notification, "targetModule");
      const convertLink =
        module === "matter" || module === "contract" ? `${link}?convert=${module}` : link;
      if (detail(notification, "outcome") === "ready") {
        return {
          to,
          subject: `Conversion draft ready: ${named}`,
          text: [
            hello,
            "",
            `The conversion draft you asked for on ${named} is ready to review.`,
            "",
            convertLink,
          ].join("\n"),
        };
      }
      return {
        to,
        subject: `Conversion draft could not finish: ${named}`,
        text: [
          hello,
          "",
          `The conversion draft you asked for on ${named} could not finish.`,
          "",
          convertLink,
          "",
          "Retry it from the Convert dialog, or continue manually.",
        ].join("\n"),
      };
    }
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
  return wordFor(URGENCY_WORDS, urgency);
}

/**
 * One payload slug read against a table of copy this build holds, or
 * null.
 *
 * A guard rather than a cast: the slug is arbitrary payload text, and a
 * cast would tell the compiler it is a key of the table when nothing has
 * checked that. `Object.hasOwn` is the check, and it also keeps
 * `constructor` and `toString` from reading a word off the prototype.
 */
function wordFor(words: Readonly<Record<string, string>>, slug: string | null): string | null {
  if (slug === null || !Object.hasOwn(words, slug)) return null;
  return words[slug] ?? null;
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
  brand: EmailBrand,
): MailMessage | null {
  const approvalId = detail(notification, "approvalId");
  const link =
    notification.eventType === "approval.requested" &&
    notification.recipientRole === "business_user" &&
    approvalId
      ? `${origin(baseUrl).replace(/\/portal$/, "")}/portal/approvals/${encodeURIComponent(approvalId)}`
      : recordLink(baseUrl, record.number);
  const who = notification.actorName ?? "Somebody";
  const contractTitle = record.title;
  switch (notification.eventType) {
    case "approval.requested":
      return {
        ...renderEmailLayout(
          {
            subject: `Approval requested: ${contractTitle}`,
            baseUrl,
            surface: notification.recipientRole === "business_user" ? "portal" : "staff",
            preheader: `${who} has asked you to approve ${contractTitle}.`,
            tone: "warning",
            label: "Approval requested",
            headline: `${who} asked you to approve a contract`,
            greeting: `Hello ${notification.recipientName},`,
            body: [`${who} has asked you to approve ${contractTitle}.`],
            record: {
              kind: "Contract",
              ref: `C-${record.number}`,
              title: contractTitle,
              href: link,
              status: { label: "Pending approval", tone: "warning" },
              ...(notification.actorName ? { actor: notification.actorName } : {}),
            },
            action: {
              label: "Review approval",
              href: link,
              line:
                notification.recipientRole === "business_user"
                  ? "You can approve or reject it, with a note, on the approval page."
                  : "You can approve or reject it, with a note, on the record.",
            },
            footer: { kind: "notification", why: "You are an approver on this contract." },
          },
          brand,
        ),
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
    case "contract.team_added":
      return {
        ...recordLayout(notification, baseUrl, brand, {
          subject: `You were added to ${contractTitle}`,
          tone: "assigned",
          label: "Added to team",
          headline: "You were added to a contract team",
          body: [`${who} added you to the team on ${contractTitle}.`],
          action: { label: "Open contract", href: link },
          footer: { kind: "notification", why: "You are on the team for this contract." },
        }),
        to,
        subject: `You were added to ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} added you to the team on ${contractTitle}.`,
          "",
          link,
        ].join("\n"),
      };
    case "contract.generated":
    case "contract.generated_unassigned": {
      const autoDoc = detail(notification, "autoDocName") ?? "an Auto-Doc";
      const assigned = notification.eventType === "contract.generated";
      return {
        ...recordLayout(notification, baseUrl, brand, {
          subject: assigned
            ? `Generated Contract assigned to you: ${contractTitle}`
            : `Unassigned generated Contract: ${contractTitle}`,
          tone: assigned ? "success" : "warning",
          label: assigned ? "Generated contract" : "Needs an owner",
          headline: assigned
            ? "A generated contract is yours"
            : "A generated contract needs an owner",
          body: [
            `${who} generated ${contractTitle} from ${autoDoc}.`,
            assigned
              ? "You are the Owner of this Contract."
              : "This Contract needs an Owner. Claim it in the Inbox.",
          ],
          record: {
            facts: detail(notification, "autoDocName")
              ? [{ label: "Auto-Doc", value: autoDoc }]
              : [],
          },
          action: { label: assigned ? "Open contract" : "Claim it", href: link },
          footer: {
            kind: "notification",
            why: assigned
              ? "You are the owner of this contract."
              : "You triage generated contracts.",
          },
        }),
        to,
        subject: assigned
          ? `Generated Contract assigned to you: ${contractTitle}`
          : `Unassigned generated Contract: ${contractTitle}`,
        text: [
          `Hello ${notification.recipientName},`,
          "",
          `${who} generated ${contractTitle} from ${autoDoc}.`,
          assigned
            ? "You are the Owner of this Contract."
            : "This Contract needs an Owner. Claim it in the Inbox.",
          "",
          link,
        ].join("\n"),
      };
    }
    case "contract.owner_assigned":
      return {
        ...recordLayout(notification, baseUrl, brand, {
          subject: `You are now the owner of ${contractTitle}`,
          tone: "assigned",
          label: "Owner assigned",
          headline: "You are now the owner",
          body: [`${who} has made you the owner of ${contractTitle}.`],
          action: {
            label: "Open contract",
            href: link,
            line: "The owner is the accountable person on a contract.",
          },
          footer: { kind: "notification", why: "You are the owner of this contract." },
        }),
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
        ...recordLayout(notification, baseUrl, brand, {
          subject: task
            ? `Task assigned: ${task} (${contractTitle})`
            : `Task assigned on ${contractTitle}`,
          tone: "assigned",
          label: "Task assigned",
          headline: task ?? "Task assigned",
          body: [
            task
              ? `${who} has given you a task on ${contractTitle}: ${task}.`
              : `${who} has given you a task on ${contractTitle}.`,
          ],
          record: { facts: task ? [{ label: "Task", value: task }] : [] },
          action: { label: "Open tasks", href: link, line: "The checklist is on the record." },
          footer: { kind: "notification", why: "The task is assigned to you." },
        }),
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
        ...recordLayout(notification, baseUrl, brand, {
          subject: `${contractTitle} moved${status ? ` to ${status}` : ""}`,
          tone: "info",
          label: "Status changed",
          headline: status ? `Moved to ${status}` : "Status changed",
          body: [
            status
              ? `${who} moved ${contractTitle} to ${status}.`
              : `${who} moved ${contractTitle} to another status.`,
          ],
          record: {
            previousStatus: detail(notification, "from") ?? undefined,
            status: status ? { label: status, tone: "info" } : undefined,
          },
          action: {
            label: "Open contract",
            href: link,
            line: "The record's own feed has the full history.",
          },
          footer: { kind: "notification", why: "You turned on activity emails." },
        }),
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
        ...recordLayout(notification, baseUrl, brand, {
          subject: document
            ? `New document: ${document} (${contractTitle})`
            : `New document on ${contractTitle}`,
          tone: "neutral",
          label: "New document",
          headline: document ?? "New document",
          body: [
            document
              ? `${who} added ${document} to ${contractTitle}.`
              : `${who} added a document to ${contractTitle}.`,
          ],
          record: { document: document ? { name: document } : undefined },
          action: {
            label: "Open documents",
            href: link,
            line: "The document list is on the record. Files are never attached, so the record's access rules still apply.",
          },
          footer: { kind: "notification", why: "You turned on activity emails." },
        }),
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
        ...recordLayout(notification, baseUrl, brand, {
          subject: document
            ? `New version of ${document} (${contractTitle})`
            : `New document version on ${contractTitle}`,
          tone: "info",
          label: "New version",
          headline: document
            ? `${version ? `v${version}` : "New version"} of ${document}`
            : "New document version",
          body: [
            document
              ? `${who} added ${round} of ${document} on ${contractTitle}.`
              : `${who} added ${round} of a document on ${contractTitle}.`,
          ],
          record: {
            document: document
              ? { name: document, version: version ? `v${version}` : undefined }
              : undefined,
          },
          action: {
            label: "Open version history",
            href: link,
            line: "The version history is on the record.",
          },
          footer: { kind: "notification", why: "You turned on activity emails." },
        }),
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
        ...recordLayout(notification, baseUrl, brand, {
          subject: `Signature ${status === "signed" ? "complete" : "update"}: ${contractTitle}`,
          tone:
            status === "signed"
              ? "success"
              : status === "declined" || status === "voided"
                ? "danger"
                : "neutral",
          label:
            status === "signed"
              ? "Signed"
              : status === "declined" || status === "voided"
                ? `Signature ${status}`
                : "Signature update",
          headline:
            status === "signed" ? `${contractTitle} is signed` : `The signature envelope ${ending}`,
          body: [`The signature envelope on ${contractTitle} ${ending}.`],
          action: {
            label: "Open contract",
            href: link,
            line: "The signature panel on the record has the detail.",
          },
          footer: { kind: "notification", why: "You turned on activity emails." },
        }),
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
    // the daily briefing renderer. A row that somehow reached the
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
 * reference and by the title they wrote, and every one of them links
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
  // Reference then title, the way the portal's own detail page titles
  // itself: the reference is what a requester quotes, and the title is
  // what they recognise.
  const named = `${reference} · ${record.title}`;
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
  read: "read",
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
  return wordFor(REQUEST_STATUS_WORDS, status);
}
