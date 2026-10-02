// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Holdings and the org-chart projection (ENT-003). Both routes read: a
 * Holding is written only by the share register's projection (ENT-012).
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  alias,
  and,
  asc,
  entities,
  entityHoldings,
  individualHoldings,
  entityTypes,
  entityRegisterParties,
  entityTrustEntries,
  TRUST_ROLES,
  inArray,
  ENTITY_STATUSES,
  eq,
  isNull,
  or,
  sql,
  type Executor,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { entityReachScope, NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

import { replayTrustRegister } from "../../lib/trust-register.js";
import { todayIsoDate } from "../../lib/share-register.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdParams = z.object({ id: z.string().min(1).max(64) });

const HoldingEntitySchema = z.discriminatedUnion("restricted", [
  z.object({
    restricted: z.literal(false),
    id: z.string(),
    legalName: z.string(),
    kind: z.literal("individual").optional(),
  }),
  z.object({ restricted: z.literal(true) }),
]);
const HoldingSchema = z.object({
  owner: HoldingEntitySchema,
  owned: HoldingEntitySchema,
  ownershipPercent: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const HoldingEnvelope = z.object({
  owners: z.array(HoldingSchema),
  owned: z.array(HoldingSchema),
});

const ChartNodeSchema = z.union([
  z.object({
    restricted: z.literal(false),
    id: z.string(),
    legalName: z.string(),
    kind: z.literal("party"),
    partyKind: z.enum(["individual", "class"]),
    trustEntityId: z.string(),
    type: z.string(),
    jurisdiction: z.string().nullable(),
    status: z.enum(ENTITY_STATUSES).nullable(),
    primaryOwnerId: z.string().nullable(),
  }),
  z.object({
    restricted: z.literal(false),
    id: z.string(),
    legalName: z.string(),
    type: z.string(),
    jurisdiction: z.string().nullable(),
    status: z.enum(ENTITY_STATUSES).nullable(),
    kind: z.literal("individual").optional(),
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

const RoleEdgeSchema = z.object({
  partyNodeId: z.string(),
  trustEntityId: z.string(),
  role: z.enum(TRUST_ROLES),
  roleLabel: z.string().nullable(),
});
const BranchEdgeSchema = z.object({
  headOfficeEntityId: z.string(),
  branchEntityId: z.string(),
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

const INDIVIDUAL_PREFIX = "individual:";
function individualProjection(db: Executor) {
  return db
    .select({
      id: individualHoldings.id,
      name: individualHoldings.name,
      ownedId: entities.id,
      ownedName: entities.legalName,
      ownershipPercent: individualHoldings.ownershipPercent,
      createdAt: individualHoldings.createdAt,
      updatedAt: individualHoldings.updatedAt,
    })
    .from(individualHoldings)
    .innerJoin(entities, eq(individualHoldings.ownedEntityId, entities.id));
}
type IndividualProjection = Awaited<ReturnType<typeof individualProjection>>[number];
function toIndividualHolding(row: IndividualProjection) {
  return {
    owner: {
      restricted: false as const,
      id: INDIVIDUAL_PREFIX + row.id,
      legalName: row.name,
      kind: "individual" as const,
    },
    owned: { restricted: false as const, id: row.ownedId, legalName: row.ownedName },
    ownershipPercent: Number(row.ownershipPercent),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
          200: z.object({
            nodes: z.array(ChartNodeSchema),
            edges: z.array(ChartEdgeSchema),
            roleEdges: z.array(RoleEdgeSchema),
            branchEdges: z.array(BranchEdgeSchema),
          }),
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
          registerKind: sql<string>`coalesce(${entities.registerKind}, ${entityTypes.registerKind})`,
          headOfficeEntityId: entities.headOfficeEntityId,
        })
        .from(entities)
        .innerJoin(entityTypes, eq(entities.entityTypeId, entityTypes.id))
        .where(isNull(entities.archivedAt))
        .orderBy(asc(sql`lower(${entities.legalName})`), asc(entities.id));
      // ENT-003: the chart draws live Entities only, as the registry count
      // does. An archived Entity, and every link that touches it, is left
      // out until it is restored.
      const live = new Set(allNodes.map((node) => node.id));
      const visible = new Set(
        [...(await reachableIds(app.db, request.user))].filter((id) => live.has(id)),
      );
      const allHoldings = (await holdingProjection(app.db)).filter(
        (row) => live.has(row.ownerId) && live.has(row.ownedId),
      );
      const individuals = await individualProjection(app.db).where(
        and(isNull(entities.archivedAt), entityReachScope(app.db, request.user)),
      );
      const individualNodes = individuals.map((row) => ({
        id: INDIVIDUAL_PREFIX + row.id,
        legalName: row.name,
        type: "Individual",
        kind: "individual" as const,
        jurisdiction: null,
        status: null,
      }));
      for (const row of individuals) visible.add(INDIVIDUAL_PREFIX + row.id);
      allHoldings.push(
        ...individuals.map((row) => ({
          ownerId: INDIVIDUAL_PREFIX + row.id,
          ownerName: row.name,
          ownedId: row.ownedId,
          ownedName: row.ownedName,
          ownershipPercent: row.ownershipPercent,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      );
      const included = new Set(visible);
      for (const row of allHoldings) {
        if (visible.has(row.ownerId) || visible.has(row.ownedId)) {
          included.add(row.ownerId);
          included.add(row.ownedId);
        }
      }
      const branchEdges = allNodes
        .filter(
          (node) =>
            visible.has(node.id) &&
            node.registerKind === "none" &&
            node.headOfficeEntityId &&
            live.has(node.headOfficeEntityId),
        )
        .map((node) => ({ headOfficeEntityId: node.headOfficeEntityId!, branchEntityId: node.id }));
      for (const edge of branchEdges) included.add(edge.headOfficeEntityId);
      const trustIds = allNodes
        .filter((node) => visible.has(node.id) && node.registerKind === "trust")
        .map((node) => node.id);
      const roleEdges: z.infer<typeof RoleEdgeSchema>[] = [];
      const partyNodes: z.infer<typeof ChartNodeSchema>[] = [];
      if (trustIds.length) {
        const parties = await app.db
          .select()
          .from(entityRegisterParties)
          .where(inArray(entityRegisterParties.entityId, trustIds));
        const entries = await app.db
          .select()
          .from(entityTrustEntries)
          .where(inArray(entityTrustEntries.entityId, trustIds));
        const today = todayIsoDate();
        for (const trustEntityId of trustIds) {
          const trustParties = parties.filter((party) => party.entityId === trustEntityId);
          const replay = replayTrustRegister(
            {
              parties: trustParties,
              entries: entries.filter((entry) => entry.entityId === trustEntityId),
            },
            today,
          );
          const openRoles = replay.roles.filter((role) => role.open);
          for (const party of trustParties) {
            const roles = openRoles.filter((role) => role.partyId === party.id);
            if (!roles.length) continue;
            if (party.kind === "entity" && !live.has(party.partyEntityId!)) continue;
            const partyNodeId =
              party.kind === "entity" ? party.partyEntityId! : `party:${party.id}`;
            if (party.kind === "entity") included.add(partyNodeId);
            else
              partyNodes.push({
                restricted: false,
                id: partyNodeId,
                kind: "party",
                partyKind: party.kind,
                trustEntityId,
                legalName: party.name ?? party.description!,
                type: party.kind === "class" ? "Class" : "Individual",
                jurisdiction: null,
                status: null,
                primaryOwnerId: null,
              });
            roleEdges.push(
              ...roles.map(({ role, roleLabel }) => ({
                partyNodeId,
                trustEntityId,
                role,
                roleLabel,
              })),
            );
          }
        }
      }
      const nodes = [
        ...allNodes.map(({ id, legalName, type, jurisdiction, status }) => ({
          id,
          legalName,
          type,
          jurisdiction,
          status,
        })),
        ...individualNodes,
      ].filter((node) => included.has(node.id));
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
        nodes: [
          ...nodes.map((node) => {
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
            const primaryOwnerId =
              owners[0]?.ownerId ??
              branchEdges.find((edge) => edge.branchEntityId === node.id)?.headOfficeEntityId ??
              null;
            return visible.has(node.id)
              ? { restricted: false as const, ...node, primaryOwnerId }
              : { restricted: true as const, id: node.id, primaryOwnerId };
          }),
          ...partyNodes,
        ],
        roleEdges,
        branchEdges,
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
      const individualOwners = await individualProjection(app.db).where(
        eq(individualHoldings.ownedEntityId, entity.id),
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
        owners: [...owners, ...individualOwners.map(toIndividualHolding)].sort((a, b) =>
          (a.owner.restricted ? "" : a.owner.legalName).localeCompare(
            b.owner.restricted ? "" : b.owner.legalName,
          ),
        ),
        owned,
      };
    },
  );
};
