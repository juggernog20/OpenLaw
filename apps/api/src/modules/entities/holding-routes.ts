// SPDX-License-Identifier: AGPL-3.0-only

/** Holdings and the org-chart projection (ENT-003). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ADVISORY_LOCK,
  alias,
  and,
  asc,
  entities,
  entityHoldings,
  entityTypes,
  ENTITY_STATUSES,
  eq,
  inArray,
  or,
  sql,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { ENTITY_HOLDING_CYCLE_PROBLEM_TYPE } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { entityReachScope, NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdParams = z.object({ id: z.string().min(1).max(64) });
const RelatedParams = IdParams.extend({ relatedEntityId: z.string().min(1).max(64) });
const PercentSchema = z.number().min(0).max(100);

const HoldingEntitySchema = z.discriminatedUnion("restricted", [
  z.object({ restricted: z.literal(false), id: z.string(), legalName: z.string() }),
  z.object({ restricted: z.literal(true) }),
]);
const HoldingSchema = z.object({
  owner: HoldingEntitySchema,
  owned: HoldingEntitySchema,
  ownershipPercent: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const HoldingWarningSchema = z.object({
  code: z.literal("ownership-over-100"),
  ownedEntityId: z.string(),
  legalName: z.string(),
  totalPercent: z.number(),
});
const HoldingEnvelope = z.object({
  owners: z.array(HoldingSchema),
  owned: z.array(HoldingSchema),
  warnings: z.array(HoldingWarningSchema),
});
const HoldingWriteEnvelope = z.object({
  holding: HoldingSchema,
  warnings: z.array(HoldingWarningSchema),
});

const ChartNodeSchema = z.discriminatedUnion("restricted", [
  z.object({
    restricted: z.literal(false),
    id: z.string(),
    legalName: z.string(),
    type: z.string(),
    jurisdiction: z.string().nullable(),
    status: z.enum(ENTITY_STATUSES),
    primaryOwnerId: z.string().nullable(),
  }),
  z.object({
    restricted: z.literal(true),
    id: z.string(),
    primaryOwnerId: z.string().nullable(),
  }),
]);
const ChartEdgeSchema = z.object({
  ownerEntityId: z.string(),
  ownedEntityId: z.string(),
  ownershipPercent: z.number(),
});

const ownerEntities = alias(entities, "holding_owner_entities");
const ownedEntities = alias(entities, "holding_owned_entities");

function holdingProjection(db: Executor) {
  return db
    .select({
      ownerId: ownerEntities.id,
      ownerName: ownerEntities.legalName,
      ownedId: ownedEntities.id,
      ownedName: ownedEntities.legalName,
      ownershipPercent: entityHoldings.ownershipPercent,
      createdAt: entityHoldings.createdAt,
      updatedAt: entityHoldings.updatedAt,
    })
    .from(entityHoldings)
    .innerJoin(ownerEntities, eq(entityHoldings.ownerEntityId, ownerEntities.id))
    .innerJoin(ownedEntities, eq(entityHoldings.ownedEntityId, ownedEntities.id));
}

type HoldingProjection = Awaited<ReturnType<typeof holdingProjection>>[number];

function toHolding(row: HoldingProjection, visible?: ReadonlySet<string>) {
  const entity = (id: string, legalName: string) =>
    visible && !visible.has(id)
      ? ({ restricted: true } as const)
      : ({ restricted: false, id, legalName } as const);
  return {
    owner: entity(row.ownerId, row.ownerName),
    owned: entity(row.ownedId, row.ownedName),
    ownershipPercent: Number(row.ownershipPercent),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function reachableIds(db: Executor, user: Parameters<typeof entityReachScope>[1]) {
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(entityReachScope(db, user));
  return new Set(rows.map((row) => row.id));
}

async function warningsFor(db: Executor, ownedIds: readonly string[]) {
  if (ownedIds.length === 0) return [];
  const rows = await db
    .select({
      ownedEntityId: entityHoldings.ownedEntityId,
      legalName: entities.legalName,
      totalPercent: sql<string>`sum(${entityHoldings.ownershipPercent})`,
    })
    .from(entityHoldings)
    .innerJoin(entities, eq(entityHoldings.ownedEntityId, entities.id))
    .where(inArray(entityHoldings.ownedEntityId, [...new Set(ownedIds)]))
    .groupBy(entityHoldings.ownedEntityId, entities.legalName)
    .having(sql`sum(${entityHoldings.ownershipPercent}) > 100`)
    .orderBy(asc(sql`lower(${entities.legalName})`), asc(entityHoldings.ownedEntityId));
  return rows.map((row) => ({
    code: "ownership-over-100" as const,
    ownedEntityId: row.ownedEntityId,
    legalName: row.legalName,
    totalPercent: Number(row.totalPercent),
  }));
}

async function holdingByPair(db: Executor, ownerId: string, ownedId: string) {
  const [row] = await holdingProjection(db)
    .where(
      and(eq(entityHoldings.ownerEntityId, ownerId), eq(entityHoldings.ownedEntityId, ownedId)),
    )
    .limit(1);
  return row ?? null;
}

async function holdingBeside(db: Executor, entityId: string, relatedEntityId: string) {
  const [row] = await holdingProjection(db)
    .where(
      or(
        and(
          eq(entityHoldings.ownerEntityId, entityId),
          eq(entityHoldings.ownedEntityId, relatedEntityId),
        ),
        and(
          eq(entityHoldings.ownerEntityId, relatedEntityId),
          eq(entityHoldings.ownedEntityId, entityId),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The write envelope, read while the advisory lock is still held. Reading
 * after commit would race a concurrent delete of the same pair and turn a
 * write that landed into a 500; the warnings would also describe another
 * writer's totals.
 */
async function writtenHolding(tx: Transaction, ownerId: string, ownedId: string) {
  const holding = await holdingByPair(tx, ownerId, ownedId);
  if (!holding) throw new Error("The written Holding could not be read.");
  return { holding: toHolding(holding), warnings: await warningsFor(tx, [ownedId]) };
}

/** Finds an existing path from `start` to `target`, following ownership downwards. */
function ownershipPath(
  rows: readonly { ownerEntityId: string; ownedEntityId: string }[],
  start: string,
  target: string,
): string[] | null {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const held = children.get(row.ownerEntityId) ?? [];
    held.push(row.ownedEntityId);
    children.set(row.ownerEntityId, held);
  }
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path.at(-1)!;
    if (last === target) return path;
    for (const child of children.get(last) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push([...path, child]);
      }
    }
  }
  return null;
}

/** The loop may pass through an Entity the writer cannot reach. That
 * link still names it only as Restricted Entity (ENT-004). */
async function assertNoCycle(
  tx: Transaction,
  user: Parameters<typeof entityReachScope>[1],
  ownerId: string,
  ownedId: string,
) {
  const rows = await tx
    .select({
      ownerEntityId: entityHoldings.ownerEntityId,
      ownedEntityId: entityHoldings.ownedEntityId,
    })
    .from(entityHoldings);
  const path = ownershipPath(rows, ownedId, ownerId);
  if (!path) return;
  const loopIds = [ownerId, ...path];
  const names = await tx
    .select({ id: entities.id, legalName: entities.legalName })
    .from(entities)
    .where(and(inArray(entities.id, [...new Set(loopIds)]), entityReachScope(tx, user)));
  const byId = new Map(names.map((row) => [row.id, row.legalName]));
  const loop = loopIds.map((id) => byId.get(id) ?? "Restricted Entity").join(" → ");
  throw httpError(409, `This holding would create a loop: ${loop}.`, {
    type: ENTITY_HOLDING_CYCLE_PROBLEM_TYPE,
  });
}

function assertEditable(entity: { archivedAt: Date | null }) {
  if (entity.archivedAt) {
    throw httpError(409, "This entity is archived. Restore it before changing Holdings.");
  }
}

async function recordHoldingActivity(
  tx: Transaction,
  input: Readonly<
    {
      actorId: string;
      ownerId: string;
      ownerName: string;
      ownedId: string;
      ownedName: string;
    } & (
      | { action: "entity_holding.updated"; from: number; to: number }
      | { action: "entity_holding.created" | "entity_holding.deleted"; ownershipPercent: number }
    )
  >,
) {
  for (const [entityId, legalName] of [
    [input.ownerId, input.ownerName],
    [input.ownedId, input.ownedName],
  ] as const) {
    const common = {
      entityType: "entity" as const,
      entityId,
      actorId: input.actorId,
      action: input.action,
      visibility: "legal_only" as const,
    };
    if (input.action === "entity_holding.updated") {
      await recordActivity(tx, {
        ...common,
        action: input.action,
        payload: {
          legalName,
          ownerName: input.ownerName,
          ownedName: input.ownedName,
          from: input.from,
          to: input.to,
        },
      });
    } else {
      await recordActivity(tx, {
        ...common,
        action: input.action,
        payload: {
          legalName,
          ownerName: input.ownerName,
          ownedName: input.ownedName,
          ownershipPercent: input.ownershipPercent,
        },
      });
    }
  }
}

export const entityHoldingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/chart",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getEntityChart",
        tags: ["entities"],
        response: {
          200: z.object({ nodes: z.array(ChartNodeSchema), edges: z.array(ChartEdgeSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const allNodes = await app.db
        .select({
          id: entities.id,
          legalName: entities.legalName,
          type: entityTypes.displayName,
          jurisdiction: entities.jurisdiction,
          status: entities.status,
        })
        .from(entities)
        .innerJoin(entityTypes, eq(entities.entityTypeId, entityTypes.id))
        .orderBy(asc(sql`lower(${entities.legalName})`), asc(entities.id));
      const visible = await reachableIds(app.db, request.user);
      const allHoldings = await holdingProjection(app.db);
      const included = new Set(visible);
      for (const row of allHoldings) {
        if (visible.has(row.ownerId) || visible.has(row.ownedId)) {
          included.add(row.ownerId);
          included.add(row.ownedId);
        }
      }
      const nodes = allNodes.filter((node) => included.has(node.id));
      // An edge is drawn only when the viewer reaches one of its ends. A
      // link between two walled Entities is topology the viewer may not
      // learn, even when each end touches something they can see.
      const projected = allHoldings.filter(
        (row) => visible.has(row.ownerId) || visible.has(row.ownedId),
      );
      const ownerName = new Map(
        nodes.filter((node) => visible.has(node.id)).map((node) => [node.id, node.legalName]),
      );
      const byOwned = new Map<string, HoldingProjection[]>();
      for (const row of projected) {
        const held = byOwned.get(row.ownedId) ?? [];
        held.push(row);
        byOwned.set(row.ownedId, held);
      }
      return {
        nodes: nodes.map((node) => {
          const owners = byOwned.get(node.id) ?? [];
          owners.sort(
            (a, b) =>
              Number(b.ownershipPercent) - Number(a.ownershipPercent) ||
              (ownerName.get(a.ownerId) ?? "").localeCompare(
                ownerName.get(b.ownerId) ?? "",
                undefined,
                {
                  sensitivity: "base",
                },
              ) ||
              a.ownerId.localeCompare(b.ownerId),
          );
          const primaryOwnerId = owners[0]?.ownerId ?? null;
          return visible.has(node.id)
            ? { restricted: false as const, ...node, primaryOwnerId }
            : { restricted: true as const, id: node.id, primaryOwnerId };
        }),
        edges: projected.map((row) => ({
          ownerEntityId: row.ownerId,
          ownedEntityId: row.ownedId,
          ownershipPercent: Number(row.ownershipPercent),
        })),
      };
    },
  );

  app.get(
    "/entities/:id/holdings",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityHoldings",
        tags: ["entities"],
        params: IdParams,
        response: { 200: HoldingEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      const visible = await reachableIds(app.db, request.user);
      const rows = await holdingProjection(app.db).where(
        or(
          eq(entityHoldings.ownerEntityId, entity.id),
          eq(entityHoldings.ownedEntityId, entity.id),
        ),
      );
      const owners = rows
        .filter((row) => row.ownedId === entity.id)
        .sort((a, b) => a.ownerName.localeCompare(b.ownerName))
        .map((row) => toHolding(row, visible));
      const owned = rows
        .filter((row) => row.ownerId === entity.id)
        .sort((a, b) => a.ownedName.localeCompare(b.ownedName))
        .map((row) => toHolding(row, visible));
      return {
        owners,
        owned,
        warnings: await warningsFor(app.db, [
          entity.id,
          ...owned.flatMap((row) => (row.owned.restricted ? [] : [row.owned.id])),
        ]),
      };
    },
  );

  app.post(
    "/entities/:id/holdings",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityHolding",
        tags: ["entities"],
        params: IdParams,
        body: z.strictObject({
          direction: z.enum(["owner", "owned"]),
          relatedEntityId: z.string().min(1).max(64),
          ownershipPercent: PercentSchema,
        }),
        response: { 201: HoldingWriteEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const written = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        const anchor = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!anchor) throw httpError(404, NO_ENTITY);
        const related = await reachedEntity(tx, request.user, request.body.relatedEntityId, {
          lock: true,
        });
        if (!related) throw httpError(400, "Pick a live Entity from the registry.");
        assertEditable(anchor);
        assertEditable(related);
        if (anchor.id === related.id) {
          throw httpError(400, "An Entity cannot own itself.");
        }
        const owner = request.body.direction === "owner" ? related : anchor;
        const owned = request.body.direction === "owned" ? related : anchor;
        if (await holdingByPair(tx, owner.id, owned.id)) {
          throw httpError(409, "These Entities already have this Holding.");
        }
        await assertNoCycle(tx, request.user, owner.id, owned.id);
        await tx.insert(entityHoldings).values({
          ownerEntityId: owner.id,
          ownedEntityId: owned.id,
          ownershipPercent: String(request.body.ownershipPercent),
        });
        await recordHoldingActivity(tx, {
          action: "entity_holding.created",
          actorId: request.user.id,
          ownerId: owner.id,
          ownerName: owner.legalName,
          ownedId: owned.id,
          ownedName: owned.legalName,
          ownershipPercent: request.body.ownershipPercent,
        });
        return writtenHolding(tx, owner.id, owned.id);
      });
      return reply.status(201).send(written);
    },
  );

  app.patch(
    "/entities/:id/holdings/:relatedEntityId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityHolding",
        tags: ["entities"],
        params: RelatedParams,
        body: z.strictObject({ ownershipPercent: PercentSchema }),
        response: { 200: HoldingWriteEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        const anchor = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!anchor) throw httpError(404, NO_ENTITY);
        assertEditable(anchor);
        const row = await holdingBeside(tx, anchor.id, request.params.relatedEntityId);
        if (!row) throw httpError(404, "No Holding exists between these Entities.");
        const related = await reachedEntity(tx, request.user, request.params.relatedEntityId, {
          lock: true,
        });
        if (!related) throw httpError(404, "No Holding exists between these Entities.");
        assertEditable(related);
        const from = Number(row.ownershipPercent);
        if (from !== request.body.ownershipPercent) {
          await tx
            .update(entityHoldings)
            .set({ ownershipPercent: String(request.body.ownershipPercent), updatedAt: new Date() })
            .where(
              and(
                eq(entityHoldings.ownerEntityId, row.ownerId),
                eq(entityHoldings.ownedEntityId, row.ownedId),
              ),
            );
          await recordHoldingActivity(tx, {
            action: "entity_holding.updated",
            actorId: request.user.id,
            ownerId: row.ownerId,
            ownerName: row.ownerName,
            ownedId: row.ownedId,
            ownedName: row.ownedName,
            from,
            to: request.body.ownershipPercent,
          });
        }
        return writtenHolding(tx, row.ownerId, row.ownedId);
      });
    },
  );

  app.delete(
    "/entities/:id/holdings/:relatedEntityId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityHolding",
        tags: ["entities"],
        params: RelatedParams,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
        const anchor = await reachedEntity(tx, request.user, request.params.id, { lock: true });
        if (!anchor) throw httpError(404, NO_ENTITY);
        assertEditable(anchor);
        const row = await holdingBeside(tx, anchor.id, request.params.relatedEntityId);
        if (!row) throw httpError(404, "No Holding exists between these Entities.");
        const related = await reachedEntity(tx, request.user, request.params.relatedEntityId, {
          lock: true,
        });
        if (!related) throw httpError(404, "No Holding exists between these Entities.");
        assertEditable(related);
        await tx
          .delete(entityHoldings)
          .where(
            and(
              eq(entityHoldings.ownerEntityId, row.ownerId),
              eq(entityHoldings.ownedEntityId, row.ownedId),
            ),
          );
        await recordHoldingActivity(tx, {
          action: "entity_holding.deleted",
          actorId: request.user.id,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          ownedId: row.ownedId,
          ownedName: row.ownedName,
          ownershipPercent: Number(row.ownershipPercent),
        });
      });
      return reply.status(204).send(null);
    },
  );
};
