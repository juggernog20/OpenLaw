// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-015's write side: the one place a contract is put under another,
 * and the one place a typed link is written between two (M16/5).
 *
 * Renewal routing is the feature that first writes both — a renewal
 * opened as a child contract is born under its predecessor, and one
 * opened as a standalone successor is born saying it `renews` it — so
 * the rules land here with the routing rather than with M17's surfaces.
 * M17's manual link management calls these same two functions, which is
 * the point of them being functions rather than two inline inserts:
 * CTR-015's guards are stated once, and the next writer inherits them.
 *
 * **Both guards are also database rules, and neither is only one.** The
 * compound primary key refuses a second row for one pair and one type,
 * and the `parent_id <> id` check refuses the shortest cycle. What those
 * cannot do is answer: a constraint violation is a 500 to a caller, and
 * a caller that asked for a link the record already holds deserves to be
 * told so by name. So the rules are asked here first, under the lock the
 * calling transaction already holds, and the constraints stand behind
 * whichever code arrives next. What the constraints cannot hold is a
 * race no single row can see — a cycle threaded by two concurrent
 * parent writes, or a symmetric `related` mirror whose two directions
 * are two different keys — so both writes also serialize under one
 * transaction-scoped advisory lock ({@link ADVISORY_LOCK}).
 *
 * **A cycle is a walk and cannot be anything else.** One row can say
 * that a contract is not its own parent; it cannot say that its proposed
 * parent is not already three levels beneath it. So the parent write
 * walks up from the proposed parent, and refuses the moment it meets the
 * contract it was asked to parent. The walk is bounded twice over — by
 * the chain it is walking, which the same guard keeps acyclic, and by an
 * explicit ceiling, because a bound that depends on the invariant it is
 * defending is not a bound.
 *
 * **Nothing here narrates.** The caller writes the activity entry,
 * because the caller is what knows the numbers and titles both ends were
 * called at the time, and an entry has to still name them after a
 * rename.
 */

import {
  ADVISORY_LOCK,
  and,
  contractRelations,
  contracts,
  eq,
  isNotNull,
  or,
  sql,
  type Transaction,
} from "@openlaw/db";
import type { ContractRelationType } from "@openlaw/db";
import {
  CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
  CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
  CONTRACT_SELF_LINK_PROBLEM_TYPE,
} from "@openlaw/shared";
import { httpError } from "./problem.js";

/**
 * How far up a parent chain the cycle guard will walk before it gives
 * up and refuses.
 *
 * The chain is acyclic because this guard keeps it so, which means the
 * walk terminates on its own — but a guard that relies on the invariant
 * it is defending would loop forever the first time a row got in by
 * another route (a restore from a bad backup, a hand-run UPDATE). A
 * hundred is far past any hierarchy a legal team draws: an MSA over its
 * SOWs over their amendments is three.
 */
const MAX_PARENT_DEPTH = 100;

/**
 * Put one contract under another (CTR-015).
 *
 * Refuses a cycle — including the degenerate one where a contract is
 * offered itself — with `CONTRACT_PARENT_CYCLE_PROBLEM_TYPE`, so a
 * caller can tell "pick another parent" from every other refusal the
 * same write can give. It writes the column and nothing else: no cascade
 * and no inheritance, so the child keeps its own status, team,
 * confidentiality, and term.
 *
 * The caller holds the child's row lock. This does not take one of its
 * own, because the parent chain it walks is a read and the column it
 * writes belongs to the row the caller already holds.
 */
export async function setContractParent(
  tx: Transaction,
  link: Readonly<{ childId: string; parentId: string }>,
): Promise<void> {
  const { childId, parentId } = link;
  if (childId === parentId) {
    throw httpError(409, "A contract cannot sit under itself.", {
      type: CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
    });
  }
  // The walk and the write must be one critical section across every
  // process, or two writers could thread a cycle past each other — one
  // putting A under B while another puts B under A, each walking a
  // chain the other has not committed yet. This transaction-scoped
  // lock serializes CTR-015's relation writes: taken after the
  // caller's row lock, released with the commit, and cheap to wait on
  // because what it guards is a short read walk and one UPDATE.
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.contractRelations})`);
  // Walk up from the proposed parent. Meeting the child means the
  // child is already an ancestor of its would-be parent, and setting
  // the column would close the loop.
  let ancestorId: string | null = parentId;
  for (let step = 0; ancestorId !== null && step < MAX_PARENT_DEPTH; step += 1) {
    if (ancestorId === childId) {
      throw httpError(
        409,
        "That contract already sits under this one, so making it the parent would " +
          "close a loop. Pick another parent.",
        { type: CONTRACT_PARENT_CYCLE_PROBLEM_TYPE },
      );
    }
    const [row] = await tx
      .select({ parentId: contracts.parentId })
      .from(contracts)
      .where(eq(contracts.id, ancestorId))
      .limit(1);
    // A parent that is not there is the caller's own reach check to
    // make; the walk simply ends.
    ancestorId = row?.parentId ?? null;
  }
  if (ancestorId !== null) {
    throw httpError(
      409,
      "That contract's hierarchy is deeper than this system will walk. Pick another parent.",
      { type: CONTRACT_PARENT_CYCLE_PROBLEM_TYPE },
    );
  }

  await tx
    .update(contracts)
    .set({ parentId, updatedAt: new Date() })
    .where(eq(contracts.id, childId));
}

/**
 * Write one typed link between two contracts (CTR-015).
 *
 * The direction is the sentence — the successor `renews` its
 * predecessor — and the pair plus the type is the identity, so a second
 * row saying the same thing is refused by name with
 * `CONTRACT_RELATION_EXISTS_PROBLEM_TYPE` rather than swallowed. A
 * contract linking to itself is refused for the same reason it cannot
 * parent itself: the row would say nothing.
 *
 * `related` is symmetric and is still one row: read from either end, it
 * says the same thing, and a mirror row would be a second fact to keep
 * in step with the first. So its duplicate check looks **both ways** —
 * a pair already linked as `related` is refused whichever end asks
 * second, because for a symmetric type the pair is unordered and the
 * primary key alone would let the mirror in. The two directional types
 * are checked one way, because for them the direction is the statement:
 * A renewing B and B renewing A are two different claims.
 */
export async function linkContracts(
  tx: Transaction,
  link: Readonly<{ fromId: string; toId: string; relationType: ContractRelationType }>,
): Promise<void> {
  const { fromId, toId, relationType } = link;
  if (fromId === toId) {
    throw httpError(409, "A contract cannot be linked to itself.", {
      type: CONTRACT_SELF_LINK_PROBLEM_TYPE,
    });
  }
  // One writer at a time, for the symmetric type's sake: the compound
  // key cannot refuse a mirror row — (A, B) and (B, A) are two keys —
  // so two ends asking for one `related` link at once would both read
  // no row and both insert. The same lock the parent write takes makes
  // the check and the insert one critical section across processes; it
  // also turns the directional race's constraint violation into the
  // named refusal below, because the second writer now reads after the
  // first has committed.
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.contractRelations})`);
  const sameLink = and(
    eq(contractRelations.fromContractId, fromId),
    eq(contractRelations.toContractId, toId),
    eq(contractRelations.relationType, relationType),
  );
  const mirrored = and(
    eq(contractRelations.fromContractId, toId),
    eq(contractRelations.toContractId, fromId),
    eq(contractRelations.relationType, relationType),
  );
  const [existing] = await tx
    .select({ createdAt: contractRelations.createdAt })
    .from(contractRelations)
    .where(relationType === "related" ? or(sameLink, mirrored) : sameLink)
    .limit(1);
  if (existing) {
    throw httpError(409, "These two contracts are already linked that way.", {
      type: CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
    });
  }

  // The key still stands behind the directional types for whatever
  // code writes a row without taking the lock: a second row for one
  // pair and one type is refused by Postgres. `onConflictDoNothing`
  // would make that silence, and a caller that asked for a link is
  // owed an answer either way — so the insert is plain.
  await tx.insert(contractRelations).values({
    fromContractId: fromId,
    toContractId: toId,
    relationType,
  });
}

/**
 * Remove one typed link between two contracts (CTR-015).
 *
 * The symmetric `related` type is checked both ways — the row may have
 * been written with either end as `from` — so the caller does not have
 * to know the direction the row was written in.
 *
 * The advisory lock is taken for the same reason the write takes one:
 * so a remove and a concurrent write cannot interleave in a way that
 * loses the remove's intent.
 *
 * Nothing here narrates, for the same reason the write does not — the
 * caller writes the activity entry.
 */
export async function unlinkContracts(
  tx: Transaction,
  link: Readonly<{ fromId: string; toId: string; relationType: ContractRelationType }>,
): Promise<void> {
  const { fromId, toId, relationType } = link;

  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.contractRelations})`);

  const sameLink = and(
    eq(contractRelations.fromContractId, fromId),
    eq(contractRelations.toContractId, toId),
    eq(contractRelations.relationType, relationType),
  );
  const mirrored = and(
    eq(contractRelations.fromContractId, toId),
    eq(contractRelations.toContractId, fromId),
    eq(contractRelations.relationType, relationType),
  );

  const deleted = await tx
    .delete(contractRelations)
    .where(relationType === "related" ? or(sameLink, mirrored) : sameLink)
    .returning({ createdAt: contractRelations.createdAt });

  if (deleted.length === 0) {
    throw httpError(404, "These two contracts are not linked that way.");
  }
}

/**
 * Take a contract out from under its parent (CTR-015).
 *
 * The advisory lock is taken so this cannot interleave with a
 * concurrent parent write on the same branch of the hierarchy.
 *
 * Nothing here narrates, for the same reason the parent write does
 * not.
 */
export async function removeContractParent(tx: Transaction, contractId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.contractRelations})`);

  const [updated] = await tx
    .update(contracts)
    .set({ parentId: null, updatedAt: new Date() })
    .where(and(eq(contracts.id, contractId), isNotNull(contracts.parentId)))
    .returning({ id: contracts.id });

  if (!updated) {
    throw httpError(409, "This contract does not have a parent.");
  }
}
