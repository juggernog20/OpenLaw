// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who reaches a contract, and how much of its conversation they hear.
 *
 * Two questions live here, and they are one answer in two halves. The
 * first is reach (CTR-021): Member+ read every contract, a Contributor
 * reads exactly the contracts they hold a `contract_team` row on, and
 * everyone else reads none. The second is the DD-016 tier predicate: of
 * the comments and activity entries on a contract they can reach, which
 * tiers is this viewer in the room for.
 *
 * Both halves are here because they are the same fact about a person and
 * a record, and two copies of it would drift. The contract routes take
 * the reach half; the comment routes take both.
 *
 * The mention candidates (CMT-007) are the same predicate turned around
 * — run over the people on this record rather than over its rows — so
 * the answer to "who can the typeahead offer" cannot disagree with the
 * answer to "who is refused a mention at this tier".
 *
 * **Filtering happens at query time, never at display time** (DD-016,
 * DD-017). A tier the viewer is not in never leaves the database, so no
 * total, badge, or page count can reveal that it exists.
 *
 * M10's confidentiality gate (DD-014) composes **in front** of this
 * rather than replacing it: `is_confidential` narrows who reaches the
 * record, and the tiers below then answer for whoever is left.
 */

import {
  and,
  asc,
  contracts,
  contractTeam,
  COMMENT_VISIBILITIES,
  eq,
  inArray,
  isNull,
  sql,
  users,
  type CommentVisibility,
  type Db,
  type SQL,
  type UserRole,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";

/**
 * A database handle or a transaction inside one, as `ActivityWriter`
 * already is. A caller that checks and then writes passes its
 * transaction, so the check and the write share one snapshot.
 */
export type ContractAccessReader = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Every tier a Member+ hears — DD-016's three, widest last. */
const ALL_TIERS: readonly CommentVisibility[] = COMMENT_VISIBILITIES;

/**
 * What a Contributor hears: the working group's conversation and the
 * one the requester is in, and nothing said in front of lawyers only.
 */
const WORKING_TIERS: readonly CommentVisibility[] = ["working_team", "full_thread"];

/**
 * How far one viewer sees across the contract table (CTR-021).
 *
 * Member+ see every contract, so nothing narrows and this answers
 * `undefined` — which drops out of the `and(...)` it is composed into. A
 * Contributor sees exactly the contracts they hold a `contract_team` row
 * on, whichever role that row carries: DD-015 makes the Contributor
 * grant per-record, and adding someone to the team is the act that
 * grants it.
 *
 * The same predicate serves every reader. The contract list filters on
 * it, so a Contributor's list is their work and not the whole company's;
 * the record read applies it beside the number, so a contract they are
 * not on 404s exactly as a contract that does not exist; the comment
 * routes apply it beside the id. One predicate is what keeps those
 * answers from drifting apart.
 */
export function contractTeamScope(db: Db, user: AuthenticatedUser): SQL | undefined {
  if (user.role !== "contributor") return undefined;
  return inArray(
    contracts.id,
    db
      .select({ contractId: contractTeam.contractId })
      .from(contractTeam)
      .where(eq(contractTeam.userId, user.id)),
  );
}

/**
 * The DD-016 tier predicate, as a pure function of the viewer's role and
 * their standing on the record. Legal Only admits Administrators and
 * Legal Team Members. Working Team adds Contributors on that contract.
 * Full Thread adds the originating Business User, who has no link to a
 * contract until intake lands (M19–M21) — so it has no third audience
 * yet, and a Business User hears nothing here.
 *
 * An empty answer means this viewer is in no room on this record. That
 * is a real state, not an error: it reads as a record with no
 * conversation, which is exactly what it is for them.
 *
 * The same list answers both directions. A viewer posts into the rooms
 * they are in and no others, so read and write share one rule rather
 * than two that could disagree.
 *
 * `onTeam` is not read for Member+ today — they hear every tier on every
 * contract. It is a parameter because M10's confidentiality gate turns
 * on exactly that fact, and the caller already knows it.
 */
export function readableTiers(role: UserRole, onTeam: boolean): readonly CommentVisibility[] {
  if (role === "administrator" || role === "legal_team_member") return ALL_TIERS;
  if (role === "contributor" && onTeam) return WORKING_TIERS;
  return [];
}

/** One viewer's standing on one contract they can reach. */
export interface ContractAudience {
  /** The contract's id, re-read here rather than trusted from the client. */
  contractId: string;
  /** The tiers this viewer hears on it; never empty. */
  tiers: readonly CommentVisibility[];
}

/**
 * The whole answer in one read: the contract this viewer reaches, and
 * the tiers they hear on it. `null` means there is nothing here for
 * them — the contract does not exist, or it does and they are not on it,
 * or they are on it and in no room. Every one of those answers 404, so
 * a record a viewer cannot reach is indistinguishable from one that was
 * never created.
 */
export async function contractAudience(
  db: Db,
  user: AuthenticatedUser,
  contractId: string,
): Promise<ContractAudience | null> {
  const [row] = await db
    .select({
      id: contracts.id,
      // Membership rides along with the reach check: the tier answer
      // needs it, and a second round trip would only be a second chance
      // for the two to disagree.
      onTeam: sql<boolean>`exists (
        select 1 from ${contractTeam}
        where ${contractTeam.contractId} = ${contracts.id}
          and ${contractTeam.userId} = ${user.id}
      )`,
    })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), contractTeamScope(db, user)))
    .limit(1);
  if (!row) return null;
  const tiers = readableTiers(user.role, row.onTeam);
  return tiers.length === 0 ? null : { contractId: row.id, tiers };
}

/** One person a comment on this record can address, and the tiers they
 * would hear it at. */
export interface MentionCandidate {
  id: string;
  displayName: string;
  image: string | null;
  /** The DD-016 tiers this person hears on this contract; never empty. */
  tiers: readonly CommentVisibility[];
}

/**
 * Everyone a comment on one contract can reach (CMT-007) — the
 * typeahead's list, and the set the seam checks a posted mention
 * against.
 *
 * It is the tier predicate run over the people rather than over the
 * rows: a person belongs here when they hear at least one tier on this
 * record. Member+ hear every tier on every contract, so they are all
 * here whether or not they are on the team — CTR-021 already lets them
 * open it. A Contributor is here only with a `contract_team` row, which
 * is the act that grants their access; mentioning somebody does not
 * grant it, so a Contributor off the team is not offered and a mention
 * of them is refused.
 *
 * Anyone who hears nothing is left out rather than offered and refused.
 * A name in a typeahead that no tier can reach is the trap the
 * promotion confirmation exists to avoid.
 *
 * Archived people are out: they have left, and addressing a question to
 * them reaches nobody (SET-005).
 *
 * `only` narrows the read to a handful of ids. The typeahead wants the
 * whole list; a post that names three people wants three rows, not the
 * directory. Both take the same answer, which is the point — one rule
 * decides who the list offers and who a post may name.
 */
export async function contractMentionCandidates(
  db: ContractAccessReader,
  contractId: string,
  only?: readonly string[],
): Promise<MentionCandidate[]> {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      role: users.role,
      onTeam: sql<boolean>`exists (
        select 1 from ${contractTeam}
        where ${contractTeam.contractId} = ${contractId}
          and ${contractTeam.userId} = ${users.id}
      )`,
    })
    .from(users)
    .where(and(isNull(users.archivedAt), only ? inArray(users.id, [...only]) : undefined))
    // Alphabetical, as every people picker in the product is ordered.
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
  return rows.flatMap((row) => {
    const tiers = readableTiers(row.role, row.onTeam);
    if (tiers.length === 0) return [];
    return [{ id: row.id, displayName: row.displayName, image: row.image, tiers }];
  });
}
