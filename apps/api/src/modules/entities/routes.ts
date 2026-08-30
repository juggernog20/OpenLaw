// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry routes (ENT-001/ENT-004, #98): list and create
 * for the registry core, plus the type-picker read and the archive
 * cleanup seam. Everything here is Member+ — Administrators and Legal
 * Team Members equally, read and write — the first Member+ surface in
 * the codebase; Contributors, Business Users, and unauthenticated
 * requests get nothing (ENT-004). The list is the seam the M8
 * signing-entity picker consumes: ordered by legal name, archived rows
 * excluded unless asked for. The record surface (#99) adds the single
 * read behind the record page (archived rows answer too — restore
 * needs to see them), update for correcting any identity-card field —
 * the status only within the fixed ENT-001 enum, the type only to a
 * live one, and never on an archived record — and restore, archive's
 * recovery story. Every mutation appends to the activity log in the
 * same transaction (DD-017).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  alias,
  and,
  asc,
  entities,
  entityHoldings,
  entityObligations,
  entityTypeFields,
  entityTypes,
  eq,
  isNull,
  sql,
  ENTITY_STATUSES,
  officerRoles,
  users,
  type Entity,
  type SQL,
} from "@openlaw/db";
import {
  ENTITY_LIST_SORT_KEYS,
  SORT_DIRECTIONS,
  type EntityListSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { entityReachScope, NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { resolveStaffRefs, StaffRequestCustomFieldRefsSchema } from "../requests/projection.js";
import { entityRecordChildRoutes } from "./record-routes.js";
import { entityHoldingRoutes } from "./holding-routes.js";
import { entityObligationRoutes } from "./obligation-routes.js";
import { entityGrantRoutes } from "./grant-routes.js";

/** ENT-004's access floor: the whole registry is Member+. */
const requireMember = requireRole("administrator", "legal_team_member");
const PAGE_SIZE = 50;
const CursorSchema = z.string().min(1).max(64);

const EntityRowSchema = z.object({
  id: z.string(),
  legalName: z.string(),
  entityTypeId: z.string(),
  /** The type's display name, joined in — the list renders it directly. */
  entityTypeName: z.string(),
  jurisdiction: z.string().nullable(),
  formedOn: z.iso.date().nullable(),
  registrationNumber: z.string().nullable(),
  taxId: z.string().nullable(),
  registeredAgent: z.string().nullable(),
  registeredAddress: z.string().nullable(),
  status: z.enum(ENTITY_STATUSES),
  sharesAuthorized: z.number().int().nullable(),
  sharesIssued: z.number().int().nullable(),
  parValue: z.number().int().nullable(),
  customFields: CustomFieldsSchema,
  isConfidential: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const NextObligationSchema = z.object({
  label: z.string(),
  dueOn: z.iso.date(),
});

const EntityListRowSchema = EntityRowSchema.extend({
  nextObligation: NextObligationSchema.nullable(),
});

/** The Member+ readable slice of an entity type — the register form's
 * picker source (GET /entity-types itself is Administrator-only per
 * SET-002, so the registry surface carries its own read). */
const EntityTypeOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

/** The Member+ picker projection for ENT-001 officer roles. */
const OfficerRoleOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

const PersonOptionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  role: z.string(),
});

const EntityRecordEnvelope = z.object({
  entity: EntityRowSchema,
  fields: z.array(AttachedCustomFieldSchema),
  customFieldRefs: StaffRequestCustomFieldRefsSchema,
});

const LegalNameSchema = z.string().trim().min(1).max(200);
/** Free-text card scalars; empty strings normalize to NULL on write. */
const CardTextSchema = z.string().trim().max(200);
const AddressSchema = z.string().trim().max(500);
const ShareCapitalSchema = z.number().int().nonnegative();

function toRow(row: Entity, entityTypeName: string) {
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
    customFields: row.customFields ?? {},
    isConfidential: row.isConfidential,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const majorityOwnerEntities = alias(entities, "majority_owner_entities");
const majorityOwnerId = sql<string | null>`(
  select ${entityHoldings.ownerEntityId}
  from ${entityHoldings}
  inner join ${sql.raw('"entities" as "majority_owner_entities"')}
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
function primaryOwnerIds(
  db: Parameters<typeof entityReachScope>[0],
  user: Parameters<typeof entityReachScope>[1],
): SQL {
  return sql`(
    select distinct on (${entityHoldings.ownedEntityId}) ${entityHoldings.ownerEntityId}
    from ${entityHoldings}
    inner join ${entities} on ${entities.id} = ${entityHoldings.ownedEntityId}
    inner join ${sql.raw('"entities" as "majority_owner_entities"')}
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

export const entitiesRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(entityObligationRoutes);
  await app.register(entityGrantRoutes);
  await app.register(entityHoldingRoutes);
  await app.register(entityRecordChildRoutes);

  app.get(
    "/entities",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntities",
        summary:
          "The filtered, sorted, keyset-paged Entity registry with its " +
          "soonest open obligation; the entities array remains the M8 " +
          "signing-entity picker seam",
        tags: ["entities"],
        querystring: z.object({
          includeArchived: z.enum(["true", "false"]).optional(),
          type: z.string().min(1).max(64).optional(),
          status: z.enum(ENTITY_STATUSES).optional(),
          jurisdiction: z.string().min(1).max(200).optional(),
          majorityOwner: z.string().min(1).max(64).optional(),
          sort: z.enum(ENTITY_LIST_SORT_KEYS).optional(),
          dir: z.enum(SORT_DIRECTIONS).optional(),
          cursor: CursorSchema.optional(),
        }),
        response: {
          200: z.object({
            entities: z.array(EntityListRowSchema),
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      if (request.query.majorityOwner) {
        const owner = await reachedEntity(app.db, request.user, request.query.majorityOwner);
        if (!owner || owner.archivedAt) return { entities: [], nextCursor: null };
      }
      const sort: EntitySortRequest | null = request.query.sort
        ? { key: request.query.sort, dir: request.query.dir ?? "asc" }
        : null;
      const rows = await app.db
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
            request.query.includeArchived === "true" ? undefined : isNull(entities.archivedAt),
            request.query.type ? eq(entities.entityTypeId, request.query.type) : undefined,
            request.query.status ? eq(entities.status, request.query.status) : undefined,
            request.query.jurisdiction
              ? eq(entities.jurisdiction, request.query.jurisdiction)
              : undefined,
            request.query.majorityOwner
              ? eq(majorityOwnerId, request.query.majorityOwner)
              : undefined,
            entityReachScope(app.db, request.user),
            request.query.cursor
              ? furtherDownThan(app.db, request.query.cursor, request.user, sort)
              : undefined,
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
    },
  );

  app.get(
    "/entities/list-options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityRegistryOptions",
        summary: "Reach-scoped Jurisdiction and Majority owner options for the Entity registry",
        tags: ["entities"],
        response: {
          200: z.object({
            jurisdictions: z.array(z.string()),
            majorityOwners: z.array(z.object({ id: z.string(), legalName: z.string() })),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [jurisdictionRows, ownerRows] = await Promise.all([
        // GROUP BY, not DISTINCT: Postgres refuses to order a DISTINCT
        // read by an expression that is not in its select list.
        app.db
          .select({ jurisdiction: entities.jurisdiction })
          .from(entities)
          .where(
            and(
              isNull(entities.archivedAt),
              sql`trim(${entities.jurisdiction}) <> ''`,
              entityReachScope(app.db, request.user),
            ),
          )
          .groupBy(entities.jurisdiction)
          .orderBy(asc(sql`lower(${entities.jurisdiction})`)),
        app.db
          .select({ id: entities.id, legalName: entities.legalName })
          .from(entities)
          .where(
            and(
              isNull(entities.archivedAt),
              entityReachScope(app.db, request.user),
              sql`${entities.id} in ${primaryOwnerIds(app.db, request.user)}`,
            ),
          )
          .orderBy(asc(sql`lower(${entities.legalName})`), asc(entities.id)),
      ]);
      return {
        jurisdictions: jurisdictionRows.flatMap((row) =>
          row.jurisdiction ? [row.jurisdiction] : [],
        ),
        majorityOwners: ownerRows,
      };
    },
  );

  app.get(
    "/entities/types",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityTypeOptions",
        summary:
          "The live entity types in display order — the register form's " +
          "Member+ picker source (the /entity-types settings surface " +
          "stays Administrator-only per SET-002)",
        tags: ["entities"],
        response: {
          200: z.object({ entityTypes: z.array(EntityTypeOptionSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: entityTypes.id,
          slug: entityTypes.slug,
          displayName: entityTypes.displayName,
        })
        .from(entityTypes)
        .where(isNull(entityTypes.archivedAt))
        .orderBy(asc(entityTypes.displayOrder), asc(entityTypes.createdAt));
      return { entityTypes: rows };
    },
  );

  app.get(
    "/entities/officer-roles",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listOfficerRoleOptions",
        summary:
          "The live officer roles in display order, for Member+ Entity forms; " +
          "the /officer-roles settings taxonomy stays Administrator-only",
        tags: ["entities"],
        response: {
          200: z.object({
            officerRoles: z.array(OfficerRoleOptionSchema),
            users: z.array(PersonOptionSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: officerRoles.id,
          slug: officerRoles.slug,
          displayName: officerRoles.displayName,
        })
        .from(officerRoles)
        .where(isNull(officerRoles.archivedAt))
        .orderBy(asc(officerRoles.displayOrder), asc(officerRoles.createdAt));
      const people = await app.db
        .select({
          id: users.id,
          displayName: users.displayName,
          image: users.image,
          role: users.role,
        })
        .from(users)
        .where(isNull(users.archivedAt))
        .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
      return { officerRoles: rows, users: people };
    },
  );

  app.get(
    "/entities/:id",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getEntity",
        summary:
          "One entity's full ENT-001 identity card — the record page's " +
          "read; archived entities answer too, so restore stays reachable",
        tags: ["entities"],
        params: z.object({ id: z.string() }),
        response: {
          200: EntityRecordEnvelope,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select({ entity: entities, entityTypeName: entityTypes.displayName })
        .from(entities)
        .innerJoin(entityTypes, eq(entities.entityTypeId, entityTypes.id))
        .where(and(eq(entities.id, request.params.id), entityReachScope(app.db, request.user)))
        .limit(1);
      if (!row) throw httpError(404, NO_ENTITY);
      const attached = await selectAttachedFields(
        app.db,
        entityTypeFields,
        row.entity.entityTypeId,
      );
      return {
        entity: toRow(row.entity, row.entityTypeName),
        fields: attached,
        customFieldRefs: await resolveStaffRefs(
          app.db,
          attached,
          row.entity.customFields ?? {},
          request.user,
        ),
      };
    },
  );

  app.post(
    "/entities",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntity",
        summary:
          "Register an entity with its ENT-001 identity card: legal name " +
          "and type required, the rest optional; status defaults to active",
        tags: ["entities"],
        body: z.object({
          legalName: LegalNameSchema,
          entityTypeId: z.string(),
          jurisdiction: CardTextSchema.optional(),
          formedOn: z.iso.date().optional(),
          registrationNumber: CardTextSchema.optional(),
          taxId: CardTextSchema.optional(),
          registeredAgent: CardTextSchema.optional(),
          registeredAddress: AddressSchema.optional(),
          status: z.enum(ENTITY_STATUSES).optional(),
        }),
        response: {
          201: z.object({ entity: EntityRowSchema }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const { row, entityTypeName } = await app.db.transaction(async (tx) => {
        // Lock the type row so a concurrent archive can't slip between
        // the check and the insert.
        const [entityType] = await tx
          .select({
            id: entityTypes.id,
            displayName: entityTypes.displayName,
            archivedAt: entityTypes.archivedAt,
          })
          .from(entityTypes)
          .where(eq(entityTypes.id, body.entityTypeId))
          .limit(1)
          .for("update");
        if (!entityType || entityType.archivedAt) {
          throw httpError(400, "The entity type must be a live entity type.");
        }

        const [created] = await tx
          .insert(entities)
          .values({
            legalName: body.legalName.trim(),
            entityTypeId: entityType.id,
            jurisdiction: body.jurisdiction?.trim() || null,
            formedOn: body.formedOn ?? null,
            registrationNumber: body.registrationNumber?.trim() || null,
            taxId: body.taxId?.trim() || null,
            registeredAgent: body.registeredAgent?.trim() || null,
            registeredAddress: body.registeredAddress?.trim() || null,
            status: body.status ?? "active",
          })
          .returning();
        // The record's own feed entry (DD-017), atomically with the
        // insert. Legal Only: the registry is a Member+ surface (ENT-004).
        await recordActivity(tx, {
          entityType: "entity",
          entityId: created!.id,
          actorId: request.user.id,
          action: "entity.created",
          visibility: "legal_only",
          payload: {
            legalName: created!.legalName,
            entityType: entityType.displayName,
            status: created!.status,
          },
        });
        return { row: created!, entityTypeName: entityType.displayName };
      });
      return reply.status(201).send({ entity: toRow(row, entityTypeName) });
    },
  );

  app.patch(
    "/entities/:id",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntity",
        summary:
          "Correct any identity-card field in place (DES-017 per-field " +
          "commits): the status only within the fixed ENT-001 enum, the " +
          "type only to a live one, never on an archived entity",
        tags: ["entities"],
        params: z.object({ id: z.string() }),
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          legalName: LegalNameSchema.optional(),
          entityTypeId: z.string().optional(),
          jurisdiction: CardTextSchema.nullable().optional(),
          formedOn: z.iso.date().nullable().optional(),
          registrationNumber: CardTextSchema.nullable().optional(),
          taxId: CardTextSchema.nullable().optional(),
          registeredAgent: CardTextSchema.nullable().optional(),
          registeredAddress: AddressSchema.nullable().optional(),
          status: z.enum(ENTITY_STATUSES).optional(),
          sharesAuthorized: ShareCapitalSchema.nullable().optional(),
          sharesIssued: ShareCapitalSchema.nullable().optional(),
          parValue: ShareCapitalSchema.nullable().optional(),
          customFields: CustomFieldsInput.optional(),
          isConfidential: z.boolean().optional(),
        }),
        response: {
          200: EntityRecordEnvelope,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const body = request.body;
      const { row, entityTypeName, attached } = await app.db.transaction(async (tx) => {
        const target = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!target) throw httpError(404, NO_ENTITY);
        if (target.archivedAt) {
          throw httpError(409, "This entity is archived. Restore it before editing.");
        }

        const [currentType] = await tx
          .select({ displayName: entityTypes.displayName })
          .from(entityTypes)
          .where(eq(entityTypes.id, target.entityTypeId))
          .limit(1);
        let typeName = currentType!.displayName;

        const patch: Partial<Entity> = {};
        /** The DD-017 changed map — old and new values per corrected
         * field, feeding the M9 viewer's narration. */
        const changed: Record<string, { from: unknown; to: unknown }> = {};

        const confidentialityChange =
          body.isConfidential !== undefined && body.isConfidential !== target.isConfidential
            ? body.isConfidential
            : undefined;
        if (confidentialityChange !== undefined) {
          if (request.user.role !== "administrator") {
            throw httpError(403, "Only an Administrator can change Entity confidentiality.");
          }
          patch.isConfidential = confidentialityChange;
        }

        const legalName = body.legalName?.trim();
        if (legalName !== undefined && legalName !== target.legalName) {
          patch.legalName = legalName;
          changed.legalName = { from: target.legalName, to: legalName };
        }

        if (body.entityTypeId !== undefined && body.entityTypeId !== target.entityTypeId) {
          // Lock the type row so a concurrent archive can't slip between
          // the check and the update (same seam as registration).
          const [entityType] = await tx
            .select({
              id: entityTypes.id,
              displayName: entityTypes.displayName,
              archivedAt: entityTypes.archivedAt,
            })
            .from(entityTypes)
            .where(eq(entityTypes.id, body.entityTypeId))
            .limit(1)
            .for("update");
          if (!entityType || entityType.archivedAt) {
            throw httpError(400, "The entity type must be a live entity type.");
          }
          patch.entityTypeId = entityType.id;
          changed.entityType = { from: typeName, to: entityType.displayName };
          typeName = entityType.displayName;
        }

        // Free-text card scalars: blank normalizes to NULL, same as
        // registration; null clears deliberately.
        for (const key of [
          "jurisdiction",
          "registrationNumber",
          "taxId",
          "registeredAgent",
          "registeredAddress",
        ] as const) {
          const value = body[key];
          if (value === undefined) continue;
          const next = value?.trim() || null;
          if (next !== target[key]) {
            patch[key] = next;
            changed[key] = { from: target[key], to: next };
          }
        }

        if (body.formedOn !== undefined && body.formedOn !== target.formedOn) {
          patch.formedOn = body.formedOn;
          changed.formedOn = { from: target.formedOn, to: body.formedOn };
        }

        for (const key of ["sharesAuthorized", "sharesIssued", "parValue"] as const) {
          const next = body[key];
          if (next !== undefined && next !== target[key]) {
            patch[key] = next;
            changed[key] = { from: target[key], to: next };
          }
        }

        const fields = await selectAttachedFields(
          tx,
          entityTypeFields,
          patch.entityTypeId ?? target.entityTypeId,
        );
        const retyped = patch.entityTypeId !== undefined;
        if (body.customFields !== undefined || retyped) {
          const applied = await applyCustomFields(
            tx,
            fields,
            target.customFields ?? {},
            body.customFields ?? {},
          );
          if (retyped) {
            assertRequiredCustomFields(fields, applied.values);
          } else if (body.customFields !== undefined) {
            assertRequiredCustomFields(
              fields.filter((field) => field.slug in body.customFields!),
              applied.values,
            );
          }
          if (Object.keys(applied.changed).length > 0) {
            patch.customFields = applied.values;
            Object.assign(changed, applied.changed);
          }
        }

        // The status keeps its own audit verb (surfaces branch on it,
        // ENT-001) — it rides the same UPDATE but not the changed map.
        const statusChange =
          body.status !== undefined && body.status !== target.status
            ? { from: target.status, to: body.status }
            : undefined;
        if (statusChange) patch.status = statusChange.to;

        // Nothing changed: answer with the row and write no misleading
        // from==to audit entry.
        if (Object.keys(patch).length === 0) {
          return { row: target, entityTypeName: typeName, attached: fields };
        }

        const [updated] = await tx
          .update(entities)
          .set(patch)
          .where(eq(entities.id, target.id))
          .returning();
        const legalNameNow = updated!.legalName;
        if (Object.keys(changed).length > 0) {
          await recordActivity(tx, {
            entityType: "entity",
            entityId: target.id,
            actorId: request.user.id,
            action: "entity.updated",
            visibility: "legal_only",
            payload: { legalName: legalNameNow, changed },
          });
        }
        if (statusChange) {
          await recordActivity(tx, {
            entityType: "entity",
            entityId: target.id,
            actorId: request.user.id,
            action: "entity.status_changed",
            visibility: "legal_only",
            payload: { legalName: legalNameNow, ...statusChange },
          });
        }
        if (confidentialityChange !== undefined) {
          await recordActivity(tx, {
            entityType: "entity",
            entityId: target.id,
            actorId: request.user.id,
            action: confidentialityChange
              ? "entity.confidentiality_set"
              : "entity.confidentiality_cleared",
            visibility: "legal_only",
            payload: { legalName: legalNameNow },
          });
        }
        return { row: updated!, entityTypeName: typeName, attached: fields };
      });
      return {
        entity: toRow(row, entityTypeName),
        fields: attached,
        customFieldRefs: await resolveStaffRefs(
          app.db,
          attached,
          row.customFields ?? {},
          request.user,
        ),
      };
    },
  );

  app.post(
    "/entities/:id/archive",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveEntity",
        summary:
          "Archive an entity (soft delete, ENT-001): it leaves the list " +
          "and the M8 picker; nothing is deleted, and #99's restore is " +
          "the recovery story",
        tags: ["entities"],
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ entity: EntityRowSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { row, entityTypeName } = await app.db.transaction(async (tx) => {
        const target = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!target) throw httpError(404, NO_ENTITY);
        if (target.archivedAt) throw httpError(409, "This entity is already archived.");

        const [updated] = await tx
          .update(entities)
          .set({ archivedAt: new Date() })
          .where(eq(entities.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "entity",
          entityId: target.id,
          actorId: request.user.id,
          action: "entity.archived",
          visibility: "legal_only",
          payload: { legalName: target.legalName },
        });
        const [entityType] = await tx
          .select({ displayName: entityTypes.displayName })
          .from(entityTypes)
          .where(eq(entityTypes.id, target.entityTypeId))
          .limit(1);
        return { row: updated!, entityTypeName: entityType!.displayName };
      });
      return { entity: toRow(row, entityTypeName) };
    },
  );

  app.post(
    "/entities/:id/restore",
    {
      preHandler: requireMember,
      schema: {
        operationId: "restoreEntity",
        summary:
          "Restore an archived entity (archive's recovery story, " +
          "ENT-001): it rejoins the list and the M8 picker",
        tags: ["entities"],
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ entity: EntityRowSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { row, entityTypeName } = await app.db.transaction(async (tx) => {
        const target = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!target) throw httpError(404, NO_ENTITY);
        if (!target.archivedAt) throw httpError(409, "This entity is not archived.");

        const [updated] = await tx
          .update(entities)
          .set({ archivedAt: null })
          .where(eq(entities.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "entity",
          entityId: target.id,
          actorId: request.user.id,
          action: "entity.restored",
          visibility: "legal_only",
          payload: { legalName: target.legalName },
        });
        const [entityType] = await tx
          .select({ displayName: entityTypes.displayName })
          .from(entityTypes)
          .where(eq(entityTypes.id, target.entityTypeId))
          .limit(1);
        return { row: updated!, entityTypeName: entityType!.displayName };
      });
      return { entity: toRow(row, entityTypeName) };
    },
  );
};
