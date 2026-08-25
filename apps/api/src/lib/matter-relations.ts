// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-015's guarded hierarchy and canonical undirected-pair writes. */
import {
  ADVISORY_LOCK,
  and,
  eq,
  isNotNull,
  matterRelations,
  matters,
  sql,
  type Transaction,
} from "@openlaw/db";
import {
  MATTER_PARENT_CYCLE_PROBLEM_TYPE,
  MATTER_RELATION_EXISTS_PROBLEM_TYPE,
  MATTER_SELF_RELATION_PROBLEM_TYPE,
} from "@openlaw/shared";
import { httpError } from "./problem.js";

const MAX_PARENT_DEPTH = 100;

export async function setMatterParent(
  tx: Transaction,
  childId: string,
  parentId: string,
): Promise<void> {
  if (childId === parentId) {
    throw httpError(409, "A Matter cannot sit under itself.", {
      type: MATTER_PARENT_CYCLE_PROBLEM_TYPE,
    });
  }

  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.matterRelations})`);
  let ancestorId: string | null = parentId;
  for (let depth = 0; ancestorId !== null && depth < MAX_PARENT_DEPTH; depth += 1) {
    if (ancestorId === childId) {
      throw httpError(409, "That parent would close a loop in the Matter hierarchy.", {
        type: MATTER_PARENT_CYCLE_PROBLEM_TYPE,
      });
    }
    const [row] = await tx
      .select({ parentId: matters.parentId })
      .from(matters)
      .where(eq(matters.id, ancestorId))
      .limit(1);
    ancestorId = row?.parentId ?? null;
  }
  if (ancestorId !== null) {
    throw httpError(409, "That Matter hierarchy is too deep to verify safely.", {
      type: MATTER_PARENT_CYCLE_PROBLEM_TYPE,
    });
  }

  await tx.update(matters).set({ parentId, updatedAt: new Date() }).where(eq(matters.id, childId));
}

export async function removeMatterParent(tx: Transaction, matterId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.matterRelations})`);
  const [updated] = await tx
    .update(matters)
    .set({ parentId: null, updatedAt: new Date() })
    .where(and(eq(matters.id, matterId), isNotNull(matters.parentId)))
    .returning({ id: matters.id });
  if (!updated) throw httpError(409, "This Matter does not have a parent.");
}

function canonicalPair(firstId: string, secondId: string): [string, string] {
  return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
}

export async function relateMatters(
  tx: Transaction,
  firstId: string,
  secondId: string,
  actorId: string,
): Promise<void> {
  if (firstId === secondId) {
    throw httpError(409, "A Matter cannot be related to itself.", {
      type: MATTER_SELF_RELATION_PROBLEM_TYPE,
    });
  }
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.matterRelations})`);
  const [matterAId, matterBId] = canonicalPair(firstId, secondId);
  const [existing] = await tx
    .select({ createdAt: matterRelations.createdAt })
    .from(matterRelations)
    .where(and(eq(matterRelations.matterAId, matterAId), eq(matterRelations.matterBId, matterBId)))
    .limit(1);
  if (existing) {
    throw httpError(409, "These Matters are already related.", {
      type: MATTER_RELATION_EXISTS_PROBLEM_TYPE,
    });
  }
  await tx.insert(matterRelations).values({ matterAId, matterBId, createdBy: actorId });
}

export async function unrelateMatters(
  tx: Transaction,
  firstId: string,
  secondId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.matterRelations})`);
  const [matterAId, matterBId] = canonicalPair(firstId, secondId);
  const deleted = await tx
    .delete(matterRelations)
    .where(and(eq(matterRelations.matterAId, matterAId), eq(matterRelations.matterBId, matterBId)))
    .returning({ createdAt: matterRelations.createdAt });
  if (deleted.length === 0) throw httpError(404, "These Matters are not related.");
}
