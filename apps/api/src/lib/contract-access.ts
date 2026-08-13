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
  or,
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
 * transaction, so the check and the write share one snapshot — and so
 * that a caller holding a row lock does not take a second pool
 * connection to ask who may touch it.
 */
export type ContractAccessReader = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Every tier a Member+ hears — DD-016's three, widest last. */
const ALL_TIERS: readonly CommentVisibility[] = COMMENT_VISIBILITIES;

/**
 * What a Contributor hears: the working group's conversation and the
 * one the requester is in, and nothing said in front of lawyers only.
 */
const WORKING_TIERS: readonly CommentVisibility[] = ["working_team", "full_thread"];

/** The contracts one person holds a `contract_team` row on, whatever
 * role that row carries. Both halves of the reach rule ask this — the
 * CTR-021 Contributor grant, and DD-014's named team — so they ask it
 * once. */
function contractsTheyAreOn(db: ContractAccessReader, user: AuthenticatedUser): SQL {
  return inArray(
    contracts.id,
    db
      .select({ contractId: contractTeam.contractId })
      .from(contractTeam)
      .where(eq(contractTeam.userId, user.id)),
  );
}

/**
 * How far one viewer sees across the contract table (CTR-021, DD-014).
 *
 * An Administrator sees every contract, confidential or not, so nothing
 * narrows and this answers `undefined` — which drops out of the
 * `and(...)` it is composed into. DD-014 states that as a rule with no
 * exception: an Administrator who must be walled off from a record needs
 * a role change, not a per-record carve-out.
 *
 * A Contributor sees exactly the contracts they hold a `contract_team`
 * row on, whichever role that row carries: DD-015 makes the Contributor
 * grant per-record, and adding someone to the team is the act that
 * grants it. Confidentiality adds nothing to their answer — the row it
 * would ask for is the row they already had to have — so the flag never
 * widens anybody's access.
 *
 * A Legal Team Member read every contract until M10, and the flag is the
 * one thing that takes one away. They reach a confidential contract when
 * they hold a team row on it or are its Owner (`manager_id`), and reach
 * every contract that is not confidential as before. The Owner clause is
 * what stops a contract vanishing from the one person accountable for
 * it.
 *
 * A Business User reaches no contract at all until intake links a
 * requester to a record (M19–M21). Every contract surface refuses them
 * at the guard, and this says the same thing again where no future route
 * can get past it — each role is answered here on purpose, so a role
 * added later cannot fall through into somebody else's grant.
 *
 * The same predicate serves every reader. The contract list filters on
 * it, so a Contributor's list is their work and not the whole company's;
 * the record read applies it beside the number, so a contract they
 * cannot reach 404s exactly as a contract that does not exist; the
 * comment and activity routes apply it beside the id. One predicate is
 * what keeps those answers from drifting apart — and it is read live on
 * every request, so taking somebody's last team row off ends their reach
 * on the next one.
 */
export function contractTeamScope(
  db: ContractAccessReader,
  user: AuthenticatedUser,
): SQL | undefined {
  switch (user.role) {
    case "administrator":
      return undefined;
    case "legal_team_member":
      return or(
        eq(contracts.isConfidential, false),
        contractsTheyAreOn(db, user),
        eq(contracts.managerId, user.id),
      );
    case "contributor":
      return contractsTheyAreOn(db, user);
    case "business_user":
      return sql`false`;
  }
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
 * `onTeam` is not read for Member+ — they hear every tier on every
 * contract they reach. M10's confidentiality gate turns on that same
 * fact, but it does so in `reachesContract` below: reach and tier stay
 * two questions, and this one answers only the second.
 */
export function readableTiers(role: UserRole, onTeam: boolean): readonly CommentVisibility[] {
  if (role === "administrator" || role === "legal_team_member") return ALL_TIERS;
  if (role === "contributor" && onTeam) return WORKING_TIERS;
  return [];
}

/** Where one person stands on one contract, as the answer below needs
 * it stated: on its team, named as its Owner, or neither. */
interface Standing {
  role: UserRole;
  onTeam: boolean;
  isOwner: boolean;
}

/**
 * Whether one person reaches one contract — `contractTeamScope`'s rule
 * said over a person instead of over the rows.
 *
 * The row scope answers "which contracts does this viewer reach"; this
 * answers "which people does this contract reach". They are the same
 * sentence read from either end, and they are written next to each other
 * so that the typeahead can never offer somebody the record itself would
 * answer 404 to.
 */
function reachesContract(person: Standing, isConfidential: boolean): boolean {
  switch (person.role) {
    case "administrator":
      return true;
    case "legal_team_member":
      return !isConfidential || person.onTeam || person.isOwner;
    // The team row is the Contributor's whole grant, and it satisfies
    // the flag too — so confidentiality adds nothing to their answer.
    case "contributor":
      return person.onTeam;
    case "business_user":
      return false;
  }
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
  db: ContractAccessReader,
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
 * It is the reach rule and the tier predicate run over the people rather
 * than over the rows: a person belongs here when the record reaches them
 * and they hear at least one tier on it. On an open contract that is
 * every Member+, on the team or not — CTR-021 already lets them open it.
 * A Contributor is here only with a `contract_team` row, which is the
 * act that grants their access; mentioning somebody does not grant it,
 * so a Contributor off the team is not offered and a mention of them is
 * refused.
 *
 * On a confidential contract the list narrows to the named team, the
 * Owner, and Administrators — automatically, because it is the same rule
 * the row scope applies, and CMT-007 wanted exactly that set. No
 * endpoint changes, and no confirmation offers to add anybody: DES-009's
 * add-as-watcher clause is superseded here.
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
  // The two facts about the record the reach rule turns on. A record
  // that is not there reaches nobody, which is the same answer its own
  // 404 gives.
  const [record] = await db
    .select({ isConfidential: contracts.isConfidential, managerId: contracts.managerId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!record) return [];

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
    const standing = { role: row.role, onTeam: row.onTeam, isOwner: row.id === record.managerId };
    if (!reachesContract(standing, record.isConfidential)) return [];
    const tiers = readableTiers(row.role, row.onTeam);
    if (tiers.length === 0) return [];
    return [{ id: row.id, displayName: row.displayName, image: row.image, tiers }];
  });
}
