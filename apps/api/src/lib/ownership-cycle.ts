// SPDX-License-Identifier: AGPL-3.0-only
import { and, entities, entityHoldings, eq, inArray, type Transaction } from "@openlaw/db";
import { ENTITY_HOLDING_CYCLE_PROBLEM_TYPE } from "@openlaw/shared";
import type { AuthenticatedUser as User } from "../auth/guards.js";
import { entityReachScope } from "./entity-access.js";
import { ownershipPath } from "./ownership-path.js";
import { httpError } from "./problem.js";

export async function assertNoRegisterCycle(
  tx: Transaction,
  user: User,
  holderEntityId: string,
  issuerId: string,
) {
  const holdings = await tx
    .select({
      ownerEntityId: entityHoldings.ownerEntityId,
      ownedEntityId: entityHoldings.ownedEntityId,
    })
    .from(entityHoldings);
  const path = ownershipPath(holdings, issuerId, holderEntityId);
  if (!path) return;
  const loopIds = [holderEntityId, ...path];
  const names = await tx
    .select({ id: entities.id, legalName: entities.legalName })
    .from(entities)
    .where(and(inArray(entities.id, [...new Set(loopIds)]), entityReachScope(tx, user)));
  const byId = new Map(names.map((row) => [row.id, row.legalName]));
  const loop = loopIds.map((id) => byId.get(id) ?? "Restricted Entity").join(" → ");
  throw httpError(409, `This entry would create an ownership loop: ${loop}.`, {
    type: ENTITY_HOLDING_CYCLE_PROBLEM_TYPE,
  });
}

/**
 * Every Entity owner the projection wrote for this issuer, checked for a
 * loop. An update or delete can restore an earlier holder, not only add
 * the entry's own `to`, so the check covers them all; runs inside the
 * write's transaction so a loop rolls the projection back with it.
 */
export async function assertProjectionAcyclic(tx: Transaction, user: User, issuerId: string) {
  const owners = await tx
    .select({ ownerEntityId: entityHoldings.ownerEntityId })
    .from(entityHoldings)
    .where(eq(entityHoldings.ownedEntityId, issuerId));
  for (const owner of owners) {
    await assertNoRegisterCycle(tx, user, owner.ownerEntityId, issuerId);
  }
}
