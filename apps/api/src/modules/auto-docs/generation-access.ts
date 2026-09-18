// SPDX-License-Identifier: AGPL-3.0-only

/** DD-014 for Generations: a created Contract's audience covers the Generation that made it. */
import {
  autoDocGenerations,
  contracts,
  inArray,
  isNull,
  or,
  type Executor,
  type SQL,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";

/**
 * Which Generations a Member reaches. A Generation that created a
 * Contract carries that Contract's answers and output, so it is readable
 * only while the Member reaches the Contract under DD-014. A Generation
 * with no created Contract keeps the Member-wide rule. Business Users
 * read only their own Generations through the Portal, where ownership
 * is the rule, so no predicate is added for them here.
 */
export function generationReachScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  if (user.role === "business_user") return undefined;
  return or(
    isNull(autoDocGenerations.createdContractId),
    inArray(
      autoDocGenerations.createdContractId,
      db.select({ id: contracts.id }).from(contracts).where(contractTeamScope(db, user)),
    ),
  );
}
