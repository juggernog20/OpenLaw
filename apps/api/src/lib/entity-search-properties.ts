// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two derived Entity values that the Entities list and Advanced
 * Search both filter on. One definition, so a search condition on
 * Majority owner or Next obligation date finds exactly the rows the
 * list's own filter finds.
 */
import { alias, entities, entityHoldings, entityObligations, sql } from "@openlaw/db";
const majorityOwnerEntities = alias(entities, "majority_owner_entities");

/** The top holder by percent, ties broken by name then id. */
export const majorityOwnerId = sql<string | null>`(
  select ${entityHoldings.ownerEntityId}
  from ${entityHoldings}
  inner join ${entities} as ${majorityOwnerEntities}
    on ${majorityOwnerEntities.id} = ${entityHoldings.ownerEntityId}
  where ${entityHoldings.ownedEntityId} = ${entities.id}
  order by
    ${entityHoldings.ownershipPercent} desc,
    lower(${majorityOwnerEntities.legalName}) asc,
    ${majorityOwnerEntities.id} asc
  limit 1
)`;

/** The earliest due date among the Entity's obligations still open. */
export const nextObligationDueOn = sql<string | null>`(
  select ${entityObligations.nextDueOn}
  from ${entityObligations}
  where ${entityObligations.entityId} = ${entities.id}
    and ${entityObligations.completedOn} is null
  order by ${entityObligations.nextDueOn} asc, ${entityObligations.id} asc
  limit 1
)`;
