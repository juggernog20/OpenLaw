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
 * Order is not preserved and does not matter: the caller writes one row
 * per person, and the bell orders by time.
 */
export async function reachedBy(
  db: Executor,
  contractId: string,
  userIds: readonly string[],
  tier?: CommentVisibility,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const candidates = await contractMentionCandidates(db, contractId, userIds);
  return new Set(
    candidates
      .filter((person) => tier === undefined || person.tiers.includes(tier))
      .map((person) => person.id),
  );
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
