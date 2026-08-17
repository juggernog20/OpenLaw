// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The notification seam (NOT-001, NOT-002, TECH-007).
 *
 * It is injected into the app factory beside the database, the mailer,
 * storage, and the job queue, and it carries **one method per event**
 * rather than a generic `notify(type, payload)` — the `JobQueue` rule,
 * applied to the thing that tells people. A route names what happened;
 * it never learns that channels exist, who the audience is, or that
 * anything is queued.
 *
 * Behind the seam, in this order, and the order is the decision:
 *
 * 1. **Resolve the audience.** Who does this event concern?
 * 2. **Apply the confidentiality predicate** (DD-014, CTR-022). Of
 *    those people, who does the record actually reach? The wall is
 *    applied here rather than at the call site, so no route can forget
 *    it and no event can be added that skips it.
 * 3. **Apply per-user preferences** (NOT-001/002): the person's own rows
 *    where they exist, the group defaults where they do not. The table
 *    is empty until the preferences slice; the logic is complete now, so
 *    that slice adds a pane and not a rule.
 * 4. **Write the bell rows inside the caller's transaction.** A mutation
 *    that rolls back tells nobody anything — the notification and the
 *    thing it is about are one act.
 * 5. **Queue the email work after commit**, and never before. The queue
 *    is a different system with a different availability, and a mutation
 *    must not fail because it is down.
 *
 * **The row is the record of work owed; the queue is only the wake-up.**
 * That is M12's doctrine (TECH-007), said for mail: `email_owed` is
 * written in the same transaction as the bell row, so a wake-up lost
 * between the commit and the send costs a delay rather than the message
 * — the scheduled round re-asks from the rows. Which is exactly why the
 * send is allowed to fail quietly and the row is not.
 *
 * **The actor is never told about their own act** (NOT-002). It is
 * applied here, once, for every event: a bell that told you what you had
 * just done would be noise in the one place that must only ever be news.
 */

import {
  and,
  eq,
  inArray,
  notificationPreferences,
  notifications,
  type Db,
  type NotificationEventGroup,
  type NotificationEventType,
  type Transaction,
} from "@openlaw/db";
import { boundedQueueAsk, type JobQueue } from "../../pipeline/jobs.js";
import { CONTRACT_ENTITY, reachedBy } from "./audience.js";
import { defaultChoice, emailTimingOf, EVENT_GROUP, type ChannelChoice } from "./catalog.js";

/** Where the seam's own lines go when a wake-up could not be sent. The
 * `document-versions` shape, so a Fastify logger and the pipeline's
 * console logger both fit. */
export interface NotifierLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/** Everything the seam is built from. */
export interface NotifierDeps {
  db: Db;
  /** The pipeline, for the immediate-email wake-up. Asked after the
   * commit and never inside it. */
  jobs: JobQueue;
  log: NotifierLogger;
}

/**
 * The witness a {@link NotifyingTransaction} carries. It is `declare`d
 * and never assigned, so nothing outside this module can mint one — the
 * `LockedContract` pattern, for the same reason: "this event was raised
 * inside a transaction whose commit will send the wake-ups" is a
 * parameter type here rather than a comment somebody has to keep.
 */
declare const notifyingTransactionHeld: unique symbol;

/**
 * A transaction that collects the wake-ups raised inside it.
 *
 * Only {@link Notifier.notifying} mints one, and that is the call that
 * owns the commit — so an event cannot be raised anywhere the commit is
 * not about to happen, and a caller cannot forget the second half.
 */
export type NotifyingTransaction = Transaction & {
  readonly [notifyingTransactionHeld]: true;
};

/** What one approval request tells its approvers (CTR-012). */
export interface ApprovalRequestedEvent {
  contractId: string;
  /** CTR-003's number — the record's address, and what the deep link is
   * built from. */
  contractNumber: number;
  contractTitle: string;
  /** Who asked. They are excluded from their own event. */
  actorId: string;
  actorName: string;
  /** One entry per person asked, in the order the route asked them.
   * `approvalId` is NULL where the row's id could not be read back —
   * the same fallback the activity entry takes, so the two payloads
   * agree rather than one of them carrying an empty string. */
  approvals: readonly { approvalId: string | null; approverId: string }[];
}

export interface Notifier {
  /**
   * Runs one mutation and everything it has to tell people about, in
   * one transaction.
   *
   * The bell rows go inside it, so a rolled-back mutation leaves none.
   * The email wake-ups go out **after** it commits, where a queue that
   * cannot be reached costs a delay rather than the mutation — and a
   * failure to reach it is logged, never raised.
   *
   * It replaces the `app.db.transaction(...)` a notifying route would
   * otherwise open. That is the point: there is one call at the route,
   * and the after-commit half cannot be forgotten because no caller
   * writes it.
   */
  notifying<T>(work: (tx: NotifyingTransaction) => Promise<T>): Promise<T>;

  /**
   * Somebody has been asked to sign a contract off (CTR-012) — group 1,
   * bell on and email immediate (NOT-002).
   *
   * The approvers are the audience; the person who asked is not, even
   * when they asked themselves, which CTR-012 permits.
   */
  approvalRequested(tx: NotifyingTransaction, event: ApprovalRequestedEvent): Promise<void>;
}

/**
 * The wake-ups one transaction has collected, keyed on the transaction
 * itself.
 *
 * A `WeakMap` rather than a property on the handle, because the handle
 * is Drizzle's and this module has no business writing to it. The entry
 * goes when the transaction does.
 */
const collected = new WeakMap<Transaction, string[]>();

/** The collector for a transaction the type says is a notifying one. */
function wakeUpsOf(tx: NotifyingTransaction): string[] {
  const wakeUps = collected.get(tx);
  if (!wakeUps) {
    // Unreachable through the type: only `notifying` mints the brand,
    // and it registers the collector first. Loud rather than silent, so
    // a future path that manufactured a transaction some other way
    // fails here rather than dropping every notification it wrote.
    throw new Error("This transaction is not collecting notifications.");
  }
  return wakeUps;
}

/**
 * One person's answer for one event group: their own rows over the
 * group's defaults (NOT-001).
 *
 * The table holds **overrides**, not a grid, so a missing row is not a
 * missing answer — it is the default, read from the catalog. That is
 * what lets the preferences pane ship later without a backfill, and
 * what makes a changed default reach everybody who never expressed an
 * opinion.
 */
async function channelChoices(
  tx: NotifyingTransaction,
  userIds: readonly string[],
  group: NotificationEventGroup,
): Promise<Map<string, ChannelChoice>> {
  const fallback = defaultChoice(group);
  const choices = new Map<string, ChannelChoice>(
    userIds.map((id) => [id, { ...fallback }] as const),
  );
  if (userIds.length === 0) return choices;
  const rows = await tx
    .select({
      userId: notificationPreferences.userId,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        inArray(notificationPreferences.userId, [...userIds]),
        eq(notificationPreferences.eventGroup, group),
      ),
    );
  for (const row of rows) {
    const choice = choices.get(row.userId);
    if (!choice) continue;
    if (row.channel === "in_app") choice.inApp = row.enabled;
    else choice.email = row.enabled;
  }
  return choices;
}

/** One bell row about to be written. */
interface PendingNotification {
  userId: string;
  payload: Record<string, unknown>;
}

/**
 * The whole fan-out, for one event on one contract: audience, wall,
 * preferences, rows, wake-ups.
 *
 * Every event goes through this, which is what makes the five steps a
 * property of the seam rather than of each call site. An event added
 * later supplies its people and its payload and inherits all of it.
 */
async function fanOut(
  tx: NotifyingTransaction,
  eventType: NotificationEventType,
  contractId: string,
  actorId: string,
  people: readonly PendingNotification[],
): Promise<void> {
  // 1. The audience, minus the person who caused it. Deduplicated: one
  // event tells one person once, however many rows named them.
  const byUser = new Map<string, PendingNotification>();
  for (const person of people) {
    if (person.userId === actorId) continue;
    if (!byUser.has(person.userId)) byUser.set(person.userId, person);
  }
  if (byUser.size === 0) return;

  // 2. The wall (DD-014). Applied here so no event can skip it.
  const reachable = await reachedBy(tx, contractId, [...byUser.keys()]);

  // 3. The preferences, over the group's defaults (NOT-001/002).
  const recipients = [...byUser.keys()].filter((id) => reachable.has(id));
  const choices = await channelChoices(tx, recipients, EVENT_GROUP[eventType]);
  // How email leaves for this event, if it leaves at all (NOT-003).
  // `email_owed` records the **debt**, not the route: a group-3 row owes
  // an email that will leave in the morning digest, and a round that
  // asked "which rows still owe mail" has to see it. What the timing
  // decides is only whether a wake-up goes out now.
  const timing = emailTimingOf(eventType);

  const rows = recipients.flatMap((userId) => {
    const choice = choices.get(userId);
    // In-app off is the whole row: there is nothing to write, and the
    // email is hung off the row it would have been written on. A person
    // who wants email without the bell is not a state NOT-001 offers,
    // and the pane will not offer it either.
    if (!choice?.inApp) return [];
    return [
      {
        userId,
        eventType,
        entityType: CONTRACT_ENTITY,
        entityId: contractId,
        payload: byUser.get(userId)!.payload,
        // The refinement: decided here, at write time, so that "owed
        // and unsent" is a state the rows can be asked about. A group
        // whose email never leaves owes none, whatever a stale
        // preference row says — otherwise the row would claim a debt
        // nothing in the system could ever pay.
        emailOwed: choice.email && timing !== "none",
      },
    ];
  });
  if (rows.length === 0) return;

  // 4. The rows, inside the caller's transaction.
  const written = await tx
    .insert(notifications)
    .values(rows)
    .returning({ id: notifications.id, emailOwed: notifications.emailOwed });

  // 5. The wake-ups, collected for after the commit — only for the
  // rows whose email leaves at once. A digest row owes its email to the
  // scheduled round, which reads the rows rather than the queue.
  if (timing !== "immediate") return;
  const wakeUps = wakeUpsOf(tx);
  for (const row of written) if (row.emailOwed) wakeUps.push(row.id);
}

/** The production seam. */
export function createNotifier(deps: NotifierDeps): Notifier {
  return {
    async notifying<T>(work: (tx: NotifyingTransaction) => Promise<T>): Promise<T> {
      const wakeUps: string[] = [];
      const result = await deps.db.transaction(async (tx) => {
        const notifying = tx as NotifyingTransaction;
        collected.set(tx, wakeUps);
        try {
          return await work(notifying);
        } finally {
          // The collector's job ends with the callback. Anything the
          // transaction wrote is already in `wakeUps`, and a handle
          // that outlived its transaction must not still be collecting.
          collected.delete(tx);
        }
      });
      // Only here: the rows are committed, so a wake-up now names
      // something that exists. A rolled-back transaction never reaches
      // this line, which is why a failed mutation sends nothing.
      // Together rather than one after another. One ask per recipient,
      // and applying an approver group can name fifty people — each ask
      // is bounded on its own (`boundedQueueAsk`), so a serial loop
      // would put fifty bounds end to end in front of a response that
      // has already been decided.
      await Promise.all(
        wakeUps.map(async (notificationId) => {
          try {
            await boundedQueueAsk(deps.jobs.requestNotificationEmail(notificationId));
          } catch (error) {
            // Logged, never raised. The mutation has committed and the
            // row says the email is still owed, so the worst this costs
            // is the delay until the round that re-asks from the rows.
            deps.log.error(
              { err: error, notificationId },
              "could not ask the pipeline to send a notification email",
            );
          }
        }),
      );
      return result;
    },

    async approvalRequested(
      tx: NotifyingTransaction,
      event: ApprovalRequestedEvent,
    ): Promise<void> {
      await fanOut(
        tx,
        "approval.requested",
        event.contractId,
        event.actorId,
        event.approvals.map((approval) => ({
          userId: approval.approverId,
          // Snapshotted at write time: the item says what was true when
          // it fired, and the deep link shows current truth.
          payload: {
            approvalId: approval.approvalId,
            contractNumber: event.contractNumber,
            contractTitle: event.contractTitle,
            actorId: event.actorId,
            actorName: event.actorName,
          },
        })),
      );
    },
  };
}
