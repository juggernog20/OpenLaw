// SPDX-License-Identifier: AGPL-3.0-only

/** Administrator-only maintenance of ENT-004's explicit Entity readers. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  entityGrants,
  eq,
  isNull,
  sql,
  users,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { NO_ENTITY, reachedEntity, type LockedEntity } from "../../lib/entity-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const requireAdministrator = requireRole("administrator");
const EntityParams = z.object({ id: z.string().min(1).max(64) });
const GrantParams = EntityParams.extend({ userId: z.string().min(1).max(64) });
const GrantPersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});
const GrantEnvelope = z.object({
  grants: z.array(GrantPersonSchema),
  candidates: z.array(GrantPersonSchema),
});

async function lockedEntity(
  tx: Transaction,
  user: Parameters<typeof reachedEntity>[1],
  id: string,
) {
  const entity = await reachedEntity(tx, user, id, { lock: true });
  if (!entity) throw httpError(404, NO_ENTITY);
  if (entity.archivedAt) {
    throw httpError(409, "This entity is archived. Restore it before changing grants.");
  }
  return entity;
}

async function grantRows(db: Executor, entityId: string) {
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    })
    .from(entityGrants)
    .innerJoin(users, eq(users.id, entityGrants.userId))
    .where(eq(entityGrants.entityId, entityId))
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
}

const toPerson = (row: Awaited<ReturnType<typeof grantRows>>[number]) => ({
  id: row.id,
  displayName: row.displayName,
  image: row.image,
  archived: row.archivedAt !== null,
});

export const entityGrantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/:id/grants",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "listEntityGrants",
        tags: ["entities"],
        params: EntityParams,
        response: { 200: GrantEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      const [grants, candidates] = await Promise.all([
        grantRows(app.db, entity.id),
        app.db
          .select({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
          })
          .from(users)
          .where(and(eq(users.role, "legal_team_member"), isNull(users.archivedAt)))
          .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id)),
      ]);
      return { grants: grants.map(toPerson), candidates: candidates.map(toPerson) };
    },
  );

  app.post(
    "/entities/:id/grants",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "addEntityGrant",
        tags: ["entities"],
        params: EntityParams,
        body: z.strictObject({ userId: z.string().min(1).max(64) }),
        response: { 201: z.object({ grant: GrantPersonSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const person = await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, request.body.userId))
          .limit(1)
          .for("update");
        if (!target || target.archivedAt || target.role !== "legal_team_member") {
          throw httpError(400, "An Entity grant must name a live Legal Team Member.");
        }
        const inserted = await tx
          .insert(entityGrants)
          .values({ entityId: entity.id, userId: target.id })
          .onConflictDoNothing()
          .returning({ userId: entityGrants.userId });
        if (inserted.length === 0) throw httpError(409, "This person already has an Entity grant.");
        await recordGrant(tx, entity, target, request.user.id, "entity_grant.added");
        return target;
      });
      return reply.status(201).send({ grant: toPerson(person) });
    },
  );

  app.delete(
    "/entities/:id/grants/:userId",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "removeEntityGrant",
        tags: ["entities"],
        params: GrantParams,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select({ id: users.id, displayName: users.displayName })
          .from(entityGrants)
          .innerJoin(users, eq(users.id, entityGrants.userId))
          .where(
            and(
              eq(entityGrants.entityId, entity.id),
              eq(entityGrants.userId, request.params.userId),
            ),
          )
          .limit(1)
          .for("update", { of: entityGrants });
        if (!target) throw httpError(404, "No Entity grant exists for this person.");
        await tx
          .delete(entityGrants)
          .where(and(eq(entityGrants.entityId, entity.id), eq(entityGrants.userId, target.id)));
        await recordGrant(tx, entity, target, request.user.id, "entity_grant.removed");
      });
      return reply.status(204).send(null);
    },
  );
};

async function recordGrant(
  tx: Transaction,
  entity: LockedEntity,
  person: { id: string; displayName: string },
  actorId: string,
  action: "entity_grant.added" | "entity_grant.removed",
) {
  await recordActivity(tx, {
    entityType: "entity",
    entityId: entity.id,
    actorId,
    action,
    visibility: "admin_only",
    payload: {
      legalName: entity.legalName,
      userId: person.id,
      userName: person.displayName,
    },
  });
}
