// SPDX-License-Identifier: AGPL-3.0-only
import { alias, entities, entityHoldings, entityObligations, sql } from "@openlaw/db";
const majorityOwnerEntities = alias(entities, "majority_owner_entities");
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

export const nextObligationDueOn = sql<string | null>`(
  select ${entityObligations.nextDueOn}
  from ${entityObligations}
  where ${entityObligations.entityId} = ${entities.id}
    and ${entityObligations.completedOn} is null
  order by ${entityObligations.nextDueOn} asc, ${entityObligations.id} asc
  limit 1
)`;
