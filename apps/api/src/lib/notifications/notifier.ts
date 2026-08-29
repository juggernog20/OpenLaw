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
 * **There is exactly one deliberate exception, and it is a receipt.**
 * `requestCreated` is addressed to the person who submitted the Request,
 * on purpose (INT-001): a receipt addressed to nobody is not a receipt.
 * It is written as one flag on one method rather than as a rule each
 * caller could reach for, so the exception stays countable.
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
  type NotificationEntityType,
  type NotificationEventType,
  type RequestStatus,
  type SeverityLevel,
  type Transaction,
} from "@openlaw/db";
import { boundedQueueAsk, type JobQueue } from "../../pipeline/jobs.js";
import {
  contractRecordAudience,
  CONTRACT_ENTITY,
  ENTITY_ENTITY,
  entityReachedBy,
  inboxAudience,
  matterReachedBy,
  matterRecordAudience,
  MATTER_ENTITY,
  reachedBy,
  requestAudience,
  requestConvertedInto,
  requestReachedBy,
  REQUEST_ENTITY,
} from "./audience.js";
import { emailTimingOf, EVENT_GROUP, requestSideOf } from "./catalog.js";
import { channelChoices } from "./preferences.js";

/** Where the seam's own lines go when a wake-up could not be sent. The
 * `document-versions` shape, so a Fastify logger and the pipeline's
 * console logger both fit. */
export interface NotifierLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

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

/** What one Matter Task assignment tells its assignee (MTR-005). */
export interface MatterTaskAssignedEvent {
  matterId: string;
  matterNumber: number;
  matterTitle: string;
  actorId: string;
  actorName: string;
  taskId: string;
  taskTitle: string;
  assigneeId: string;
}

/** One Entity obligation at a NOT-004 offset (ENT-006). */
export interface EntityObligationReminderEvent {
  entityId: string;
  entityLegalName: string;
  obligationId: string;
  label: string;
  reminderDate: string;
  offsetDays: number;
  userIds: readonly string[];
}

/** What every mention carries, whichever record it happened on. */
interface MentionedOnAnyRecord {
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

/** A mention on a contract thread — the record names itself through the
 * caller, as every group-1 event on a contract does: the route has just
 * read the row it is writing to. */
export interface ContractMentionedEvent extends MentionedOnAnyRecord {
  entityType: typeof CONTRACT_ENTITY;
  contractId: string;
  contractNumber: number;
  contractTitle: string;
}

export interface MatterMentionedEvent extends MentionedOnAnyRecord {
  entityType: typeof MATTER_ENTITY;
  matterId: string;
  matterNumber: number;
  matterTitle: string;
}

/**
 * A mention on a Request thread (M21/5).
 *
 * The Request names itself **behind** the seam rather than through the
 * caller, which is where every Request event's number and summary come
 * from (M20/8): the audience read holds the row already, so asking the
 * comments module for two columns would be the same query twice. That
 * read is also what makes the M18/4 rule enforceable here rather than at
 * a call site — it is the only thing that knows who the Requester is.
 */
export interface RequestMentionedEvent extends MentionedOnAnyRecord {
  entityType: typeof REQUEST_ENTITY;
  requestId: string;
}

/**
 * What one comment tells the people it addresses (CMT-007) — one arm per
 * record type, because a mention is done *to* you whatever record it
 * happens on (NOT-002's M18/1 addendum) and the two records name
 * themselves and reach people differently.
 */
export type CommentMentionedEvent =
  ContractMentionedEvent | MatterMentionedEvent | RequestMentionedEvent;

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
export interface ContractCommentPostedEvent extends RecordEvent {
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

export interface MatterCommentPostedEvent {
  entityType: typeof MATTER_ENTITY;
  matterId: string;
  actorId: string;
  actorName: string;
  commentId: string;
  visibility: CommentVisibility;
  mentioned?: readonly string[];
}

export type CommentPostedEvent = ContractCommentPostedEvent | MatterCommentPostedEvent;

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

/** One approaching Key date on a Matter (MTR-004). */
export interface MatterKeyDateReminderEvent {
  matterId: string;
  matterNumber: number;
  matterTitle: string;
  reminderDate: string;
  offsetDays: number;
  userIds: readonly string[];
  keyDateId: string;
  label: string;
}

/**
 * What every event on a Request carries (NOT-002 group 5).
 *
 * The Request names itself by its id alone, for group 2's reason: the
 * audience read behind the seam already holds the row, so R-### and the
 * summary come from there rather than from four call sites that would
 * each have to read them.
 *
 * **The audience is never on the wire either.** Every group-5 event is
 * addressed to the Requester and to nobody else (DD-013), and who that
 * is is a column on the Request. A caller that could name the audience
 * could name somebody else's.
 *
 * `actorId` is nullable, as group 2's is, and null means the same thing:
 * nobody did this, so nobody is excluded. No caller passes null today —
 * every group-5 event so far is somebody's act — and the shape is here
 * because M21's conversion routes may yet be run by a job.
 */
export interface RequestEvent {
  requestId: string;
  /** Who caused it, or null where nobody did. */
  actorId: string | null;
  actorName: string | null;
}

/** What a Request's move tells the person who asked (INT-007). */
export interface RequestStatusChangedEvent extends RequestEvent {
  /** The lifecycle either side of the move. A fixed enum, because code
   * branches on it (INT-001 as revised by INT-007) — unlike a contract's
   * status, which is a label an Administrator chose. */
  from: RequestStatus;
  to: RequestStatus;
}

/** What one reply on a Request's thread tells the person who asked
 * (INT-007, DD-016). */
export interface RequestRepliedEvent extends RequestEvent {
  commentId: string;
  /** The comment's DD-016 tier, carried so the fan-out can hold it: a
   * Requester is in Full Thread and nowhere else, so a Legal Only or
   * Working Team comment reaches them not at all. */
  visibility: CommentVisibility;
}

/**
 * What a Request's arrival tells the people who triage (INT-006).
 *
 * NOT-002's group 4, and the one event on a Request whose audience is
 * not the Requester. The Request still names itself by its id alone —
 * R-### and the summary come from the audience read, as every other
 * Request event's do — and what the route adds is the two facts a
 * triager weighs before opening anything: what kind of ask it is, and
 * how hot the person who asked says it is.
 *
 * Those two are passed rather than read behind the seam because the
 * submission route has just written them, which is group 1's rule: a
 * caller that already holds a fact is not made to read it again.
 */
export interface RequestSubmittedEvent extends RequestEvent {
  /** The request type's display name (INT-002) — what the form was
   * called, not its slug. */
  requestType: string;
  /** What the Requester claimed (INT-002). It maps 1:1 to priority at
   * conversion and it is never risk, which stays legal's. */
  urgency: SeverityLevel;
}

/** What a turned-down Request tells the person who asked (INT-006). */
export interface RequestDeclinedEvent extends RequestEvent {
  /** Why. INT-006 makes "no" arrive with a why, so the reason travels
   * with the event rather than being a line *about* a reason.
   *
   * It is the one piece of somebody's prose this seam carries into an
   * email, and it is carried on purpose: a decline reason is written to
   * be read by the requester, it is not a room anybody can be moved out
   * of, and there is no redact for it to outrun (CMT-006 is why a
   * comment's words stay on the thread). */
  reason: string;
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

  /** A Matter Task was handed to an existing person on that Matter. */
  matterTaskAssigned(tx: NotifyingTransaction, event: MatterTaskAssignedEvent): Promise<void>;

  /**
   * A comment has addressed somebody by name (CMT-007) — group 1, bell
   * on and email immediate (NOT-002).
   *
   * A mention is done *to* you: somebody has asked you a question by
   * name, which is the same kind of act as being handed a record. So it
   * interrupts, rather than riding the ambient default an ordinary
   * comment takes (NOT-002's M18/1 addendum) — and it interrupts
   * whatever record it happened on, which is why the event has one arm
   * per record type from M21/5 rather than being a contract's alone.
   *
   * The audience is read from `comment_mentions` **here**, inside the
   * transaction that wrote it — a body is never parsed — and it is
   * narrowed by the comment's own tier, so a Legal Only mention reaches
   * nobody the tier excludes. On a Request it is narrowed once more, by
   * the M18/4 rule: the Requester is told by the reply event in the one
   * room they hear, so the mention leaves them out of it.
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
   *
   * **On a record a Request converted into it raises the reply too**
   * (CMT-001, M21/11): a Full Thread comment reaches the person who
   * asked, on their portal bell and by email, as {@link requestReplied}
   * — because the thread moved onto the work and the promise moved with
   * it. The seam finds them through the conversion's back-link, so no
   * caller learns that a Request is behind the record, and the Requester
   * is dropped from the group-2 event at that tier so one comment tells
   * one person once.
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

  /** A reached, open Matter's named Key date is approaching (MTR-004). */
  matterKeyDateApproaching(
    tx: NotifyingTransaction,
    event: MatterKeyDateReminderEvent,
  ): Promise<number>;

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

  /** An open Entity obligation is approaching, addressed by ENT-006. */
  entityObligationApproaching(
    tx: NotifyingTransaction,
    event: EntityObligationReminderEvent,
  ): Promise<number>;

  /**
   * A Request has reached the Inbox (INT-006) — group 4, bell on and
   * email opt-in (NOT-002).
   *
   * **The audience is every live Member+**, read behind the seam like
   * every other audience: Member+ triages, and INT-006 declined the
   * routing rules, the rotation, and the claim mechanism that would each
   * have narrowed it. So there is no list on the wire and no way for a
   * caller to address somebody who does not triage.
   *
   * The actor is excluded like everywhere else, which is what makes a
   * Member+ who submits a Request of their own hear about it once — as
   * the Requester, on the portal — rather than twice.
   *
   * Raised by `POST /requests` beside {@link requestCreated}, in the
   * insert's own transaction. Two events for one act, because the staff
   * side and the requester side are two sentences to two audiences with
   * two defaults.
   */
  requestSubmitted(tx: NotifyingTransaction, event: RequestSubmittedEvent): Promise<void>;

  /**
   * A Request has been submitted (INT-001) — group 5, portal bell on and
   * email immediate (NOT-002).
   *
   * **This is the receipt, and it is the one event in the catalog whose
   * audience is the actor.** The exclusion rule is deliberately not
   * applied: the person told is the person who just pressed Submit,
   * because proof that an ask arrived is the whole content of the
   * message. Every other group-5 event excludes its actor like every
   * other event in the system.
   *
   * Raised by `POST /requests` inside the insert's own transaction, so a
   * submission that rolls back leaves no receipt for a Request nobody
   * has.
   */
  requestCreated(tx: NotifyingTransaction, event: RequestEvent): Promise<void>;

  /**
   * A Request has moved to another status (INT-007) — group 5, portal
   * bell on and email immediate (NOT-002).
   *
   * INT-003's promise in one method: a Requester never has to poll,
   * which is why the status-poke button was declined. Nothing fires it
   * in M20 — the Inbox's disposition routes are M21's — and the decline
   * has {@link requestDeclined} of its own, because a "no" that arrived
   * without its reason would be the one status move that says less than
   * the record does.
   */
  requestStatusChanged(tx: NotifyingTransaction, event: RequestStatusChangedEvent): Promise<void>;

  /**
   * Somebody has replied on a Request's thread (INT-007) — group 5,
   * portal bell on and email immediate (NOT-002).
   *
   * The audience is the Requester, so a staff reply reaches them and the
   * staff poster hears nothing — and a Requester's own reply reaches
   * nobody at all, because they are the actor. Both fall out of the
   * exclusion rule rather than being decided at the call site.
   *
   * It carries the comment's tier, so only a Full Thread reply reaches
   * the portal: a Legal Only or Working Team comment is staff talking
   * among themselves, and the wall behind the seam is what says so.
   *
   * Raised by the `request` arm of the thread while the Request is still
   * a comment target, and by {@link commentPosted} once a conversion has
   * moved the thread onto a record — the same event, at the same person,
   * from whichever record the conversation is now on.
   */
  requestReplied(tx: NotifyingTransaction, event: RequestRepliedEvent): Promise<void>;

  /**
   * A Request has been turned down, with a reason (INT-006) — group 5,
   * portal bell on and email immediate (NOT-002).
   *
   * Raised **instead of** {@link requestStatusChanged} on the move to
   * `declined`, never beside it: they are one act, and two messages
   * about it would be the same news at two volumes. Nothing fires it in
   * M20; M21's decline route is its one caller.
   */
  requestDeclined(tx: NotifyingTransaction, event: RequestDeclinedEvent): Promise<void>;
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

/** The record one event is about, named the way the `notifications` row
 * names it. Which arm answers the wall question is read from `type`,
 * so an entity added later is an arm rather than a branch at a route. */
type NotificationEntity =
  | { type: typeof MATTER_ENTITY; id: string }
  | { type: typeof CONTRACT_ENTITY; id: string }
  | { type: typeof ENTITY_ENTITY; id: string }
  | { type: typeof REQUEST_ENTITY; id: string };

/** Everything one event may ask of the fan-out beyond its people. */
interface FanOutOptions {
  /**
   * How far this particular event may go, beyond the record's own wall.
   * The tier is the room something was said in (DD-016); the document
   * flag is the file it was said about (DOC-008). Both narrow; neither
   * widens.
   */
  narrowing?: { tier?: CommentVisibility; confidentialDocument?: boolean };
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
  reminder?: { date: string; offsetDays: number };
  /**
   * NOT-002's one exception: address this event to the person who
   * caused it.
   *
   * The receipt, and nothing else (INT-001). It is a named option rather
   * than a `null` actor because those are different facts — an actorless
   * event excludes nobody because there is nobody to exclude, and this
   * one excludes nobody on purpose while still naming who acted.
   */
  tellTheActor?: boolean;
}

/**
 * The whole fan-out, for one event on one record: audience, wall,
 * preferences, rows, wake-ups.
 *
 * Every event goes through this, which is what makes the five steps a
 * property of the seam rather than of each call site. An event added
 * later supplies its people and its payload and inherits all of it.
 */
async function fanOut(
  tx: NotifyingTransaction,
  eventType: NotificationEventType,
  entity: NotificationEntity,
  /** Who caused it, or null where nobody did — an integration's own act
   * (CTR-013). Null excludes nobody, because there is no one person for
   * the exclusion to be about. */
  actorId: string | null,
  people: readonly PendingNotification[],
  options: FanOutOptions = {},
): Promise<number> {
  const { narrowing = {}, reminder } = options;
  // 1. The audience, minus the person who caused it. Deduplicated: one
  // event tells one person once, however many rows named them.
  const byUser = new Map<string, PendingNotification>();
  for (const person of people) {
    if (actorId !== null && person.userId === actorId && !options.tellTheActor) continue;
    if (!byUser.has(person.userId)) byUser.set(person.userId, person);
  }
  if (byUser.size === 0) return 0;

  // 2. The wall (DD-014, and the Request's own two facts). Applied here
  // so no event can skip it, whichever record it is about.
  const reachable =
    entity.type === CONTRACT_ENTITY
      ? await reachedBy(tx, entity.id, [...byUser.keys()], narrowing)
      : entity.type === MATTER_ENTITY
        ? await matterReachedBy(tx, entity.id, [...byUser.keys()], narrowing)
        : entity.type === ENTITY_ENTITY
          ? await entityReachedBy(tx, entity.id, [...byUser.keys()])
          : await requestReachedBy(tx, entity.id, [...byUser.keys()], {
              ...narrowing,
              // Which standing this event addressed (M21/4, M21/5). It is
              // read from the catalog rather than passed by the method, so
              // an event added to a group later inherits that group's side
              // and cannot be the one that forgets to ask for it.
              side: requestSideOf(eventType),
            });

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
        entityType: entity.type satisfies NotificationEntityType,
        entityId: entity.id,
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
            notifications.entityType,
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
 * One Matter comment can address two audiences after a conversion: the
 * Matter roster in group 2 and the originating Requester in group 5.
 * Full Thread reserves the Requester for the reply event so a staff
 * Requester on the roster is told once; mentions remain louder than both.
 * The ordinary actor exclusion stays inside each fan-out.
 */
async function fanOutToMatter(
  tx: NotifyingTransaction,
  event: MatterCommentPostedEvent,
): Promise<void> {
  const audience = await matterRecordAudience(tx, event.matterId);
  if (!audience) return;
  const origin = await requestConvertedInto(tx, { module: "matter", id: event.matterId });
  const named = new Set(event.mentioned ?? []);
  const except = new Set([
    ...named,
    ...(origin !== null && event.visibility === "full_thread" ? [origin.requesterId] : []),
  ]);
  await fanOut(
    tx,
    "comment.posted",
    { type: MATTER_ENTITY, id: event.matterId },
    event.actorId,
    audience.userIds
      .filter((userId) => !except.has(userId))
      .map((userId) => ({
        userId,
        payload: {
          matterNumber: audience.matterNumber,
          matterTitle: audience.matterTitle,
          actorId: event.actorId,
          actorName: event.actorName,
          commentId: event.commentId,
        },
      })),
    { narrowing: { tier: event.visibility } },
  );
  if (origin === null || named.has(origin.requesterId)) return;
  await fanOutToRequest(
    tx,
    "request.replied",
    { requestId: origin.requestId, actorId: event.actorId, actorName: event.actorName },
    { commentId: event.commentId },
    { narrowing: { tier: event.visibility } },
  );
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
    { type: CONTRACT_ENTITY, id: event.contractId },
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
    { ...(options.narrowing ? { narrowing: options.narrowing } : {}) },
  );
}

/**
 * The whole of NOT-002's group 5, for one event on one Request.
 *
 * Group 2's shape, said for the portal audience, and for its reasons:
 * every group-5 event resolves the same audience out of the same row,
 * and what they differ by is a slug and a payload key. The Request's
 * number and summary are **added** to the payload rather than taken from
 * it, because every group-5 item and email names the Request the same
 * way.
 *
 * **The audience is one person and the seam is what says who.** It is
 * the Requester (DD-013), read here from the row rather than named by a
 * caller — a caller that could name the audience could name somebody
 * else's Requester.
 */
async function fanOutToRequest(
  tx: NotifyingTransaction,
  eventType: NotificationEventType,
  event: RequestEvent,
  payload: Record<string, unknown>,
  options: Pick<FanOutOptions, "narrowing" | "tellTheActor"> = {},
): Promise<void> {
  const audience = await requestAudience(tx, event.requestId);
  // A Request that is not there is about nobody — the contract read's
  // answer above, for its reason.
  if (!audience) return;
  await fanOut(
    tx,
    eventType,
    { type: REQUEST_ENTITY, id: event.requestId },
    event.actorId,
    [
      {
        userId: audience.requesterId,
        payload: {
          ...payload,
          requestNumber: audience.requestNumber,
          requestSummary: audience.summary,
          actorId: event.actorId,
          actorName: event.actorName,
        },
      },
    ],
    options,
  );
}

/**
 * The whole of NOT-002's group 4, for one Request arriving.
 *
 * Group 5's shape, said for the other side of the same record, and the
 * one place the two differ is the audience: this reads every live
 * Member+ (INT-006) where {@link fanOutToRequest} reads the one
 * Requester (DD-013). Both read it behind the seam, and for the same
 * reason — a caller that could name the audience could name the wrong
 * people.
 *
 * The Request's number and summary come from that same read, and are
 * **added** to the payload rather than taken from it, so every item and
 * every email about a Request names it the same way whichever bell drew
 * it.
 */
async function fanOutToInbox(
  tx: NotifyingTransaction,
  event: RequestSubmittedEvent,
): Promise<void> {
  const audience = await requestAudience(tx, event.requestId);
  // A Request that is not there is about nobody — the contract read's
  // answer, for its reason.
  if (!audience) return;
  const triagers = await inboxAudience(tx);
  await fanOut(
    tx,
    "request.submitted",
    { type: REQUEST_ENTITY, id: event.requestId },
    event.actorId,
    triagers.map((userId) => ({
      userId,
      payload: {
        requestType: event.requestType,
        urgency: event.urgency,
        requestNumber: audience.requestNumber,
        requestSummary: audience.summary,
        actorId: event.actorId,
        actorName: event.actorName,
      },
    })),
  );
}

/**
 * The whole of NOT-002's group 1, for one mention on one Request (M21/5).
 *
 * Group 4's shape, said for the people one comment named rather than for
 * the whole queue, and for its reason: the Request names itself out of
 * the audience read, so every item and every email about a Request names
 * it the same way whichever bell drew it.
 *
 * **The audience is the staff side, and the seam is what says so.** The
 * side rides the event's group (`assigned_to_you` is the Inbox's), so the
 * wall step re-asks that each person named is still Member+ — which is
 * what keeps a Business User Requester out of a group-1 row without any
 * call site having to remember them.
 *
 * **The Requester is dropped at Full Thread** (NOT-002's M18/4 rule).
 * `requestReplied` already reaches them in that room, and one comment
 * tells one person once. It is the tier's rule rather than the person's,
 * because the reason is the tier's: no reply event reaches Legal Only or
 * Working Team, so a Member+ who raised the Request themselves is told by
 * the mention there and by nothing else. Only that one person can stand
 * on both sides — the Requester's own rooms are Full Thread and no other
 * (DD-016), so a Business User can only ever be named in the room this
 * drops them from.
 */
async function mentionedOnRequest(
  tx: NotifyingTransaction,
  event: RequestMentionedEvent,
  named: readonly { userId: string }[],
  who: { actorId: string; actorName: string },
): Promise<void> {
  const audience = await requestAudience(tx, event.requestId);
  // A Request that is not there is about nobody — the contract read's
  // answer, for its reason.
  if (!audience) return;
  const told =
    event.visibility === "full_thread"
      ? named.filter((row) => row.userId !== audience.requesterId)
      : named;
  await fanOut(
    tx,
    "comment.mentioned",
    { type: REQUEST_ENTITY, id: event.requestId },
    event.actorId,
    told.map((row) => ({
      userId: row.userId,
      payload: {
        requestNumber: audience.requestNumber,
        requestSummary: audience.summary,
        ...who,
        commentId: event.commentId,
      },
    })),
    { narrowing: { tier: event.visibility } },
  );
}

/**
 * One comment on one record, and everything it tells anybody (M21/11).
 *
 * **Two events, because the record can have two audiences.** The record's
 * own people hear NOT-002's group 2, which is what a comment on a
 * contract has always raised. And where a Request converted into this
 * record, the person who asked hears group 5 — the reply promise,
 * following the thread onto the work exactly as CMT-001 said the thread
 * would follow it.
 *
 * **The back-link is read here rather than at any call site.** No comment
 * route and no audience arm knows a Request is behind this contract: the
 * seam finds it, so a reply typed on the contract's applet, on the staff
 * request detail, and on the portal all reach the same person the same
 * way. That is the M20/8 shape — a caller names what happened, and who
 * hears it is the seam's.
 *
 * **The tier decides both**, and neither decides it here. The reply is
 * raised at every tier and the fan-out's own wall drops it below Full
 * Thread, because the Requester is in one room (DD-016). And the actor
 * exclusion is the fan-out's too, so a Requester replying on their own
 * converted Request tells nobody in group 5 and tells the record's people
 * in group 2, which is what a reply from them is.
 *
 * **One comment tells one person once** (NOT-002's M18/4 rule, applied
 * where the M21/5 addendum applied it to the mention). At Full Thread the
 * Requester is dropped from the record's group-2 event, because the reply
 * is about to reach them and louder. Below Full Thread no reply can reach
 * them, so a Requester who is also on the record's team keeps the group-2
 * item that is their only news of it. The rule is the tier's, not the
 * person's.
 *
 * **And a comment that names the Requester by name drops the reply
 * instead.** On a record the mention is the loudest of the three events
 * and the other two step aside, which is the order the contract thread
 * has always had. Only a Member+ who raised the Request can be in that
 * position — a contract offers no Business User as a mention candidate
 * (CMT-007) — and the arithmetic is the same either way: one comment,
 * one row.
 */
async function commentOnRecord(
  tx: NotifyingTransaction,
  event: ContractCommentPostedEvent,
): Promise<void> {
  const origin = await requestConvertedInto(tx, { module: "contract", id: event.contractId });
  const named = new Set(event.mentioned ?? []);
  await fanOutToRecord(
    tx,
    "comment.posted",
    event,
    // The words are not here, for the mention's reason: the thread
    // is where DD-016 is enforced and where a redact can still reach
    // the text (CMT-006). The item is a prompt to go and read it.
    { commentId: event.commentId },
    {
      except: [
        // The people this comment named: they have just been told,
        // louder, by the mention.
        ...named,
        ...(origin !== null && event.visibility === "full_thread" ? [origin.requesterId] : []),
      ],
      narrowing: { tier: event.visibility },
    },
  );
  if (origin === null) return;
  // And a Requester the comment named by name has been told louder still
  // — on this record, by the mention. Only one person can ever be in
  // this branch: a Member+ who raised the Request and can reach the
  // record it became, because nobody else is offered as a mention
  // candidate on a contract (CMT-007) and the composer refuses a name it
  // was not offered. The mention wins here rather than the reply,
  // because on a record the interrupting event is the one that carries
  // the news and the ambient ones step aside — the same order the
  // record's own group-2 event takes one call above.
  if (named.has(origin.requesterId)) return;
  await fanOutToRequest(
    tx,
    "request.replied",
    { requestId: origin.requestId, actorId: event.actorId, actorName: event.actorName },
    { commentId: event.commentId },
    { narrowing: { tier: event.visibility } },
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
    { type: CONTRACT_ENTITY, id: event.contractId },
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
    { reminder: { date: event.reminderDate, offsetDays: event.offsetDays } },
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
        { type: CONTRACT_ENTITY, id: event.contractId },
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
      await fanOut(
        tx,
        "contract.owner_assigned",
        { type: CONTRACT_ENTITY, id: event.contractId },
        event.actorId,
        [
          {
            userId: event.ownerId,
            payload: {
              contractNumber: event.contractNumber,
              contractTitle: event.contractTitle,
              actorId: event.actorId,
              actorName: event.actorName,
            },
          },
        ],
      );
    },

    async taskAssigned(tx: NotifyingTransaction, event: TaskAssignedEvent): Promise<void> {
      await fanOut(
        tx,
        "contract.task_assigned",
        { type: CONTRACT_ENTITY, id: event.contractId },
        event.actorId,
        [
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
        ],
      );
    },

    async matterTaskAssigned(
      tx: NotifyingTransaction,
      event: MatterTaskAssignedEvent,
    ): Promise<void> {
      await fanOut(
        tx,
        "matter.task_assigned",
        { type: MATTER_ENTITY, id: event.matterId },
        event.actorId,
        [
          {
            userId: event.assigneeId,
            payload: {
              matterNumber: event.matterNumber,
              matterTitle: event.matterTitle,
              actorId: event.actorId,
              actorName: event.actorName,
              taskId: event.taskId,
              taskTitle: event.taskTitle,
            },
          },
        ],
      );
    },

    async commentMentioned(tx: NotifyingTransaction, event: CommentMentionedEvent): Promise<void> {
      // Read from the table, in the transaction that wrote it. Who a
      // comment addresses is a list somebody chose from a typeahead
      // (CMT-007), and the body is never parsed for it — that is the
      // whole reason `comment_mentions` exists. It is read once, above
      // the arms, because it is the same question on both records.
      const named = await tx
        .select({ userId: commentMentions.userId })
        .from(commentMentions)
        .where(eq(commentMentions.commentId, event.commentId));
      // The comment's own words are never in a payload, and never will
      // be. A mention is a prompt to go and read the thread, where the
      // tier is enforced and a redact can still reach the text (CMT-006)
      // — a payload could not be redacted out of.
      const who = { actorId: event.actorId, actorName: event.actorName };
      if (event.entityType === REQUEST_ENTITY) {
        await mentionedOnRequest(tx, event, named, who);
        return;
      }
      if (event.entityType === MATTER_ENTITY) {
        await fanOut(
          tx,
          "comment.mentioned",
          { type: MATTER_ENTITY, id: event.matterId },
          event.actorId,
          named.map((row) => ({
            userId: row.userId,
            payload: {
              matterNumber: event.matterNumber,
              matterTitle: event.matterTitle,
              ...who,
              commentId: event.commentId,
            },
          })),
          { narrowing: { tier: event.visibility } },
        );
        return;
      }
      await fanOut(
        tx,
        "comment.mentioned",
        { type: CONTRACT_ENTITY, id: event.contractId },
        event.actorId,
        named.map((row) => ({
          userId: row.userId,
          payload: {
            contractNumber: event.contractNumber,
            contractTitle: event.contractTitle,
            ...who,
            commentId: event.commentId,
          },
        })),
        { narrowing: { tier: event.visibility } },
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
      if ("entityType" in event) await fanOutToMatter(tx, event);
      else await commentOnRecord(tx, event);
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

    matterKeyDateApproaching(
      tx: NotifyingTransaction,
      event: MatterKeyDateReminderEvent,
    ): Promise<number> {
      return fanOut(
        tx,
        "date.key_date_approaching",
        { type: MATTER_ENTITY, id: event.matterId },
        null,
        event.userIds.map((userId) => ({
          userId,
          payload: {
            keyDateId: event.keyDateId,
            label: event.label,
            matterNumber: event.matterNumber,
            matterTitle: event.matterTitle,
            actorId: null,
            actorName: null,
            reminderDate: event.reminderDate,
            offsetDays: event.offsetDays,
          },
        })),
        { reminder: { date: event.reminderDate, offsetDays: event.offsetDays } },
      );
    },

    noticeDeadlineApproaching(tx: NotifyingTransaction, event: DateReminderEvent): Promise<number> {
      return dateReminder(tx, "date.notice_deadline_approaching", event, {});
    },

    expiryApproaching(tx: NotifyingTransaction, event: DateReminderEvent): Promise<number> {
      return dateReminder(tx, "date.expiry_approaching", event, {});
    },

    entityObligationApproaching(
      tx: NotifyingTransaction,
      event: EntityObligationReminderEvent,
    ): Promise<number> {
      return fanOut(
        tx,
        "date.obligation_approaching",
        { type: ENTITY_ENTITY, id: event.entityId },
        null,
        event.userIds.map((userId) => ({
          userId,
          payload: {
            entityLegalName: event.entityLegalName,
            obligationId: event.obligationId,
            label: event.label,
            actorId: null,
            actorName: null,
            reminderDate: event.reminderDate,
            offsetDays: event.offsetDays,
          },
        })),
        { reminder: { date: event.reminderDate, offsetDays: event.offsetDays } },
      );
    },

    async requestSubmitted(tx: NotifyingTransaction, event: RequestSubmittedEvent): Promise<void> {
      await fanOutToInbox(tx, event);
    },

    async requestCreated(tx: NotifyingTransaction, event: RequestEvent): Promise<void> {
      // The exception, in one word. Everything else about this event is
      // every other event's: the audience is read behind the seam, the
      // Request's own two facts still gate it, and the person's
      // preferences still decide the channels.
      await fanOutToRequest(tx, "request.created", event, {}, { tellTheActor: true });
    },

    async requestStatusChanged(
      tx: NotifyingTransaction,
      event: RequestStatusChangedEvent,
    ): Promise<void> {
      await fanOutToRequest(tx, "request.status_changed", event, {
        from: event.from,
        to: event.to,
      });
    },

    async requestReplied(tx: NotifyingTransaction, event: RequestRepliedEvent): Promise<void> {
      await fanOutToRequest(
        tx,
        "request.replied",
        event,
        // The words are not here, for the contract thread's reason: the
        // portal is where DD-016 is enforced and where a redact can
        // still reach the text (CMT-006). The item is a prompt to go and
        // read the conversation.
        { commentId: event.commentId },
        { narrowing: { tier: event.visibility } },
      );
    },

    async requestDeclined(tx: NotifyingTransaction, event: RequestDeclinedEvent): Promise<void> {
      await fanOutToRequest(tx, "request.declined", event, { reason: event.reason });
    },
  };
}
