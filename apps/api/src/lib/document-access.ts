// SPDX-License-Identifier: AGPL-3.0-only

/** Shared role floor and reach composition for cross-record Document reads. */
import {
  and,
  contracts,
  documents,
  isNotNull,
  isNull,
  matters,
  or,
  type Executor,
  type SQL,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../auth/guards.js";
import { contractTeamScope, documentAudienceScope } from "./contract-access.js";
import { matterTeamScope } from "./matter-access.js";

/** Documents are readable by Member+ and by Contributors through reached records. */
export const requireDocumentReader = requireRole(
  "administrator",
  "legal_team_member",
  "contributor",
);

/**
 * The complete Document repository gate, shared by search and the flat list.
 *
 * The Document's own audience comes first. The owning-record arm follows,
 * and each arm excludes archived records. Closed Matters and ended Contracts
 * remain ordinary reached records.
 */
export function documentRepositoryScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  return and(
    documentAudienceScope(db, user),
    or(
      and(
        isNotNull(documents.contractId),
        isNull(contracts.archivedAt),
        contractTeamScope(db, user),
      ),
      and(isNotNull(documents.matterId), isNull(matters.archivedAt), matterTeamScope(db, user)),
    ),
  );
}
