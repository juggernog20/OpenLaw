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
 *    where they exist, the group defaults where they do not. Read
 *    through `preferences.ts`, which the Personal → Notifications pane
 *    reads through too — the pane draws what the fan-out honours
 *    because both start from the same defaults and apply the same rows.
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
 *
 * **An act with no actor excludes nobody.** A webhook delivery, a
 * reconciliation round, and the executed-copy fetch are the integration
 * speaking, not a person (CTR-013) — the same fact the activity feed
 * records by writing an entry with no actor. So the actor is `null`
 * there, and the whole team is told, because there is no one person for
 * the exclusion to be about. Passing the logged-in user of whichever
 * process happened to be running would silently drop one real recipient.
 */

import {
  commentMentions,
  eq,
  notifications,
  sql,
  type CommentVisibility,
  type ContractStage,
  type Db,
  type EnvelopeStatus,
  type NotificationEventType,
  type Transaction,
} from "@openlaw/db";
import { boundedQueueAsk, type JobQueue } from "../../pipeline/jobs.js";
import { contractRecordAudience, CONTRACT_ENTITY, reachedBy } from "./audience.js";
import { emailTimingOf, EVENT_GROUP } from "./catalog.js";
import { channelChoices } from "./preferences.js";

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

/** What one hand-over tells the person it was handed to (CTR-004). */
export interface OwnerAssignedEvent {
  contractId: string;
  contractNumber: number;
  contractTitle: string;
  /** Who handed it over. They are excluded from their own event, which
   * is what makes taking a record yourself silent. */
  actorId: string;
  actorName: string;
  /** The new Owner — the whole audience of this event. Clearing the
   * Owner hands the record to nobody, so the route raises nothing. */
  ownerId: string;
}

/** What one task assignment tells its assignee (CTR-017). */
export interface TaskAssignedEvent {
  contractId: string;
  contractNumber: number;
  contractTitle: string;
  actorId: string;
  actorName: string;
  /** The task's own id and title. The item and the email name the thing
   * that was assigned, not only the record it sits on. */
  taskId: string;
  taskTitle: string;
  /** Who it was given to — the whole audience of this event. */
  assigneeId: string;
}

/** What one comment tells the people it addresses (CMT-007). */
export interface CommentMentionedEvent {
  contractId: string;
  contractNumber: number;
  contractTitle: string;
  actorId: string;
  actorName: string;
  /**
   * The comment that named them. The seam reads its audience from
   * `comment_mentions` rather than taking a list of people from the
   * route: who a comment addresses is a queryable list, and the table is
   * the only thing that knows it.
   */
  commentId: string;
  /** The comment's DD-016 tier, carried so the fan-out can hold it. */
  visibility: CommentVisibility;
}

/**
 * What every ambient event on a record carries (NOT-002 group 2).
 *
 * Only two facts, and one of them is often nobody. The record is named
 * by its id alone: the audience read behind the seam already holds the
 * row, so the number and the title are taken from there rather than
 * asked of four call sites that would each have to read them.
 *
 * **`actorId` is nullable, and null is a real answer.** The integration
 * files an executed copy and moves an envelope on nobody's behalf
 * (CTR-013), so there is no person to exclude and the whole team is
 * told. `actorName` is null with it, and the bell's own arms already
 * say the actorless sentence.
 */
export interface RecordEvent {
  contractId: string;
  /** Who caused it, or null where nobody did. */
  actorId: string | null;
  actorName: string | null;
}

/** What a status move tells the record's people (CTR-001). */
export interface StatusChangedEvent extends RecordEvent {
  /** The status names either side of the move, as the record's own feed
   * writes them. Plain strings, because a status is a renameable label
   * an Administrator chose (CTR-001) and nothing branches on it. */
  from: string;
  to: string;
  /** The stages behind those two statuses — the closed set surfaces
   * actually branch on, so they are typed as that set rather than as
   * free text. Derived from the status and never stored, so they ride
   * along here rather than being re-derived from a snapshot later. */
  fromStage: ContractStage;
  toStage: ContractStage;
}

/** What one ordinary comment tells the record's people (DD-016). */
export interface CommentPostedEvent extends RecordEvent {
  commentId: string;
  /** The comment's DD-016 tier, carried so the fan-out can hold it: a
   * Legal Only comment never reaches a Contributor. */
  visibility: CommentVisibility;
  /**
   * Who this comment already addressed by name, if anybody.
   *
   * They are excluded here because they have just been told, louder:
   * a mention is group 1 and interrupts (NOT-002's M18/1 addendum). Two
   * bell rows for one comment would be the same news twice.
   */
  mentioned?: readonly string[];
}

/** What a document landing tells the record's people (DOC-001). */
export interface DocumentEvent extends RecordEvent {
  documentId: string;
  documentTitle: string;
  /** DD-014's per-document flag as it stands on the row (DOC-008). Set,
   * the event goes only as far as the file does. */
  isConfidential: boolean;
}

/** What one new round on a chain tells the record's people (DOC-001). */
export interface DocumentVersionEvent extends DocumentEvent {
  versionId: string;
  versionNumber: number;
}

/** What an envelope's ending tells the record's people (CTR-013). */
export interface EnvelopeEndedEvent extends RecordEvent {
  envelopeId: string;
  /** Which ending it was: signed, declined, or voided. Never `sent` —
   * an envelope is not born by ending. */
  status: EnvelopeStatus;
}

/**
 * What one approaching date tells the people the round is serving
 * (NOT-002 group 3, NOT-004).
 *
 * **There is no actor**, and the field is absent rather than null: a
 * date arriving is nobody's act. The round is the calendar speaking, in
 * the same way the reconciliation round is the integration speaking.
 *
 * **The people are the caller's**, as they are for every group-1 event.
 * The round has already decided *whose morning it is* — a fact about
 * clocks that the seam has no business knowing — so it names them, and
 * the seam still decides whether the record lets them be told.
 *
 * **The record names itself through the caller**, as group 1's does: the
 * round has just read the contract's row to find the date on it, so
 * asking the seam to read it again would be the same query twice.
 */
export interface DateReminderEvent {
  contractId: string;
  contractNumber: number;
  contractTitle: string;
  /**
   * The date this reminder is about, as a civil date. Half of the dedup
   * identity: a date that **moves** is a different value, so it fires
   * again for the new one and the row about the old one stays where it
   * is.
   */
  reminderDate: string;
  /** Which NOT-004 offset fired it — the other half of the identity, so
   * one date reminds at seven days, at one day, and on the day, and
   * never twice at the same distance. */
  offsetDays: number;
  /** The people this round is serving about this record. */
  userIds: readonly string[];
}

/** What one approaching key date carries beyond the rest (CTR-009). */
export interface KeyDateReminderEvent extends DateReminderEvent {
  /** The row the date is on, so the item can address the record's Key
   * dates section (DES-049 clause 9) and a reader can tell two dates on
   * one record apart. */
  keyDateId: string;
  /** What somebody called it. A key date with no name is refused at the
   * door (CTR-009), so this is always a real label. */
  label: string;
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

  /**
   * A contract has been handed to somebody as its Owner (CTR-004) —
   * group 1, bell on and email immediate (NOT-002).
   *
   * The new Owner is the whole audience. Raise it **after** the row has
   * been updated: a confidential record reaches its Owner by them being
   * its Owner (CTR-022), so the wall would still be answering about the
   * previous one.
   */
  ownerAssigned(tx: NotifyingTransaction, event: OwnerAssignedEvent): Promise<void>;

  /**
   * A task on a contract has been given to somebody (CTR-017) — group 1,
   * bell on and email immediate (NOT-002).
   *
   * The assignee is the whole audience. The checklist takes any live
   * person as an assignee, and the wall behind the seam is what decides
   * whether they may be told.
   */
  taskAssigned(tx: NotifyingTransaction, event: TaskAssignedEvent): Promise<void>;

  /**
   * A comment has addressed somebody by name (CMT-007) — group 1, bell
   * on and email immediate (NOT-002).
   *
   * A mention is done *to* you: somebody has asked you a question by
   * name, which is the same kind of act as being handed a record. So it
   * interrupts, rather than riding the ambient default an ordinary
   * comment takes (NOT-002's M18/1 addendum).
   *
   * The audience is read from `comment_mentions` **here**, inside the
   * transaction that wrote it — a body is never parsed — and it is
   * narrowed by the comment's own tier, so a Legal Only mention reaches
   * nobody the tier excludes.
   */
  commentMentioned(tx: NotifyingTransaction, event: CommentMentionedEvent): Promise<void>;

  /**
   * A contract has moved to another status, and so to another stage
   * (CTR-001) — group 2, bell on and email opt-in (NOT-002).
   *
   * Raised by the record's own PATCH when a person moves it, and by the
   * executed-copy job when the integration advances it off the signature
   * stage (CTR-013). The second one has no actor, which is the whole
   * reason `actorId` is nullable.
   */
  statusChanged(tx: NotifyingTransaction, event: StatusChangedEvent): Promise<void>;

  /**
   * Somebody has said something on a record (DD-016) — group 2, bell on
   * and email opt-in (NOT-002).
   *
   * It carries the comment's tier, so a Legal Only comment never
   * produces a Contributor's bell item. The people the comment named
   * are left out here: they have already been told by
   * {@link commentMentioned}, which interrupts.
   */
  commentPosted(tx: NotifyingTransaction, event: CommentPostedEvent): Promise<void>;

  /**
   * A file has landed on a record (DOC-001) — group 2, bell on and email
   * opt-in (NOT-002).
   *
   * A confidential document's event goes only as far as the document
   * does (DD-014, DOC-008).
   */
  documentAdded(tx: NotifyingTransaction, event: DocumentEvent): Promise<void>;

  /**
   * A new round has been appended to a chain (DOC-001) — group 2, bell
   * on and email opt-in (NOT-002).
   *
   * Raised by the version upload when a person appends one, and by the
   * executed-copy job when the integration files the signed PDF back
   * onto the record (CTR-014). The second one has no actor.
   */
  documentVersionAdded(tx: NotifyingTransaction, event: DocumentVersionEvent): Promise<void>;

  /**
   * An envelope has ended — signed, declined, or voided (CTR-013) —
   * group 2, bell on and email opt-in (NOT-002).
   *
   * Almost always actorless: the provider reports the ending, and a
   * webhook is nobody. A void somebody took on the record carries the
   * person who took it, exactly as the activity entry beside it does.
   */
  envelopeEnded(tx: NotifyingTransaction, event: EnvelopeEndedEvent): Promise<void>;

  /**
   * A named date on a record is approaching (CTR-009) — group 3, bell on
   * and email in the morning digest (NOT-003).
   *
   * Raised only by the morning round, which is what decides that this
   * date is due at one of NOT-004's offsets and whose morning it is.
   *
   * Answers **how many rows it wrote**, which every group-3 method does
   * and no other method needs to. The round is the only caller and it is
   * a sweep: its log has to say what a round did, and "told nobody,
   * because the identity was already held" is the ordinary outcome of
   * every round after the first.
   */
  keyDateApproaching(tx: NotifyingTransaction, event: KeyDateReminderEvent): Promise<number>;

  /**
   * A record's notice deadline is approaching (CTR-006) — group 3, bell
   * on and email in the morning digest (NOT-003).
   *
   * The date is the expiry minus the notice period, **computed by the
   * round's own query and stored nowhere** (M16's doctrine). It arrives
   * here as a value like any other; nothing behind this seam knows it was
   * derived.
   */
  noticeDeadlineApproaching(tx: NotifyingTransaction, event: DateReminderEvent): Promise<number>;

  /**
   * A record's term is running out (CTR-006) — group 3, bell on and
   * email in the morning digest (NOT-003).
   */
  expiryApproaching(tx: NotifyingTransaction, event: DateReminderEvent): Promise<number>;
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
  /** Who caused it, or null where nobody did — an integration's own act
   * (CTR-013). Null excludes nobody, because there is no one person for
   * the exclusion to be about. */
  actorId: string | null,
  people: readonly PendingNotification[],
  /** How far this particular event may go, beyond the record's own wall.
   * The tier is the room something was said in (DD-016); the document
   * flag is the file it was said about (DOC-008). Both narrow; neither
   * widens. */
  narrowing: { tier?: CommentVisibility; confidentialDocument?: boolean } = {},
  /**
   * The dedup identity of a date reminder (NOT-003/004), on the events
   * that have one and absent on every other.
   *
   * Present, it does two things: it fills the two columns the partial
   * unique index is built on, and it makes the insert ignore a conflict
   * on that index. Those are the same decision — the identity is only
   * worth writing because a second round writing it again has to be a
   * no-op, and a date that has **moved** has a different identity and so
   * is not a conflict at all.
   */
  reminder?: { date: string; offsetDays: number },
): Promise<number> {
  // 1. The audience, minus the person who caused it. Deduplicated: one
  // event tells one person once, however many rows named them.
  const byUser = new Map<string, PendingNotification>();
  for (const person of people) {
    if (actorId !== null && person.userId === actorId) continue;
    if (!byUser.has(person.userId)) byUser.set(person.userId, person);
  }
  if (byUser.size === 0) return 0;

  // 2. The wall (DD-014). Applied here so no event can skip it.
  const reachable = await reachedBy(tx, contractId, [...byUser.keys()], narrowing);

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
        // Both halves or neither — the table's own check. A reminder
        // that carried one of them would be a row the unique index
        // cannot hold.
        ...(reminder
          ? { reminderDate: reminder.date, reminderOffsetDays: reminder.offsetDays }
          : {}),
      },
    ];
  });
  if (rows.length === 0) return 0;

  // 4. The rows, inside the caller's transaction.
  const insert = tx.insert(notifications).values(rows);
  const written = await (
    reminder
      ? insert.onConflictDoNothing({
          // The partial unique index, named by its own columns and its
          // own predicate so Postgres infers *that* index rather than
          // ignoring every conflict there could ever be. Two approval
          // requests for one person on one record are two real
          // notifications, and this must never quietly swallow the
          // second of them.
          target: [
            notifications.userId,
            notifications.eventType,
            notifications.entityId,
            notifications.reminderDate,
            notifications.reminderOffsetDays,
          ],
          where: sql`reminder_date is not null`,
        })
      : insert
  ).returning({ id: notifications.id, emailOwed: notifications.emailOwed });

  // 5. The wake-ups, collected for after the commit — only for the
  // rows whose email leaves at once. A digest row owes its email to the
  // scheduled round, which reads the rows rather than the queue.
  if (timing !== "immediate") return written.length;
  const wakeUps = wakeUpsOf(tx);
  for (const row of written) if (row.emailOwed) wakeUps.push(row.id);
  return written.length;
}

/**
 * The whole of NOT-002's group 2, for one event on one record.
 *
 * Every ambient event is the same three steps — find the record and the
 * people it is about, drop the ones this event has already told or must
 * not tell, hand the rest to {@link fanOut} with one payload — so they
 * are written once here and each event supplies a slug, a payload, and
 * how far it may go.
 *
 * The record's number and title are read here rather than at the call
 * site, and they are **added** to the payload rather than taken from it:
 * every group-2 item and email names the record the same way, and the
 * bell's arms read exactly these two keys.
 */
async function fanOutToRecord(
  tx: NotifyingTransaction,
  eventType: NotificationEventType,
  event: RecordEvent,
  payload: Record<string, unknown>,
  options: {
    /** People this event must not tell, beyond the actor. Only the
     * comment has any: the mention already interrupted them. */
    except?: readonly string[];
    narrowing?: { tier?: CommentVisibility; confidentialDocument?: boolean };
  } = {},
): Promise<void> {
  const audience = await contractRecordAudience(tx, event.contractId);
  // A record that is not there is about nobody. Unreachable from a route
  // that has just written to it, and the honest answer for a job whose
  // record went while it was running.
  if (!audience) return;
  const except = new Set(options.except ?? []);
  const recipients = audience.userIds.filter((userId) => !except.has(userId));
  await fanOut(
    tx,
    eventType,
    event.contractId,
    event.actorId,
    recipients.map((userId) => ({
      userId,
      payload: {
        ...payload,
        contractNumber: audience.contractNumber,
        contractTitle: audience.contractTitle,
        actorId: event.actorId,
        actorName: event.actorName,
      },
    })),
    options.narrowing ?? {},
  );
}

/**
 * The whole of NOT-002's group 3, for one date on one record.
 *
 * The three date events differ by a slug and by whether the date has a
 * name of its own, so they are one function here and three one-line
 * methods below — the shape group 2 already has, for its reason: what
 * they share is the decision, and what they differ by is a payload key.
 *
 * **Every one of them carries the dedup identity**, which is what makes
 * a second round a no-op and a **moved** date a new reminder rather than
 * a suppressed one. It is passed here rather than left to each method,
 * so a fourth kind of date added later cannot be the one that forgets.
 *
 * **The actor is nobody.** A date arriving is not somebody's act, so
 * nobody is excluded and the whole audience is told — including the
 * person who typed the date in.
 */
function dateReminder(
  tx: NotifyingTransaction,
  eventType: NotificationEventType,
  event: DateReminderEvent,
  extra: Record<string, unknown>,
): Promise<number> {
  return fanOut(
    tx,
    eventType,
    event.contractId,
    null,
    event.userIds.map((userId) => ({
      userId,
      payload: {
        ...extra,
        contractNumber: event.contractNumber,
        contractTitle: event.contractTitle,
        // Null rather than absent, so the bell's narrator and the mail's
        // template read the same two keys on every event in the catalog
        // and never have to ask whether this one has an actor.
        actorId: null,
        actorName: null,
        // Snapshotted with the row, as every payload is: the digest that
        // renders this row reads the date from here, so a date edited
        // after the reminder fired cannot rewrite what the reminder said.
        reminderDate: event.reminderDate,
        offsetDays: event.offsetDays,
      },
    })),
    {},
    { date: event.reminderDate, offsetDays: event.offsetDays },
  );
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

    async ownerAssigned(tx: NotifyingTransaction, event: OwnerAssignedEvent): Promise<void> {
      await fanOut(tx, "contract.owner_assigned", event.contractId, event.actorId, [
        {
          userId: event.ownerId,
          payload: {
            contractNumber: event.contractNumber,
            contractTitle: event.contractTitle,
            actorId: event.actorId,
            actorName: event.actorName,
          },
        },
      ]);
    },

    async taskAssigned(tx: NotifyingTransaction, event: TaskAssignedEvent): Promise<void> {
      await fanOut(tx, "contract.task_assigned", event.contractId, event.actorId, [
        {
          userId: event.assigneeId,
          payload: {
            contractNumber: event.contractNumber,
            contractTitle: event.contractTitle,
            actorId: event.actorId,
            actorName: event.actorName,
            taskId: event.taskId,
            taskTitle: event.taskTitle,
          },
        },
      ]);
    },

    async commentMentioned(tx: NotifyingTransaction, event: CommentMentionedEvent): Promise<void> {
      // Read from the table, in the transaction that wrote it. Who a
      // comment addresses is a list somebody chose from a typeahead
      // (CMT-007), and the body is never parsed for it — that is the
      // whole reason `comment_mentions` exists.
      const named = await tx
        .select({ userId: commentMentions.userId })
        .from(commentMentions)
        .where(eq(commentMentions.commentId, event.commentId));
      await fanOut(
        tx,
        "comment.mentioned",
        event.contractId,
        event.actorId,
        named.map((row) => ({
          userId: row.userId,
          // The comment's own words are not here, and never will be. A
          // mention is a prompt to go and read the thread, where the
          // tier is enforced and a redact can still reach the text
          // (CMT-006) — a payload could not be redacted out of.
          payload: {
            contractNumber: event.contractNumber,
            contractTitle: event.contractTitle,
            actorId: event.actorId,
            actorName: event.actorName,
            commentId: event.commentId,
          },
        })),
        { tier: event.visibility },
      );
    },

    async statusChanged(tx: NotifyingTransaction, event: StatusChangedEvent): Promise<void> {
      await fanOutToRecord(tx, "contract.status_changed", event, {
        from: event.from,
        to: event.to,
        fromStage: event.fromStage,
        toStage: event.toStage,
      });
    },

    async commentPosted(tx: NotifyingTransaction, event: CommentPostedEvent): Promise<void> {
      await fanOutToRecord(
        tx,
        "comment.posted",
        event,
        // The words are not here, for the mention's reason: the thread
        // is where DD-016 is enforced and where a redact can still reach
        // the text (CMT-006). The item is a prompt to go and read it.
        { commentId: event.commentId },
        {
          ...(event.mentioned && event.mentioned.length > 0 ? { except: event.mentioned } : {}),
          narrowing: { tier: event.visibility },
        },
      );
    },

    async documentAdded(tx: NotifyingTransaction, event: DocumentEvent): Promise<void> {
      await fanOutToRecord(
        tx,
        "document.added",
        event,
        { documentId: event.documentId, documentTitle: event.documentTitle },
        { narrowing: { confidentialDocument: event.isConfidential } },
      );
    },

    async documentVersionAdded(
      tx: NotifyingTransaction,
      event: DocumentVersionEvent,
    ): Promise<void> {
      await fanOutToRecord(
        tx,
        "document.version_added",
        event,
        {
          documentId: event.documentId,
          documentTitle: event.documentTitle,
          versionId: event.versionId,
          versionNumber: event.versionNumber,
        },
        { narrowing: { confidentialDocument: event.isConfidential } },
      );
    },

    async envelopeEnded(tx: NotifyingTransaction, event: EnvelopeEndedEvent): Promise<void> {
      await fanOutToRecord(tx, "envelope.ended", event, {
        envelopeId: event.envelopeId,
        status: event.status,
      });
    },

    keyDateApproaching(tx: NotifyingTransaction, event: KeyDateReminderEvent): Promise<number> {
      return dateReminder(tx, "date.key_date_approaching", event, {
        keyDateId: event.keyDateId,
        label: event.label,
      });
    },

    noticeDeadlineApproaching(tx: NotifyingTransaction, event: DateReminderEvent): Promise<number> {
      return dateReminder(tx, "date.notice_deadline_approaching", event, {});
    },

    expiryApproaching(tx: NotifyingTransaction, event: DateReminderEvent): Promise<number> {
      return dateReminder(tx, "date.expiry_approaching", event, {});
    },
  };
}
