// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who a notification may reach, said in both directions.
 *
 * The fan-out asks it over **people**: of the audience an event has
 * resolved, which of them does the record actually reach (DD-014,
 * CTR-021, CTR-022)? The bell's two reads ask it over **rows**: of the
 * items this person holds, which ones are about a record they can still
 * reach?
 *
 * A third question joins them for NOT-002's group 2: **who is a record
 * about**. That is not a reach question — it is the Owner and the
 * contract team, the people who put themselves on the record — and it is
 * answered by {@link contractRecordAudience} below, before the reach
 * predicate narrows it.
 *
 * Both are `contract-access`'s rule and neither is a second copy of it.
 * The person direction is `contractMentionCandidates`, which is the
 * reach predicate already turned around; the row direction composes
 * `contractTeamScope` inside a subquery, exactly as the document scope
 * composes it. That is what makes the wall hold on a surface DD-014 was
 * never written about: a notification is a sentence about a record, so
 * it may go exactly as far as the record does.
 *
 * **The row direction is re-applied on every read, never resolved once
 * at write time.** An item written while a contract was open is an item
 * about a contract that may since have been walled off, and M10's answer
 * is that it then leaves the list *and* the count with no gap and no
 * number to notice — the same silent omission the record's own feed
 * makes. The row stays in the table; the reads simply stop answering
 * with it.
 *
 * **The row direction is asked per surface** (M20/9). NOT-001 has one
 * system and two bells, so {@link notificationScope} takes which one is
 * asking: the staff centre answers rows about contracts and about the
 * Inbox, the portal bell answers rows about the reader's own Requests,
 * and neither can answer the other's.
 *
 * **A Request is read from two sides, and the event says which** (M21/4).
 * Group 5 is the Requester's own (DD-013); group 4 is the Inbox's, and
 * its audience is every live Member+ (INT-006). So both the person
 * direction and the row direction take the side as an argument rather
 * than assuming the Requester — the same shape as the surface argument,
 * one question down.
 */

import {
  and,
  asc,
  contracts,
  contractTeam,
  entities,
  entityGrants,
  eq,
  inArray,
  isNotNull,
  isNull,
  matters,
  matterTeam,
  notifications,
  or,
  requests,
  users,
  type CommentVisibility,
  type Executor,
  type SQL,
  type UserRole,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/user.js";
import { contractMentionCandidates, contractTeamScope } from "../contract-access.js";
import { entityReachScope } from "../entity-access.js";
import { matterMentionCandidates, matterTeamScope } from "../matter-access.js";
import { requestEventTypesOn, type RequestSide } from "./catalog.js";

/** The one entity type M18 writes. Named so the fan-out, the reads, and
 * the send job agree on it in one place. */
export const CONTRACT_ENTITY = "contract" as const;
export const MATTER_ENTITY = "matter" as const;
export const ENTITY_ENTITY = "entity" as const;

/** The second one, written from M20/8 by NOT-002's group 5 and from
 * M21/4 by group 4. Named here beside the first for the same reason. */
export const REQUEST_ENTITY = "request" as const;

/**
 * Member+ (CONTEXT.md) — who triages, and therefore the whole audience
 * of NOT-002's group 4 (INT-006).
 *
 * There are no routing rules to narrow it and no team table on a
 * Request to consult, so "every live Member+" is the audience rule in
 * full. The comments module's `request` arm reads the same two roles for
 * the same reason: on a Request, staff standing is a fact about the role
 * and nothing else.
 */
const MEMBER_PLUS: readonly UserRole[] = ["administrator", "legal_team_member"];

/**
 * Which side of a Request an event is addressed to.
 *
 * Re-exported from the catalog, which is where the answer is decided: the
 * side follows the event's group (M21/5), so a caller that reads a slug
 * off a row asks `requestSideOf` and passes the answer down here. It is
 * an argument rather than a branch inside each caller because it is the
 * same question the surface argument asks about rows: who is this
 * sentence for.
 */
export type { RequestSide };

/**
 * Of the people an event named, the ones the record reaches — and, where
 * the event is about something said at a tier, the ones that tier reaches
 * too.
 *
 * `contractMentionCandidates` is asked rather than a rule of this
 * module's own, for the reason the approvals route asks it: it is the
 * reach predicate said over people, so "who may be told" can never
 * disagree with "who may open it". Archived people are out by the same
 * call (SET-005) — telling somebody who has left reaches nobody. And the
 * same call already answers each person's DD-016 rooms, so the tier is a
 * narrowing of the one predicate rather than a second one beside it.
 *
 * **`tier` is how a mention holds DD-016** (CMT-007). A notification
 * about a comment is a sentence about that comment, so it may go exactly
 * as far as the comment does: a Legal Only mention reaches nobody the
 * tier excludes. The composer's refusal is the first gate and this is the
 * one no future call site can forget — the wall's own posture, applied to
 * the second boundary.
 *
 * **`confidentialDocument` is how an event about a file holds DOC-008.**
 * A notification naming a document is a sentence about that document, so
 * it may go exactly as far as the document does: the audience narrows to
 * the record's named people, which is what a confidential document's own
 * scope answers. Today that set and the group-2 audience below coincide
 * — a document has no team of its own, so its audience is the contract's
 * named team, its Owner, and Administrators — and the gate is asked
 * anyway, because "only the document's audience" has to be a property of
 * the code rather than of the two rules happening to agree.
 *
 * Order is not preserved and does not matter: the caller writes one row
 * per person, and the bell orders by time.
 */
export async function reachedBy(
  db: Executor,
  contractId: string,
  userIds: readonly string[],
  narrowing: { tier?: CommentVisibility; confidentialDocument?: boolean } = {},
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const candidates = await contractMentionCandidates(db, contractId, userIds, {
    ...(narrowing.confidentialDocument !== undefined
      ? { confidentialDocument: narrowing.confidentialDocument }
      : {}),
  });
  const { tier } = narrowing;
  return new Set(
    candidates
      .filter((person) => tier === undefined || person.tiers.includes(tier))
      .map((person) => person.id),
  );
}

/** The matter arm of the notification wall, including the comment's tier. */
export async function matterReachedBy(
  db: Executor,
  matterId: string,
  userIds: readonly string[],
  narrowing: { tier?: CommentVisibility } = {},
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const candidates = await matterMentionCandidates(db, matterId, userIds);
  return new Set(
    candidates
      .filter((person) => narrowing.tier === undefined || person.tiers.includes(narrowing.tier))
      .map((person) => person.id),
  );
}

/** The Entity arm of the notification wall (ENT-004), said over people. */
export async function entityReachedBy(
  db: Executor,
  entityId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(entities, eq(entities.id, entityId))
    .leftJoin(
      entityGrants,
      and(eq(entityGrants.entityId, entities.id), eq(entityGrants.userId, users.id)),
    )
    .where(
      and(
        inArray(users.id, [...userIds]),
        isNull(users.archivedAt),
        isNull(entities.archivedAt),
        or(
          eq(users.role, "administrator"),
          and(
            eq(users.role, "legal_team_member"),
            or(eq(entities.isConfidential, false), isNotNull(entityGrants.userId)),
          ),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** One record, and the people NOT-002's group 2 is about. */
export interface RecordAudience {
  /** CTR-003's number — the record's address, and what every item and
   * email deep-links by. */
  contractNumber: number;
  contractTitle: string;
  /**
   * The Owner and everybody holding a `contract_team` row, in no
   * particular order and each named once.
   *
   * **This is the whole of NOT-002's "watchers"** — the decision says
   * so in its own words: watchers are the existing team roles, and there
   * is no separate subscribe mechanism. So `creator`, `member`,
   * `watcher`, and `contributor` all count, because each of them is a
   * row somebody put on the record on purpose.
   *
   * An Administrator is **not** here by role. They reach every contract
   * (DD-014), which is why the wall lets them through, but reaching a
   * record is not the same as being on it — and a bell that told every
   * Administrator about every status change on every contract would be
   * the ambient noise NOT-002's defaults exist to avoid.
   */
  userIds: readonly string[];
}

/**
 * The record an ambient event is about, and the people it concerns
 * (NOT-002 group 2).
 *
 * `null` for a contract that is not there, which reaches nobody — the
 * same answer its own 404 gives.
 *
 * The number and the title ride along because this read already holds
 * the row. Group 1's events are handed them by the route, which knows
 * them: it has just written the record. Group 2's are raised from places
 * that do not — a document route holds a document, the executed-copy job
 * holds an envelope — so asking each of them for two columns would be
 * the same query written at four call sites with four chances to drift.
 *
 * The audience is **resolved** here and **narrowed** by the wall
 * afterwards, in the fan-out, like every other event. This answers who
 * the event is about; `reachedBy` answers which of them the record
 * still reaches.
 */
export async function contractRecordAudience(
  db: Executor,
  contractId: string,
): Promise<RecordAudience | null> {
  const [record] = await db
    .select({
      number: contracts.number,
      title: contracts.title,
      managerId: contracts.managerId,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!record) return null;
  const team = await db
    .select({ userId: contractTeam.userId })
    .from(contractTeam)
    .where(eq(contractTeam.contractId, contractId));
  const userIds = new Set(team.map((row) => row.userId));
  if (record.managerId) userIds.add(record.managerId);
  return {
    contractNumber: record.number,
    contractTitle: record.title,
    userIds: [...userIds],
  };
}

/** One matter and the Matter Manager plus its explicit team roster. */
export async function matterRecordAudience(
  db: Executor,
  matterId: string,
): Promise<{ matterNumber: number; matterTitle: string; userIds: readonly string[] } | null> {
  const [record] = await db
    .select({ number: matters.number, title: matters.title, managerId: matters.managerId })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  if (!record) return null;
  const team = await db
    .select({ userId: matterTeam.userId })
    .from(matterTeam)
    .where(eq(matterTeam.matterId, matterId));
  const userIds = new Set(team.map((row) => row.userId));
  if (record.managerId) userIds.add(record.managerId);
  return { matterNumber: record.number, matterTitle: record.title, userIds: [...userIds] };
}

/** One Request, and the person NOT-002's group 5 is about. */
export interface RequestAudience {
  /** INT-002's number — the Request's address, shown as R-###, and what
   * every group-5 item and email deep-links by. */
  requestNumber: number;
  /** What the Requester called their ask. It names the Request in the
   * item and in the subject line, the way a contract's title does. */
  summary: string;
  /**
   * Who asked (DD-013) — **the whole audience of every group-5 event**.
   *
   * Staff are not here, and their absence is the decision. A Member+ who
   * replies on a Request is acting on the staff side; what tells the
   * staff side that a Request has arrived is group 4, the Inbox's own
   * group (INT-006), which is a different queue with different defaults.
   */
  requesterId: string;
}

/**
 * The Request a group-5 event is about, and the person it concerns.
 *
 * `null` for a Request that is not there, which reaches nobody — the
 * contract read's answer one table over, for its reason.
 *
 * **An archived Request is not there**, by the house rule that NULL
 * means live. It is the same answer its own detail read gives and the
 * same one the thread's `request` arm gives (CMT-010): a frozen record
 * is not something to send anybody a message about.
 *
 * The number and the summary ride along because this read already holds
 * the row, exactly as {@link contractRecordAudience}'s do: a group-5
 * event is raised from the submission route, from the thread, and (from
 * M21) from the disposition routes, and asking each of them for two
 * columns would be one query written at four call sites.
 */
export async function requestAudience(
  db: Executor,
  requestId: string,
): Promise<RequestAudience | null> {
  const [record] = await db
    .select({
      number: requests.number,
      summary: requests.summary,
      requesterId: requests.requesterId,
    })
    .from(requests)
    .where(and(eq(requests.id, requestId), isNull(requests.archivedAt)))
    .limit(1);
  if (!record) return null;
  return {
    requestNumber: record.number,
    summary: record.summary,
    requesterId: record.requesterId,
  };
}

/** The ask a record was born from, as the reply promise needs it
 * described (CMT-001, M21/11). */
export interface ConvertedFrom {
  requestId: string;
  /** Who asked — the one person the reply is for, and the one person the
   * record's own group-2 event must therefore leave out at Full Thread
   * so that one comment tells one person once. */
  requesterId: string;
}

/**
 * The Request a conversion turned into this record, or `null` where no
 * Request did (CMT-001, INT-002).
 *
 * **The back-link is read behind the seam, and this is what makes the
 * reply promise survive the thread's move.** A staff Full Thread comment
 * on a converted record is a reply to the person who asked, whatever
 * screen it was typed on — the record's applet, the staff request
 * detail, or the portal — so the fan-out finds them from the record
 * rather than being told about them by a call site. No comment route
 * knows a Request exists, which is the property that keeps this from
 * being one rule in three hands.
 *
 * **An archived Request is not there**, by the house rule that NULL means
 * live and for {@link requestAudience}'s reason: a frozen record is not
 * something to send anybody a message about.
 *
 * At most one row can answer — a Request becomes one record, and the
 * table holds that as a check constraint — but a record could in
 * principle be named by two rows if the column were ever written twice,
 * so the read is bounded and ordered rather than trusting the planner.
 */
export async function requestConvertedInto(
  db: Executor,
  target: { module: "contract" | "matter"; id: string },
): Promise<ConvertedFrom | null> {
  const [record] = await db
    .select({ id: requests.id, requesterId: requests.requesterId })
    .from(requests)
    .where(
      and(
        target.module === "contract"
          ? eq(requests.convertedContractId, target.id)
          : eq(requests.convertedMatterId, target.id),
        isNull(requests.archivedAt),
      ),
    )
    .orderBy(asc(requests.number))
    .limit(1);
  if (!record) return null;
  return { requestId: record.id, requesterId: record.requesterId };
}

/**
 * Of the people an event on a Request named, the ones the Request still
 * reaches — the wall step of the five, said for a Request.
 *
 * **A Request has no wall.** DD-014's flag is a contract's and INT-002
 * gives a Request no equivalent (the CMT-010 M20/7 arm says the same
 * thing about the thread). So what continues to be asked here are the
 * facts that can still change after a row is written: the Request is
 * still live, this person still stands where the event addressed them,
 * and they have not left (SET-005). Telling somebody who has been
 * archived reaches nobody, and a bell row whose Request has gone — or
 * been frozen — is a sentence about nothing.
 *
 * **`side` is which of the two standings the event asked for** (M21/4).
 * A group-5 event is addressed to the Requester, so the fact re-asked is
 * that this person is still it. Group 4's arrival is addressed to the
 * Inbox, so the fact re-asked is that this person is still Member+ — a
 * triager demoted between the write and the send is a person the Inbox
 * no longer reaches, and the row stops being sent exactly as a walled-off
 * contract's does. The default is the Requester, which is the narrower
 * of the two and therefore the safe way for a caller to say nothing.
 *
 * **`tier` is how a group-5 event holds DD-016.** A Requester is in Full
 * Thread and nowhere else, so an event about something said in another
 * room reaches them not at all. It is applied here rather than at the
 * call site for the reason the contract wall is: the composer's refusal
 * is the first gate, and this is the one no later caller can forget. It
 * narrows nothing on the Inbox side, because a Member+ is in every room
 * on every Request — the comments module's `request` arm says the same.
 */
export async function requestReachedBy(
  db: Executor,
  requestId: string,
  userIds: readonly string[],
  narrowing: { tier?: CommentVisibility; side?: RequestSide } = {},
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const side = narrowing.side ?? "requester";
  if (
    side === "requester" &&
    narrowing.tier !== undefined &&
    !REQUESTER_TIERS.includes(narrowing.tier)
  ) {
    return new Set();
  }
  const rows = await db
    .select({ id: users.id })
    .from(requests)
    .innerJoin(
      users,
      // The standing itself, as the join condition: the Requester is one
      // named row, and a triager is anybody holding a Member+ role.
      side === "inbox" ? inArray(users.role, [...MEMBER_PLUS]) : eq(users.id, requests.requesterId),
    )
    .where(
      and(
        eq(requests.id, requestId),
        isNull(requests.archivedAt),
        inArray(users.id, [...userIds]),
        isNull(users.archivedAt),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * Who NOT-002's group 4 is about: every live Member+ (INT-006).
 *
 * The audience read behind the seam, in group 2's and group 5's shape
 * and for their reason — a caller that could name the audience could
 * name somebody who does not triage. There is nothing about the Request
 * in the answer, because there is nothing about the Request in the
 * rule: Member+ triages, and INT-006 declined routing rules, rotation,
 * and any claim mechanism that would have narrowed it.
 *
 * Archived people are out (SET-005), so the answer is already the live
 * set; the wall step re-asks the same fact at send time, where the
 * standing can have changed since.
 */
export async function inboxAudience(db: Executor): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, [...MEMBER_PLUS]), isNull(users.archivedAt)));
  return rows.map((row) => row.id);
}

/** The Requester's one room (DD-016), as the fan-out has to know it. The
 * comments module's `request` arm answers the same question for the
 * thread; both are reading DD-013's "a Business User sees only their own
 * Requests" through DD-016's tiers, and there is nothing narrower for
 * either to compose. */
const REQUESTER_TIERS: readonly CommentVisibility[] = ["full_thread"];

/**
 * Which bell is asking (NOT-001).
 *
 * One notification system, two rendering surfaces: the staff
 * notification centre in the full application, and the portal bell a
 * Requester reads. **The surface is what decides which rows come back**,
 * not the reader's role — a Member+ who submitted a Request of their own
 * is a Requester on the portal and a staff reader in the application,
 * and the same person holds both kinds of row at once.
 */
export const NOTIFICATION_SURFACES = ["staff", "portal"] as const;
export type NotificationSurface = (typeof NOTIFICATION_SURFACES)[number];

/**
 * The notification rows this viewer may still be shown on this surface —
 * the predicate the list, the count, and both writes compose.
 *
 * **Two surfaces, two disjoint sets of rows, and the split is by
 * audience.** The staff centre answers `contract` rows and the Inbox's
 * own group-4 arrivals; the portal bell answers a person's own group-5
 * items. Neither can ever answer the other's — including for the one
 * person who holds both kinds of row about one Request, a Member+ who
 * submitted it. That is what makes a staff mark-all-read unable to touch
 * a Requester's items, and the portal bell unable to draw a word about a
 * contract.
 *
 * **A row about a contract passes only while the viewer reaches that
 * contract**, and reach is `contractTeamScope`: the same answer the
 * record, its paper, its comments, and its feed are read through.
 *
 * **A row about a Request passes only while the viewer still stands
 * where the event addressed them and the Request is still live** — its
 * Requester on the portal (DD-013), a triager in the Inbox (INT-006). A
 * Request has no wall (DD-014's flag is a contract's; INT-002 gives a
 * Request no equivalent), so what is re-asked here are the facts that
 * can still change after the row was written — the same facts
 * {@link requestReachedBy} re-asks at send time, said over rows instead
 * of over people. An archived Request is not there, by the house rule
 * that NULL means live: a frozen record is not something to prompt
 * anybody about.
 *
 * **A row about anything else does not pass at all**, and that is the
 * safe direction rather than an omission. M22 added the Matter reach
 * rule before Matters began writing rows. Any later entity type remains
 * invisible until it gains its own rule. Failing closed
 * shows up as a missing item somebody notices; failing open would show
 * up as a leak nobody does. The send job refuses an entity it has no
 * rule for on exactly the same reasoning.
 *
 * It filters at query time, which is the whole property: an omitted row
 * never leaves the database, so no page, cursor, or badge can announce
 * that something was left out.
 */
export function notificationScope(
  db: Executor,
  user: AuthenticatedUser,
  surface: NotificationSurface,
): SQL | undefined {
  return surface === "portal" ? portalScope(db, user) : staffScope(db, user);
}

/**
 * The staff notification centre's rows: contracts this person reaches,
 * and — for a Member+ — the Inbox's own arrivals.
 *
 * **Two arms, because the surface has two kinds of news** (M21/4). A
 * contract row passes while `contractTeamScope` says the reader reaches
 * the record; a Request row passes while the reader triages (INT-006)
 * and the Request is still live. The second arm is narrowed to the
 * staff side's slugs (M21/5) and not merely to the entity type, which
 * is what keeps a Member+'s own group-5 receipt on the portal bell
 * where it belongs: the same person holds both kinds of row about the
 * same Request, and the split between the two bells is by audience
 * rather than by table.
 */
function staffScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  const scope = contractTeamScope(db, user);
  const matterScope = matterTeamScope(db, user);
  const entityScope = entityReachScope(db, user);
  return or(
    and(
      eq(notifications.entityType, CONTRACT_ENTITY),
      // An Administrator reaches every contract, so the subquery would be
      // the whole table and the clause only cost. `contractTeamScope`
      // answering `undefined` is that fact, read here rather than
      // restated as a role check of this module's own.
      scope === undefined
        ? undefined
        : inArray(
            notifications.entityId,
            db.select({ id: contracts.id }).from(contracts).where(scope),
          ),
    ),
    and(
      eq(notifications.entityType, MATTER_ENTITY),
      matterScope === undefined
        ? undefined
        : inArray(
            notifications.entityId,
            db.select({ id: matters.id }).from(matters).where(matterScope),
          ),
    ),
    and(
      eq(notifications.entityType, ENTITY_ENTITY),
      inArray(
        notifications.entityId,
        db
          .select({ id: entities.id })
          .from(entities)
          .where(and(isNull(entities.archivedAt), entityScope)),
      ),
    ),
    MEMBER_PLUS.includes(user.role) ? inboxRows(db) : undefined,
  );
}

/** The staff side's Request rows: group 4's arrivals and group 1's
 * mentions, about Requests that are still there. A frozen record is not
 * something to prompt anybody about, which is the portal arm's rule said
 * on the staff side. */
function inboxRows(db: Executor): SQL | undefined {
  return and(
    eq(notifications.entityType, REQUEST_ENTITY),
    inArray(notifications.eventType, requestEventTypesOn("inbox")),
    inArray(
      notifications.entityId,
      db.select({ id: requests.id }).from(requests).where(isNull(requests.archivedAt)),
    ),
  );
}

/** The portal bell's rows: this person's own live Requests. */
function portalScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  return and(
    eq(notifications.entityType, REQUEST_ENTITY),
    // The group, not only the entity type, for the staff arm's reason:
    // a Member+ reading their own Requests here must not be shown the
    // Inbox's arrivals, which are their staff work rather than their
    // own asks. Two named groups rather than "everything but group 4",
    // so a group added later is invisible until somebody has decided
    // which bell it belongs on.
    inArray(notifications.eventType, requestEventTypesOn("requester")),
    // No Administrator shortcut here, and there is nothing to shortcut:
    // reaching every contract is a staff role's power (DD-014), while
    // being somebody's Requester is a fact about one row (DD-013). An
    // Administrator's portal bell is their own Requests and no more.
    inArray(
      notifications.entityId,
      db
        .select({ id: requests.id })
        .from(requests)
        .where(and(eq(requests.requesterId, user.id), isNull(requests.archivedAt))),
    ),
  );
}
