// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared role floor and reach composition for cross-record Document reads.
 *
 * Access is inherited from the owning record (DOC-008) and narrowed by the
 * Document's own audience (DD-014). Search and the repository call this so
 * the two can never disagree about what a viewer reaches.
 */
import {
  and,
  contracts,
  documents,
  entities,
  isNotNull,
  isNull,
  knowledgeItems,
  matters,
  or,
  sql,
  type Executor,
  type SQL,
} from "@openlaw/db";
import { DOCUMENT_OWNER_KINDS, type DocumentOwner } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../auth/guards.js";
import { contractTeamScope, documentAudienceScope } from "./contract-access.js";
import { entityReachScope } from "./entity-access.js";
import { matterTeamScope } from "./matter-access.js";

/** Documents are readable by Member+ and by Contributors through reached records. */
export const requireDocumentReader = requireRole(
  "administrator",
  "legal_team_member",
  "contributor",
);

function owningRecordScope(
  owner: DocumentOwner,
  db: Executor,
  user: AuthenticatedUser,
): SQL | undefined {
  switch (owner) {
    case "contract":
      return and(
        isNotNull(documents.contractId),
        isNull(contracts.archivedAt),
        contractTeamScope(db, user),
      );
    case "matter":
      return and(
        isNotNull(documents.matterId),
        isNull(matters.archivedAt),
        matterTeamScope(db, user),
      );
    case "entity":
      return and(
        isNotNull(documents.entityId),
        isNull(entities.archivedAt),
        entityReachScope(db, user),
      );
    case "knowledge_item":
      return and(
        isNotNull(documents.knowledgeItemId),
        isNull(knowledgeItems.archivedAt),
        user.role === "administrator" || user.role === "legal_team_member" ? undefined : sql`false`,
      );
  }
}

/**
 * The complete Document repository gate, shared by search and the flat list.
 *
 * The Document's own audience comes first. The owning-record arm follows,
 * and each arm excludes Archiving only. A Matter after Closing and a Contract
 * after Ending (CTR-019, MTR-008) remain ordinary reached records.
 */
export function documentRepositoryScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  return and(
    documentAudienceScope(db, user),
    or(...DOCUMENT_OWNER_KINDS.map((owner) => owningRecordScope(owner, db, user))),
  );
}
