// SPDX-License-Identifier: AGPL-3.0-only

/** DD-021 requires a live Contract, Business Owner or explicit stakeholder affiliation,
 * and the existing Confidential audience. Clearing ownership preserves manual links. */

import {
  and,
  contracts,
  contractStakeholders,
  eq,
  inArray,
  isNull,
  or,
  type Executor,
  type SQL,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";
import { contractNamedAudienceScope } from "./contract-access.js";

export function portalContractScope(db: Executor, user: AuthenticatedUser): SQL {
  return and(
    isNull(contracts.archivedAt),
    or(
      eq(contracts.businessOwnerId, user.id),
      inArray(
        contracts.id,
        db
          .select({ id: contractStakeholders.contractId })
          .from(contractStakeholders)
          .where(eq(contractStakeholders.userId, user.id)),
      ),
    ),
    or(eq(contracts.isConfidential, false), contractNamedAudienceScope(db, user)),
  )!;
}
