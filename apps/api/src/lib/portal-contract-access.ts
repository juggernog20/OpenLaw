// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023: Portal access requires current record membership. */
import {
  and,
  contracts,
  contractTeam,
  eq,
  inArray,
  isNull,
  type Executor,
  type SQL,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";

export function portalContractScope(db: Executor, user: AuthenticatedUser): SQL {
  return and(
    isNull(contracts.archivedAt),
    inArray(
      contracts.id,
      db
        .select({ id: contractTeam.contractId })
        .from(contractTeam)
        .where(eq(contractTeam.userId, user.id)),
    ),
  )!;
}
