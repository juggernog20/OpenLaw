// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who hears one record's thread — **the comments module's one gate**, and
 * one arm behind it per entity type (CMT-001).
 *
 * The thread is one machinery across matters, contracts, documents, and
 * requests, but "who is in the room" is not one rule. A contract answers
 * it out of `contract_team`, the CTR-021 reach rule, and the DD-014 wall;
 * a request answers it out of its Requester and Member+ staff, with no
 * team table and no wall. Those are different sentences about different
 * tables, and the routes must not have to know which one was read.
 *
 * So resolution is an arm, and everything downstream of it takes the
 * resolved {@link CommentAudience}: the DD-016 tier filter, the unread
 * count, the `comment_last_read` watermark, and the mention table read.
 * Each of them keys on `entityType` and `entityId` off the answer — never
 * on a contract id, and never on the id the client sent — so adding an
 * entity type is adding an arm here, not editing a route there.
 *
 * **The wall and the tier vocabulary stay inside the seam.** A caller
 * gets a list of tiers it is in the room for and nothing else: no flag to
 * apply, no team row to check, and no second copy of DD-014 to keep in
 * step. The contract arm delegates both to `lib/contract-access.ts`,
 * where the contract's own reach rule already lives, so the thread and
 * the record answer out of one rule rather than two that could drift.
 *
 * An arm carries four things and no more:
 *
 * - `readerRoles` — the roles that reach any thread of this type at all.
 *   It is the route guard's list, and it is per-arm because the roles are
 *   not the same: a contract thread is staff-only (CTR-021), and a
 *   request thread admits the Business User who raised it (DD-013).
 * - `resolve` — the audience rule: this viewer's standing on this record,
 *   or `null` where there is nothing here for them.
 * - `mentionCandidates` — who a comment on this record can address
 *   (CMT-007), each with the tiers they hear. It is per-arm because the
 *   addressees come from the audience rule: a contract's roster is its
 *   team and the staff roles, and a request's is its Requester and
 *   Member+ staff.
 * - `notifyPosted` — what a new comment on this type of record raises
 *   through the Notifier seam (NOT-002). It is here rather than at the
 *   route because the events differ by type: a contract comment is group
 *   1 and 2 on the record's roster, and a request comment is group 1 at
 *   the staff it named and group 5 at its Requester.
 *
 * A record a viewer cannot reach and a record that is not there answer
 * the same way — `null`, and {@link NO_RECORD} above it. A refusal that
 * told them apart would say the record is there.
 */

import {
  and,
  asc,
  contracts,
  eq,
  inArray,
  isNull,
  or,
  requests,
  sql,
  users,
  COMMENT_VISIBILITIES,
  USER_ROLES,
  type CommentVisibility,
  type Executor,
  type UserRole,
} from "@openlaw/db";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import {
  contractAudience,
  contractMentionCandidates,
  type MentionCandidate,
} from "../../lib/contract-access.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import { httpError } from "../../lib/problem.js";

/**
 * What a comment can hang off, as the API accepts it.
 *
 * The `comments` table's CHECK admits `matter | contract | document |
 * request`, matching the `activity_log` precedent. This list is the
 * narrower one: the types that have an arm below. It grows by one entry
 * and one arm together, and the route schemas are built from it, so a
 * type with no arm cannot be asked for.
 */
export const COMMENT_ENTITY_TYPES = ["contract", "request"] as const;

export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];

/** The reference a thread is keyed by — one record, named by type and id
 * rather than by a contract's CTR-003 number, because the panel that
 * reads it is entity-generic. */
export interface EntityRef {
  entityType: CommentEntityType;
  entityId: string;
}

/** One viewer's standing on one record whose thread they reach. */
export interface CommentAudience {
  /** Which arm answered, and so which record the ids below belong to. */
  entityType: CommentEntityType;
  /** The record's own id, re-read by the arm rather than trusted from
   * the client. Every write and every filter downstream keys on this
   * one, never on the id that arrived on the request. */
  entityId: string;
  /** The DD-016 tiers this viewer hears on it; never empty. An empty
   * answer is not a standing, it is `null` — a record with no
   * conversation for them, which is what it is. */
  tiers: readonly CommentVisibility[];
}

/** A comment that has just been written, as the notification arm needs
 * it. The rows are already in the transaction: `comment_mentions` is
 * written, so the seam behind {@link Notifier} reads the addressees from
 * the table rather than from a body. */
export interface PostedComment {
  audience: CommentAudience;
  actorId: string;
  actorName: string;
  commentId: string;
  /** The comment's own tier. Every event it raises rides it, so a Legal
   * Only comment never reaches somebody outside that room. */
  visibility: CommentVisibility;
  /** Who the comment named, deduplicated. Empty for a comment that names
   * nobody. */
  mentioned: readonly string[];
}

/** One entity type's answer to the four questions the thread asks of a
 * record. Nothing else about the record belongs here: the routes read the
 * `comments` rows themselves, and they are the same rows whichever arm
 * resolved the audience. */
interface CommentEntityArm {
  /** The roles that reach a thread of this type at all — the route
   * guard's list for this arm. */
  readonly readerRoles: readonly UserRole[];

  /**
   * This viewer's standing on this record, or `null` where there is
   * nothing here for them: no such record, or one they do not reach, or
   * one they reach and hear no tier on.
   *
   * The id comes back re-read from the arm's own table, so a caller that
   * writes with it cannot write against an id the client made up.
   */
  resolve(
    db: Executor,
    user: AuthenticatedUser,
    entityId: string,
  ): Promise<Omit<CommentAudience, "entityType"> | null>;

  /**
   * Everyone a comment on this record can address (CMT-007), each with
   * the tiers they would hear it at — the typeahead's list, and the set
   * a posted mention is checked against. One rule answers both, so the
   * list cannot offer somebody a post would then refuse.
   *
   * `only` narrows it to a handful of ids: a post that names three
   * people wants three rows, not the directory.
   */
  mentionCandidates(
    db: Executor,
    audience: CommentAudience,
    only?: readonly string[],
  ): Promise<MentionCandidate[]>;

  /** What a new comment on this type of record raises (NOT-002). Called
   * inside the transaction that wrote the comment and its mentions. */
  notifyPosted(tx: NotifyingTransaction, notifier: Notifier, posted: PostedComment): Promise<void>;
}

/**
 * The contract arm — the thread as M9 shipped it.
 *
 * Reach is CTR-021 narrowed by DD-014, and the tiers are DD-016's. Both
 * are `contract-access.ts`'s, asked here rather than restated: the record
 * read, the activity feed, and this thread all answer out of that one
 * rule, so a contract that 404s on its own route cannot have a readable
 * conversation.
 */
const contractArm: CommentEntityArm = {
  /**
   * The contract read floor (CTR-021), which is the comment floor too: a
   * Contributor takes part in the conversation on a contract they are
   * on. The role alone opens no thread — `resolve` narrows it to the
   * records they hold a `contract_team` row on. Business Users are
   * refused on every contract surface.
   */
  readerRoles: ["administrator", "legal_team_member", "contributor"],

  async resolve(db, user, entityId) {
    const audience = await contractAudience(db, user, entityId);
    if (!audience) return null;
    return { entityId: audience.contractId, tiers: audience.tiers };
  },

  async mentionCandidates(db, audience, only) {
    return await contractMentionCandidates(db, audience.entityId, only);
  },

  async notifyPosted(tx, notifier, posted) {
    // Being named in a comment is done *to* you, so it is NOT-002's
    // group 1: the bell rings and the email leaves at once. The arm says
    // which comment it was and at which tier; the seam reads who it
    // addressed out of `comment_mentions` and holds both the wall and the
    // tier.
    if (posted.mentioned.length > 0) {
      // The record's own address (CTR-003) and its title, for the item
      // and the email to name it by. Read here rather than carried on the
      // audience answer: the audience is entity-generic (CMT-001), and
      // only the notification needs a contract's columns.
      const [record] = await tx
        .select({ number: contracts.number, title: contracts.title })
        .from(contracts)
        .where(eq(contracts.id, posted.audience.entityId))
        .limit(1);
      // The row is there: the audience read that authorized this comment
      // ran in this same transaction, on this same contract. The guard is
      // the compiler's, not a case to plan for — a missing row is not an
      // acceptable way to drop somebody's mention.
      if (record) {
        await notifier.commentMentioned(tx, {
          entityType: "contract",
          contractId: posted.audience.entityId,
          contractNumber: record.number,
          contractTitle: record.title,
          actorId: posted.actorId,
          actorName: posted.actorName,
          commentId: posted.commentId,
          visibility: posted.visibility,
        });
      }
    }
    // And the comment itself is ambient movement on the record, so it is
    // NOT-002's group 2 as well: the Owner and the team get a bell item,
    // and no email is owed under the default. It carries the tier, so a
    // Legal Only comment never reaches a Contributor — the same narrowing
    // the mention takes, on the same predicate.
    //
    // The people this comment named are left out: they have just been
    // told, louder. One comment tells one person once.
    await notifier.commentPosted(tx, {
      contractId: posted.audience.entityId,
      actorId: posted.actorId,
      actorName: posted.actorName,
      commentId: posted.commentId,
      visibility: posted.visibility,
      mentioned: [...posted.mentioned],
    });
  },
};

/** Member+ (CONTEXT.md), and every tier they hear. On a Request that is
 * the whole of the staff rule: there is no team table to consult and no
 * wall to apply (DD-014 is a contract's, and INT-002 gives a Request
 * neither), so a Member+ is in every room on every Request. */
const MEMBER_PLUS: readonly UserRole[] = ["administrator", "legal_team_member"];

/** Every tier, for the people who hear every tier. */
const ALL_TIERS: readonly CommentVisibility[] = COMMENT_VISIBILITIES;

/** The Requester's one room (DD-016). A Business User is in Full Thread
 * and nowhere else, so their composer has nothing to choose between —
 * which is why the portal draws no tier picker at all. */
const REQUESTER_TIERS: readonly CommentVisibility[] = ["full_thread"];

/**
 * The request arm — the portal's live conversation (CMT-001, INT-007).
 *
 * The audience is two people-shaped facts and nothing else: the
 * Requester, and Member+ staff. There is no team table on a Request and
 * no confidentiality wall — DD-014 is a contract's flag, and INT-002
 * gives a Request no equivalent — so this arm reads one row and answers
 * from the reader's role.
 *
 * **The thread is live from submission.** INT-007 keeps the clarifying
 * back-and-forth open while a Request is `new`, and nothing here is
 * keyed to a status: a converted, resolved, or declined Request still
 * answers, exactly as its detail read does (DD-018). An archived Request
 * does not, by the house rule that NULL means live.
 *
 * **No Contributor arm.** A Contributor reaches this thread only as the
 * person who raised the Request, and then as a Requester rather than as
 * staff — the role is a fact about the contract surfaces (CTR-021), and
 * a Request has no team for it to mean anything on.
 *
 * Re-parenting at conversion (CMT-001) is M21's. Nothing here reads or
 * writes the link a conversion leaves behind.
 */
const requestArm: CommentEntityArm = {
  /**
   * Every role, because every role can raise a Request: the portal's
   * gate is a session and nothing else (the INT-001 M20/2 addendum), so
   * a Contributor and a Member+ submit through the same door a Business
   * User does. The role opens no thread on its own — `resolve` is what
   * narrows it to the one Request they raised, or to staff standing.
   */
  readerRoles: USER_ROLES,

  async resolve(db, user, entityId) {
    const [record] = await db
      .select({ id: requests.id, requesterId: requests.requesterId })
      .from(requests)
      .where(and(eq(requests.id, entityId), isNull(requests.archivedAt)))
      .limit(1);
    if (!record) return null;
    // Staff first, so a Member+ who raised the Request themselves is
    // answered as staff: they are in every room on every Request, and
    // being the Requester too does not take a room away from them.
    if (MEMBER_PLUS.includes(user.role)) return { entityId: record.id, tiers: ALL_TIERS };
    if (record.requesterId === user.id) return { entityId: record.id, tiers: REQUESTER_TIERS };
    return null;
  },

  async mentionCandidates(db, audience, only) {
    // The audience rule read over people instead of over rows, exactly
    // as the contract arm's is: somebody belongs here when this Request
    // reaches them and they hear at least one tier on it. So it is the
    // Requester plus every live Member+, and nobody else — a Contributor
    // who did not raise it is not offered, because a name no tier
    // reaches is the trap the promotion confirmation exists to avoid
    // (CMT-007).
    const [record] = await db
      .select({ requesterId: requests.requesterId })
      .from(requests)
      .where(eq(requests.id, audience.entityId))
      .limit(1);
    if (!record) return [];

    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          // Archived people are out: they have left, and addressing a
          // question to them reaches nobody (SET-005).
          isNull(users.archivedAt),
          // The audience as a `where` clause, so the read is the two
          // people-shaped facts rather than the directory. The portal is
          // open to every Business User, so an instance can hold far
          // more people than any one Request reaches, and the rows this
          // leaves out are rows the answer below would discard anyway.
          or(inArray(users.role, [...MEMBER_PLUS]), eq(users.id, record.requesterId)),
          only ? inArray(users.id, [...only]) : undefined,
        ),
      )
      // Alphabetical, as every people picker in the product is ordered.
      .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
    // Which tiers each of them hears — `resolve`'s rule said over people
    // instead of over one viewer, and the same rule the clause above
    // narrowed by. So the empty arm never fires; it is here because
    // "hears nothing means not offered" is the rule, and a rule stated
    // once is one the next role inherits.
    return rows.flatMap((row) => {
      const tiers = MEMBER_PLUS.includes(row.role)
        ? ALL_TIERS
        : row.id === record.requesterId
          ? REQUESTER_TIERS
          : [];
      if (tiers.length === 0) return [];
      return [{ id: row.id, displayName: row.displayName, image: row.image, tiers }];
    });
  },

  async notifyPosted(tx, notifier, posted) {
    // Being named is done *to* you whatever record it happens on
    // (NOT-002's M18/1 addendum, which M21/5 finally applies to a
    // Request). So the mention is group 1 here exactly as it is on a
    // contract: the bell rings and the email leaves at once. The arm
    // says which comment it was and at which tier; the seam reads who it
    // addressed out of `comment_mentions`, holds the tier, and answers
    // the Request's own two facts.
    //
    // Nothing about the Request travels with the event. The seam reads
    // its number and its summary out of the audience read it does
    // anyway, which is the shape every Request event takes (M20/8) — and
    // it is the only place that knows who the Requester is, which is
    // what makes the M18/4 rule the seam's rather than this arm's.
    if (posted.mentioned.length > 0) {
      await notifier.commentMentioned(tx, {
        entityType: "request",
        requestId: posted.audience.entityId,
        actorId: posted.actorId,
        actorName: posted.actorName,
        commentId: posted.commentId,
        visibility: posted.visibility,
      });
    }
    // And a reply on a Request is NOT-002's group 5 — `requester_events`,
    // the portal audience's own group — so it is one event and one
    // method: the Requester gets a bell row on the portal and an
    // immediate email (INT-003, which declined the status-poke button on
    // exactly this promise).
    //
    // It is raised for **every** comment, at every tier and from every
    // author, and the seam decides who hears it. A staff Full Thread
    // reply reaches the Requester and not the poster, a Requester's own
    // reply reaches nobody because they are the actor, and a Legal Only
    // or Working Team comment reaches nobody because the Requester is
    // in one room (DD-016). None of those three is decided here: the
    // audience, the actor exclusion, and the tier are the seam's, so
    // this arm cannot be the place one of them is forgotten.
    //
    // The people this comment named are **not** dropped from it here,
    // which is where the contract arm drops them. The two events do not
    // overlap on this record: the mention is the staff side's and the
    // reply is the Requester's, so the only person who could hold both
    // is a Member+ who raised the Request, and the seam is what settles
    // them (M18/4).
    //
    // There is no group-2 event beside either. `commentPosted` fans out
    // over a contract's roster and carries its CTR-003 number, and a
    // Request has neither a roster nor a number of that kind.
    await notifier.requestReplied(tx, {
      requestId: posted.audience.entityId,
      actorId: posted.actorId,
      actorName: posted.actorName,
      commentId: posted.commentId,
      visibility: posted.visibility,
    });
  },
};

/** Every arm, by the type it answers for. The mapped type is exhaustive,
 * so a name added to {@link COMMENT_ENTITY_TYPES} with no arm fails the
 * build rather than 500ing at the first request for it. */
const ARMS: { readonly [T in CommentEntityType]: CommentEntityArm } = {
  contract: contractArm,
  request: requestArm,
};

/**
 * Every role that reaches some thread — the reader routes' guard list.
 *
 * It is the union across the arms rather than one arm's list, because a
 * route is mounted once for every entity type. The arm's own
 * `readerRoles` is what actually refuses: {@link reachedThread} asks it
 * per request, so widening this union for a new arm cannot widen an
 * existing one.
 */
export const COMMENT_READER_ROLES: readonly UserRole[] = [
  ...new Set(Object.values(ARMS).flatMap((arm) => [...arm.readerRoles])),
];

/** A record a viewer cannot reach reads exactly as one that does not
 * exist. A refusal would tell them it is there. */
export const NO_RECORD = "No record exists with this reference.";

/**
 * The stored `entity_type` of a comment row, narrowed to a type this API
 * has an arm for, or `null`.
 *
 * The column admits all four types the `activity_log` does, and rows for
 * a type with no arm yet can exist. The correction routes are keyed by a
 * comment's own id rather than by a record, so they meet the column
 * before they meet the seam — this is where they turn it into something
 * the seam can answer for.
 */
export function commentEntityType(value: string): CommentEntityType | null {
  const known: readonly string[] = COMMENT_ENTITY_TYPES;
  return known.includes(value) ? (value as CommentEntityType) : null;
}

/**
 * This viewer's standing on this record, or `null` where there is nothing
 * here for them.
 *
 * The role gate is asked first and answered as `null` too, so one call
 * carries the whole question. Callers that owe a distinguishable refusal
 * take {@link reachedThread} instead.
 */
export async function commentAudience(
  db: Executor,
  user: AuthenticatedUser,
  ref: EntityRef,
): Promise<CommentAudience | null> {
  const arm = ARMS[ref.entityType];
  if (!arm.readerRoles.includes(user.role)) return null;
  const resolved = await arm.resolve(db, user, ref.entityId);
  if (!resolved) return null;
  return { entityType: ref.entityType, ...resolved };
}

/**
 * The same answer, as the record-keyed routes need it: the audience, or
 * the refusal that stands in for it.
 *
 * The two refusals are not the same refusal. A role that reaches no
 * thread of this type is told plainly that this is not theirs — a 403,
 * exactly as the route guard would have said it, because it is a fact
 * about them and not about the record. Everything else is a 404 in
 * {@link NO_RECORD}'s words, so a record out of reach and a record that
 * was never created are one answer.
 */
export async function reachedThread(
  db: Executor,
  user: AuthenticatedUser,
  ref: EntityRef,
): Promise<CommentAudience> {
  const arm = ARMS[ref.entityType];
  if (!arm.readerRoles.includes(user.role)) throw httpError(403, NO_PERMISSION);
  const audience = await commentAudience(db, user, ref);
  if (!audience) throw httpError(404, NO_RECORD);
  return audience;
}

/** Everyone a comment on this record can address (CMT-007), from the arm
 * that resolved the audience. */
export async function mentionCandidates(
  db: Executor,
  audience: CommentAudience,
  only?: readonly string[],
): Promise<MentionCandidate[]> {
  return await ARMS[audience.entityType].mentionCandidates(db, audience, only);
}

/** Raise what a new comment on this record raises (NOT-002), from the arm
 * that resolved the audience. */
export async function notifyCommentPosted(
  tx: NotifyingTransaction,
  notifier: Notifier,
  posted: PostedComment,
): Promise<void> {
  await ARMS[posted.audience.entityType].notifyPosted(tx, notifier, posted);
}
