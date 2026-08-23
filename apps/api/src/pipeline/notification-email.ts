// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One notification's immediate email (NOT-002 group 1, NOT-003,
 * TECH-011).
 *
 * The bell row is already on the record by the time this runs — it was
 * written inside the mutation's own transaction — so this job's whole
 * job is the second channel. Four rules shape it.
 *
 * **The row is the record of the work owed.** `email_owed` says an
 * email was due when the notification was written; `emailed_at` and
 * `email_skipped_at` say what became of it. A job that finds the work
 * already done stops, so a wake-up that arrives twice — a lost send
 * re-asked by the scheduled round, beside the original — costs one
 * message, not two.
 *
 * **The mailer is resolved at send time**, env-else-database (TECH-011,
 * the read-on-every-decision pattern). A relay saved in the wizard
 * therefore applies to the very next notification with no restart, and
 * a rotated one applies to the one after that.
 *
 * **An unconfigured relay is terminal, and it is loud.** It is not a
 * moment's failure: no retry configures SMTP, and three attempts would
 * only write the same line three times. So the skip is recorded on the
 * row, the job is done with, and the operator's log says
 * `unconfigured` in as many words — TECH-011's posture, which is that a
 * missing relay degrades one channel and hides nothing.
 *
 * **The wall is re-applied here** (DD-014, CTR-022, M10). The audience
 * was decided when the row was written, and a record can be walled off
 * between then and now. An email carries the record's title out of the
 * building, so it asks the same predicate the bell's own reads ask, live
 * — and a recipient the record no longer reaches has the send recorded
 * as skipped rather than sent. There is **one arm per entity type**, and
 * a row about an entity with no arm is refused: an entity with no rule
 * yet must not be the one thing that leaves the building unchecked.
 */

import {
  and,
  eq,
  isNull,
  NOTIFICATION_EVENT_TYPES,
  notifications,
  users,
  type Db,
  type NotificationEventType,
} from "@openlaw/db";
import {
  CONTRACT_ENTITY,
  reachedBy,
  requestReachedBy,
  REQUEST_ENTITY,
} from "../lib/notifications/audience.js";
import { requestSideOf } from "../lib/notifications/catalog.js";
import { renderNotificationMail, type MailRecord } from "../lib/notifications/email.js";
import type { MailerResolver } from "../lib/mailer.js";
import { reasonOf } from "./derivations.js";
import type { PipelineLogger } from "./logger.js";

/** Everything the send is built from. */
export interface NotificationEmailDeps {
  db: Db;
  /** TECH-011's composition point, resolved per send. */
  resolveMailer: MailerResolver;
  /** The address this install answers on, so the message can deep-link
   * to the record it is about. */
  baseUrl: string;
  log: PipelineLogger;
}

/** One job, as the retry policy needs it described. */
export interface NotificationEmailAttempt {
  notificationId: string;
  retryCount: number;
  retryLimit: number;
}

/**
 * Why an email did not go, when the answer is "and it never will".
 *
 * Every one of them is a fact a retry cannot change: an install with no
 * relay, a person who has left, a record this recipient may no longer
 * see, a row about something the wall has no rule for, and a slug this
 * build has no copy for. Everything else — a relay that refused, a
 * socket that closed, an error nobody has classified — is the moment's
 * and is retried, on the derivation handler's reasoning: retrying
 * something permanent wastes two attempts and records the failure
 * anyway, while giving up on something temporary loses the message.
 *
 * They are told apart rather than collapsed into one word, because an
 * operator reading the log needs to know which of them happened — "no
 * relay" is theirs to fix, "walled off" is the wall working, and "no
 * copy" is ours.
 */
type Terminal = "unconfigured" | "archived" | "unreachable" | "unaddressable" | "unrenderable";

/** What each terminal answer says in the log, and how loudly. Only the
 * unconfigured one is an error: it is the one an operator can act on,
 * and TECH-011 requires it to be unmissable. */
const TERMINAL_LINES: Record<Terminal, { level: "error" | "warn"; message: string }> = {
  unconfigured: {
    level: "error",
    message:
      "email is unconfigured, so a notification email was skipped — " +
      "the bell item is unaffected; set SMTP_URL and SMTP_FROM, or " +
      "configure email in Settings",
  },
  archived: {
    level: "warn",
    message: "a notification email was skipped: its recipient has been archived",
  },
  unreachable: {
    level: "warn",
    message: "a notification email was skipped: its recipient no longer reaches the record",
  },
  unaddressable: {
    level: "warn",
    message: "a notification email was skipped: nothing on the row says where to send it",
  },
  unrenderable: {
    level: "warn",
    message: "a notification email was skipped: this build has no email copy for its event",
  },
};

/** The slugs this build knows, as a set, so a row written by another
 * build is recognised as unknown rather than cast into the union. */
const KNOWN_EVENTS: ReadonlySet<string> = new Set(NOTIFICATION_EVENT_TYPES);

/** One payload number as a record's address, or null where it is not
 * one. Both entity arms read their number through it, so "a record with
 * no address sends no email" is one rule rather than two. */
function addressOf(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Marks the email settled, whichever way it went. Guarded on "still
 * owed and still unanswered", so a send that landed between the failure
 * and this write is not undone. */
async function settle(
  deps: NotificationEmailDeps,
  notificationId: string,
  outcome: "sent" | "skipped",
): Promise<void> {
  await deps.db
    .update(notifications)
    .set(outcome === "sent" ? { emailedAt: new Date() } : { emailSkippedAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.emailOwed, true),
        isNull(notifications.emailedAt),
        isNull(notifications.emailSkippedAt),
      ),
    );
}

/**
 * Sends one notification's email, or answers why it will never be sent.
 *
 * Returning `null` means the message has gone (or there was nothing
 * left to do). Returning a {@link Terminal} means it will not go and no
 * retry would change that. Throwing is the moment's failure, which
 * pg-boss retries.
 */
async function sendNotificationEmail(
  deps: NotificationEmailDeps,
  notificationId: string,
): Promise<Terminal | null> {
  const [row] = await deps.db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      eventType: notifications.eventType,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      payload: notifications.payload,
      emailOwed: notifications.emailOwed,
      emailedAt: notifications.emailedAt,
      emailSkippedAt: notifications.emailSkippedAt,
      recipientEmail: users.email,
      recipientName: users.displayName,
      recipientArchivedAt: users.archivedAt,
    })
    .from(notifications)
    .innerJoin(users, eq(notifications.userId, users.id))
    .where(eq(notifications.id, notificationId))
    .limit(1);

  // Nothing owed, nothing left, or already answered for. All three are
  // "the work is done", and a job that arrived twice lands here on the
  // second pass.
  if (!row) return null;
  if (!row.emailOwed || row.emailedAt || row.emailSkippedAt) return null;
  // Somebody who has left is reached by nothing (SET-005). The bell row
  // stays where it is; there is simply no inbox to write to.
  if (row.recipientArchivedAt) return "archived";

  // The wall, live, and one arm per entity type. A row about an entity
  // with no rule here is refused rather than waved through: it must not
  // be the one thing that leaves the building unchecked.
  //
  // The predicates are the ones the writes use, so the email and the
  // bell cannot disagree about who may be told what. A contract's is
  // DD-014; a Request's is that this person still stands where the event
  // addressed them — its Requester for group 5 (DD-013), a triager for
  // group 4 (INT-006) — which is the only fact about reach that can
  // change after the row was written.
  const payload = row.payload;
  let record: MailRecord;
  if (row.entityType === CONTRACT_ENTITY) {
    const reachable = await reachedBy(deps.db, row.entityId, [row.userId]);
    if (!reachable.has(row.userId)) return "unreachable";
    // The payload is a snapshot taken by whichever build wrote the row,
    // so every field is read defensively — the activity narrator's rule.
    // A record with no number has no address, and a link to
    // `/contracts/NaN` is worse than no email at all.
    const number = addressOf(payload.contractNumber);
    const title = typeof payload.contractTitle === "string" ? payload.contractTitle : "";
    if (number === null || title === "") return "unaddressable";
    record = { entityType: "contract", number, title };
  } else if (row.entityType === REQUEST_ENTITY) {
    const reachable = await requestReachedBy(deps.db, row.entityId, [row.userId], {
      side: requestSideOf(row.eventType),
    });
    if (!reachable.has(row.userId)) return "unreachable";
    const number = addressOf(payload.requestNumber);
    const summary = typeof payload.requestSummary === "string" ? payload.requestSummary : "";
    if (number === null || summary === "") return "unaddressable";
    record = { entityType: "request", number, summary };
  } else {
    return "unreachable";
  }
  // A slug this build has never heard of — a row written by a version
  // that has since been replaced. Recognised rather than cast, so the
  // renderer is only ever asked about the catalog it was written for.
  if (!KNOWN_EVENTS.has(row.eventType)) return "unrenderable";

  const { mailer, from } = await deps.resolveMailer();
  if (!mailer.configured || !from) return "unconfigured";

  const message = renderNotificationMail(
    {
      eventType: row.eventType as NotificationEventType,
      record,
      actorName: typeof payload.actorName === "string" ? payload.actorName : null,
      recipientName: row.recipientName,
      // The rest of the snapshot, for the arms that name something
      // inside the record. The template layer reads it defensively; the
      // two keys above are lifted out because every arm needs them and
      // a row without them has no address at all.
      details: payload,
    },
    row.recipientEmail,
    deps.baseUrl,
  );
  // No copy for this event yet — group 3's words arrive with the digest
  // (NOT-003). Terminal, because no retry writes copy.
  if (!message) return "unrenderable";
  await mailer.send(message);
  await settle(deps, notificationId, "sent");
  return null;
}

/**
 * Runs one notification-email job and decides what its failure means.
 *
 * Returning means the job is done with — the message has gone, or the
 * row says the email was skipped and no retry would change that.
 * Throwing hands the job back to pg-boss, which retries it until its
 * bound runs out; the last attempt settles the row the same way, so a
 * relay that stayed down does not leave a row owing an email for ever.
 */
export async function handleNotificationEmail(
  deps: NotificationEmailDeps,
  attempt: NotificationEmailAttempt,
): Promise<void> {
  let terminal: Terminal | null;
  try {
    terminal = await sendNotificationEmail(deps, attempt.notificationId);
  } catch (error) {
    const exhausted = attempt.retryCount >= attempt.retryLimit;
    if (exhausted) {
      await settle(deps, attempt.notificationId, "skipped");
      deps.log.error(
        {
          notificationId: attempt.notificationId,
          attempts: attempt.retryCount + 1,
          reason: reasonOf(error),
        },
        "sending a notification email failed and will not be retried",
      );
      return;
    }
    throw error;
  }
  if (!terminal) return;

  await settle(deps, attempt.notificationId, "skipped");
  // The unconfigured line is loud, and in the word an operator can
  // search for. TECH-011's whole posture is that unset SMTP reports
  // unconfigured rather than swallowing mail, and this is that sentence
  // on the one path with no request to answer it in.
  const line = TERMINAL_LINES[terminal];
  deps.log[line.level]({ notificationId: attempt.notificationId, reason: terminal }, line.message);
}
