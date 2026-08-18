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
 */

import {
  and,
  contracts,
  contractTeam,
  eq,
  inArray,
  notifications,
  type CommentVisibility,
  type Executor,
  type SQL,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/user.js";
import { contractMentionCandidates, contractTeamScope } from "../contract-access.js";

/** The one entity type M18 writes. Named so the fan-out, the reads, and
 * the send job agree on it in one place. */
export const CONTRACT_ENTITY = "contract" as const;

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

/**
 * The notification rows this viewer may still be shown — the predicate
 * both the list and the count compose.
 *
 * A row about a contract passes only while the viewer reaches that
 * contract, and reach is `contractTeamScope`: the same answer the
 * record, its paper, its comments, and its feed are read through.
 *
 * **A row about anything else does not pass at all**, and that is the
 * safe direction rather than an omission. The API writes `contract`
 * alone in M18, so nothing is excluded today; when matters (M22) start
 * writing rows, a reach rule for them has to be added here, and until
 * it is their items are invisible rather than unguarded. Failing closed
 * shows up as a missing item somebody notices; failing open would show
 * up as a leak nobody does. The send job refuses an entity it has no
 * rule for on exactly the same reasoning.
 *
 * It filters at query time, which is the whole property: an omitted row
 * never leaves the database, so no page, cursor, or badge can announce
 * that something was left out.
 */
export function notificationScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  const scope = contractTeamScope(db, user);
  return and(
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
  );
}
