// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry routes (ENT-001/ENT-004, #98): list and create
 * for the registry core, plus the type-picker read and the archive
 * cleanup seam. Everything here is Member+ — Administrators and Legal
 * Team Members equally, read and write — the first Member+ surface in
 * the codebase; Contributors, Business Users, and unauthenticated
 * requests get nothing (ENT-004). The list is the seam the M8
 * signing-entity picker consumes: ordered by legal name, archived rows
 * excluded unless asked for. Every mutation appends to the activity
 * log in the same transaction (DD-017). Update and restore, and every
 * record-page surface, are #99.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  asc,
  entities,
  entityTypes,
  eq,
  isNull,
  sql,
  ENTITY_STATUSES,
  type Entity,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** ENT-004's access floor: the whole registry is Member+. */
const requireMember = requireRole("administrator", "legal_team_member");

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
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** The Member+ readable slice of an entity type — the register form's
 * picker source (GET /entity-types itself is Administrator-only per
 * SET-002, so the registry surface carries its own read). */
const EntityTypeOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

const LegalNameSchema = z.string().trim().min(1).max(200);
/** Free-text card scalars; empty strings normalize to NULL on write. */
const CardTextSchema = z.string().trim().max(200);
const AddressSchema = z.string().trim().max(500);

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
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const entitiesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntities",
        summary:
          "The registry, ordered by legal name (ENT-001) — the seam the " +
          "M8 signing-entity picker consumes; archived rows only with " +
          "includeArchived=true",
        tags: ["entities"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: {
          200: z.object({ entities: z.array(EntityRowSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await app.db
        .select({ entity: entities, entityTypeName: entityTypes.displayName })
        .from(entities)
        .innerJoin(entityTypes, eq(entities.entityTypeId, entityTypes.id))
        .where(request.query.includeArchived === "true" ? undefined : isNull(entities.archivedAt))
        // Case-insensitive: "iMobile Ltd" files under I, wherever the
        // default collation would put it. Creation order breaks ties.
        .orderBy(asc(sql`lower(${entities.legalName})`), asc(entities.createdAt));
      return { entities: rows.map((row) => toRow(row.entity, row.entityTypeName)) };
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
        const [target] = await tx
          .select()
          .from(entities)
          .where(eq(entities.id, request.params.id))
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No entity exists with this id.");
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
};
