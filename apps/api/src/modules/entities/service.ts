// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entity registry reads enforce the Member+ floor and apply entityReachScope before paging
 * or returning a record (ENT-001, ENT-004).
 */

import { readTypeForm } from "../../lib/type-form-routes.js";
import { z } from "zod";
import {
  alias,
  and,
  entities,
  entityHoldings,
  entityObligations,
  entityTypeFields,
  entityTypes,
  eq,
  isNull,
  sql,
  ENTITY_STATUSES,
  type Entity,
  type SQL,
} from "@openlaw/db";
import {
  ENTITY_LIST_SORT_KEYS,
  SORT_DIRECTIONS,
  type EntityListSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { selectAttachedFields } from "../../lib/custom-fields.js";
import {
  canManageEntityAccess,
  entityReachScope,
  NO_ENTITY,
  reachedEntity,
} from "../../lib/entity-access.js";
import { escapeLikePattern } from "../../lib/like.js";
import { httpError } from "../../lib/problem.js";
import { resolveStaffRefs } from "../requests/projection.js";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import type { Db } from "@openlaw/db";

const PAGE_SIZE = 50;
const CursorSchema = z.string().min(1).max(64);
export const EntityListQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  type: z.string().min(1).max(64).optional(),
  status: z.enum(ENTITY_STATUSES).optional(),
  jurisdiction: z.string().min(1).max(200).optional(),
  majorityOwner: z.string().min(1).max(64).optional(),
  sort: z.enum(ENTITY_LIST_SORT_KEYS).optional(),
  dir: z.enum(SORT_DIRECTIONS).optional(),
  cursor: CursorSchema.optional(),
});
export function toRow(row: Entity, entityTypeName: string) {
  return {
    id: row.id,
    legalName: row.legalName,
    entityTypeId: row.entityTypeId,
    entityTypeName,
    jurisdiction: row.jurisdiction,
    formedOn: row.formedOn,
    registrationNumber: row.registrationNumber,
    taxId: row.taxId,
    registeredAgent: row.registeredAgent,
    registeredAddress: row.registeredAddress,
    status: row.status,
    sharesAuthorized: row.sharesAuthorized,
    sharesIssued: row.sharesIssued,
    parValue: row.parValue,
    parValueCurrency: row.parValueCurrency,
    customFields: row.customFields ?? {},
    isConfidential: row.isConfidential,
    portalListed: row.portalListed,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const majorityOwnerEntities = alias(entities, "majority_owner_entities");
const majorityOwnerId = sql<string | null>`(
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

/** Every reachable, unarchived Entity's top holder, one row per owned
 * side. The same first-by-percent pick as majorityOwnerId, taken over
 * the whole registry at once, so the filter only offers owners that a
 * row can answer to. */
export function primaryOwnerIds(
  db: Parameters<typeof entityReachScope>[0],
  user: Parameters<typeof entityReachScope>[1],
): SQL {
  return sql`(
    select distinct on (${entityHoldings.ownedEntityId}) ${entityHoldings.ownerEntityId}
    from ${entityHoldings}
    inner join ${entities} on ${entities.id} = ${entityHoldings.ownedEntityId}
    inner join ${entities} as ${majorityOwnerEntities}
      on ${majorityOwnerEntities.id} = ${entityHoldings.ownerEntityId}
    where ${and(isNull(entities.archivedAt), entityReachScope(db, user))}
    order by
      ${entityHoldings.ownedEntityId},
      ${entityHoldings.ownershipPercent} desc,
      lower(${majorityOwnerEntities.legalName}) asc,
      ${majorityOwnerEntities.id} asc
  )`;
}

const nextObligationDueOn = sql<string | null>`(
  select ${entityObligations.nextDueOn}
  from ${entityObligations}
  where ${entityObligations.entityId} = ${entities.id}
    and ${entityObligations.completedOn} is null
  order by ${entityObligations.nextDueOn} asc, ${entityObligations.id} asc
  limit 1
)`;

const nextObligationLabel = sql<string | null>`(
  select ${entityObligations.label}
  from ${entityObligations}
  where ${entityObligations.entityId} = ${entities.id}
    and ${entityObligations.completedOn} is null
  order by ${entityObligations.nextDueOn} asc, ${entityObligations.id} asc
  limit 1
)`;

interface EntitySortRequest {
  key: EntityListSortKey;
  dir: SortDirection;
}

const ENTITY_SORTS: Record<EntityListSortKey, SQL> = {
  name: sql`lower(${entities.legalName})`,
  type: sql`lower(${entityTypes.displayName})`,
  jurisdiction: sql`lower(${entities.jurisdiction})`,
  status: sql`${entities.status}`,
  nextObligation: nextObligationDueOn,
  created: sql`${entities.createdAt}`,
};

function entityListOrder(sort: EntitySortRequest | null): SQL[] {
  const expression = sort ? ENTITY_SORTS[sort.key] : ENTITY_SORTS.name;
  const direction = sort?.dir ?? "asc";
  return [sql`${expression} ${sql.raw(direction)} nulls last`, sql`${entities.id} asc`];
}

/** The cursor remains an opaque Entity id. Its sort value is recovered
 * under the same reach predicate, then the id is the stable tie-break. */
function furtherDownThan(
  db: Parameters<typeof entityReachScope>[0],
  cursor: string,
  user: Parameters<typeof entityReachScope>[1],
  sort: EntitySortRequest | null,
): SQL {
  const expression = sort ? ENTITY_SORTS[sort.key] : ENTITY_SORTS.name;
  const direction = sort?.dir ?? "asc";
  const cursorId = sql`(
    select ${entities.id}
    from ${entities}
    where ${and(eq(entities.id, cursor), entityReachScope(db, user))}
    limit 1
  )`;
  const cursorValue = sql`(
    select ${expression}
    from ${entities}
    inner join ${entityTypes} on ${entityTypes.id} = ${entities.entityTypeId}
    where ${and(eq(entities.id, cursor), entityReachScope(db, user))}
    limit 1
  )`;
  const later = sql.raw(direction === "asc" ? ">" : "<");
  return sql`case
    when ${cursorValue} is null
      then (${expression} is null and ${entities.id} > ${cursorId})
    else (
      ${expression} is null
      or ${expression} ${later} ${cursorValue}
      or (${expression} = ${cursorValue} and ${entities.id} > ${cursorId})
    )
  end`;
}

function assertReader(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}
export async function listEntities(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof EntityListQuery> = {},
) {
  assertReader(user);
  const query = EntityListQuery.parse(input);
  if (query.majorityOwner) {
    const owner = await reachedEntity(db, user, query.majorityOwner);
    if (!owner || owner.archivedAt) return { entities: [], nextCursor: null };
  }
  const sort: EntitySortRequest | null = query.sort
    ? { key: query.sort, dir: query.dir ?? "asc" }
    : null;
  const rows = await db
    .select({
      entity: entities,
      entityTypeName: entityTypes.displayName,
      nextObligationLabel,
      nextObligationDueOn,
    })
    .from(entities)
    .innerJoin(entityTypes, eq(entities.entityTypeId, entityTypes.id))
    .where(
      and(
        query.includeArchived === "true" ? undefined : isNull(entities.archivedAt),
        query.q ? sql`${entities.legalName} ilike ${`%${escapeLikePattern(query.q)}%`}` : undefined,
        query.type ? eq(entities.entityTypeId, query.type) : undefined,
        query.status ? eq(entities.status, query.status) : undefined,
        query.jurisdiction ? eq(entities.jurisdiction, query.jurisdiction) : undefined,
        query.majorityOwner ? eq(majorityOwnerId, query.majorityOwner) : undefined,
        entityReachScope(db, user),
        query.cursor ? furtherDownThan(db, query.cursor, user, sort) : undefined,
      ),
    )
    .orderBy(...entityListOrder(sort))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  return {
    entities: page.map((row) => ({
      ...toRow(row.entity, row.entityTypeName),
      nextObligation:
        row.nextObligationLabel && row.nextObligationDueOn
          ? { label: row.nextObligationLabel, dueOn: row.nextObligationDueOn }
          : null,
    })),
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.entity.id ?? null) : null,
  };
}
export async function getEntity(db: Db, user: AuthenticatedUser, id: string) {
  assertReader(user);
  const [row] = await db
    .select({ entity: entities, entityTypeName: entityTypes.displayName })
    .from(entities)
    .innerJoin(entityTypes, eq(entities.entityTypeId, entityTypes.id))
    .where(and(eq(entities.id, id), entityReachScope(db, user)))
    .limit(1);
  if (!row) throw httpError(404, NO_ENTITY);
  const attached = await selectAttachedFields(db, entityTypeFields, row.entity.entityTypeId);
  return {
    form: await readTypeForm(db, "entity", row.entity.entityTypeId),
    entity: toRow(row.entity, row.entityTypeName),
    canManageAccess: await canManageEntityAccess(db, user, row.entity),
    fields: attached,
    customFieldRefs: await resolveStaffRefs(db, attached, row.entity.customFields ?? {}, user),
  };
}
