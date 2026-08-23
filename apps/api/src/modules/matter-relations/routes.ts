// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-015's Matter hierarchy, related links, picker, and relationship writes. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  matterRelations,
  matters,
  matterStatuses,
  ne,
  or,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import {
  MATTER_PARENT_CYCLE_PROBLEM_TYPE,
  MATTER_RELATION_EXISTS_PROBLEM_TYPE,
  MATTER_SELF_RELATION_PROBLEM_TYPE,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import {
  relateMatters,
  removeMatterParent,
  setMatterParent,
  unrelateMatters,
} from "../../lib/matter-relations.js";
import { escapeLikePattern } from "../../lib/like.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";

const requireReader = requireRole("administrator", "legal_team_member", "contributor");
const requireMember = requireRole("administrator", "legal_team_member");
const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const RestrictedMatterSchema = z.object({ restricted: z.literal(true) });
const ReachableMatterSchema = z.object({
  restricted: z.literal(false),
  number: z.number().int(),
  title: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(["open", "closed"]),
});
const RelativeSchema = z.union([RestrictedMatterSchema, ReachableMatterSchema]);
const RelationsEnvelope = z.object({
  parent: RelativeSchema.nullable(),
  children: z.array(RelativeSchema),
  related: z.array(RelativeSchema),
});
type Relative = z.infer<typeof RelativeSchema>;

interface RelativeRow {
  id: string;
  number: number;
  title: string;
  statusName: string;
  statusCategory: "open" | "closed";
}

async function liveIds(db: Executor, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: matters.id })
    .from(matters)
    .where(and(inArray(matters.id, [...ids]), isNull(matters.archivedAt)));
  return new Set(rows.map((row) => row.id));
}

async function reachableRelatives(
  db: Executor,
  user: AuthenticatedUser,
  ids: readonly string[],
): Promise<Map<string, RelativeRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: matters.id,
      number: matters.number,
      title: matters.title,
      statusName: matterStatuses.displayName,
      statusCategory: matterStatuses.category,
    })
    .from(matters)
    .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
    .where(
      and(inArray(matters.id, [...ids]), isNull(matters.archivedAt), matterTeamScope(db, user)),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

function relative(rows: Map<string, RelativeRow>, id: string): Relative {
  const row = rows.get(id);
  return row
    ? {
        restricted: false,
        number: row.number,
        title: row.title,
        statusName: row.statusName,
        statusCategory: row.statusCategory,
      }
    : { restricted: true };
}

async function buildRelations(
  db: Executor,
  user: AuthenticatedUser,
  matterId: string,
): Promise<z.infer<typeof RelationsEnvelope>> {
  const [anchor] = await db
    .select({ parentId: matters.parentId })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  const children = await db
    .select({ id: matters.id })
    .from(matters)
    .where(and(eq(matters.parentId, matterId), isNull(matters.archivedAt)))
    .orderBy(asc(matters.number));
  const links = await db
    .select({
      matterAId: matterRelations.matterAId,
      matterBId: matterRelations.matterBId,
    })
    .from(matterRelations)
    .where(or(eq(matterRelations.matterAId, matterId), eq(matterRelations.matterBId, matterId)))
    .orderBy(asc(matterRelations.createdAt), asc(matterRelations.matterAId));
  const relatedIds = links.map((row) =>
    row.matterAId === matterId ? row.matterBId : row.matterAId,
  );
  const possible = [
    ...new Set([
      ...(anchor?.parentId ? [anchor.parentId] : []),
      ...children.map((row) => row.id),
      ...relatedIds,
    ]),
  ];
  const live = await liveIds(db, possible);
  const visibleIds = possible.filter((id) => live.has(id));
  const reachable = await reachableRelatives(db, user, visibleIds);

  return {
    parent:
      anchor?.parentId && live.has(anchor.parentId) ? relative(reachable, anchor.parentId) : null,
    children: children.map((row) => relative(reachable, row.id)),
    related: relatedIds.filter((id) => live.has(id)).map((id) => relative(reachable, id)),
  };
}

interface LockedEnd {
  id: string;
  number: number;
  title: string;
  parentId: string | null;
  archivedAt: Date | null;
}

async function lockedPair(
  tx: Transaction,
  firstNumber: number,
  secondNumber: number,
  user: AuthenticatedUser,
): Promise<{ first: LockedEnd; second: LockedEnd }> {
  const ordered =
    firstNumber <= secondNumber ? [firstNumber, secondNumber] : [secondNumber, firstNumber];
  const lock = async (number: number): Promise<LockedEnd> => {
    const row = await reachedMatter(tx, user, number, { lock: true });
    if (!row) throw httpError(404, NO_MATTER);
    if (row.archivedAt) throw httpError(409, "This Matter is archived. Restore it before editing.");
    return row;
  };
  const lower = await lock(ordered[0]!);
  const upper = ordered[0] === ordered[1] ? lower : await lock(ordered[1]!);
  return firstNumber <= secondNumber
    ? { first: lower, second: upper }
    : { first: upper, second: lower };
}

export const matterRelationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/matters/:number/relations",
    {
      preHandler: requireReader,
      schema: {
        operationId: "getMatterRelations",
        summary: "The Matter's parent, children, and undirected related Matters (MTR-015)",
        tags: ["matter-relations"],
        params: NumberParams,
        response: { 200: RelationsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const anchor = await reachedMatter(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_MATTER);
      return buildRelations(app.db, request.user, anchor.id);
    },
  );

  app.get(
    "/matters/:number/relation-candidates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listMatterRelationCandidates",
        summary: "Live reached Matters selectable as a parent or related Matter",
        tags: ["matter-relations"],
        params: NumberParams,
        querystring: z.object({ q: z.string().trim().min(1).max(200) }),
        response: {
          200: z.object({
            candidates: z.array(
              z.object({
                number: z.number().int(),
                title: z.string(),
                statusName: z.string(),
                statusCategory: z.enum(["open", "closed"]),
                isConfidential: z.boolean(),
              }),
            ),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const anchor = await reachedMatter(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_MATTER);
      const number = /^\d+$/.test(request.query.q) ? Number(request.query.q) : null;
      const numberMatch = number !== null && number <= 2_147_483_647 ? number : null;
      const title = `%${escapeLikePattern(request.query.q)}%`;
      const rows = await app.db
        .select({
          number: matters.number,
          title: matters.title,
          statusName: matterStatuses.displayName,
          statusCategory: matterStatuses.category,
          isConfidential: matters.isConfidential,
        })
        .from(matters)
        .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
        .where(
          and(
            ne(matters.id, anchor.id),
            isNull(matters.archivedAt),
            matterTeamScope(app.db, request.user),
            numberMatch === null
              ? ilike(matters.title, title)
              : or(eq(matters.number, numberMatch), ilike(matters.title, title)),
          ),
        )
        .orderBy(asc(matters.number))
        .limit(20);
      return { candidates: rows };
    },
  );

  app.post(
    "/matters/:number/relations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addMatterRelation",
        summary: "Add one undirected related-Matter link",
        tags: ["matter-relations"],
        params: NumberParams,
        body: z.strictObject({ relatedMatterNumber: z.coerce.number().int().positive() }),
        response: {
          201: RelationsEnvelope,
          409: problemTypeResponse("The relationship is invalid or already exists.", [
            MATTER_RELATION_EXISTS_PROBLEM_TYPE,
            MATTER_SELF_RELATION_PROBLEM_TYPE,
          ]),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const pair = await lockedPair(
          tx,
          request.params.number,
          request.body.relatedMatterNumber,
          request.user,
        );
        await relateMatters(tx, pair.first.id, pair.second.id, request.user.id);
        await recordActivity(tx, {
          entityType: "matter",
          entityId: pair.first.id,
          actorId: request.user.id,
          action: "matter.relation_added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: pair.first.number,
            title: pair.first.title,
            relatedNumber: pair.second.number,
            relatedTitle: pair.second.title,
          },
        });
      });
      const anchor = await reachedMatter(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_MATTER);
      return reply.status(201).send(await buildRelations(app.db, request.user, anchor.id));
    },
  );

  app.delete(
    "/matters/:number/relations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeMatterRelation",
        summary: "Remove one undirected related-Matter link",
        tags: ["matter-relations"],
        params: NumberParams,
        body: z.strictObject({ relatedMatterNumber: z.coerce.number().int().positive() }),
        response: { 200: RelationsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const pair = await lockedPair(
          tx,
          request.params.number,
          request.body.relatedMatterNumber,
          request.user,
        );
        await unrelateMatters(tx, pair.first.id, pair.second.id);
        await recordActivity(tx, {
          entityType: "matter",
          entityId: pair.first.id,
          actorId: request.user.id,
          action: "matter.relation_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: pair.first.number,
            title: pair.first.title,
            relatedNumber: pair.second.number,
            relatedTitle: pair.second.title,
          },
        });
      });
      const anchor = await reachedMatter(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_MATTER);
      return buildRelations(app.db, request.user, anchor.id);
    },
  );

  app.put(
    "/matters/:number/parent",
    {
      preHandler: requireMember,
      schema: {
        operationId: "setMatterParent",
        summary: "Set or replace a Matter's parent",
        tags: ["matter-relations"],
        params: NumberParams,
        body: z.strictObject({ parentMatterNumber: z.coerce.number().int().positive() }),
        response: {
          200: RelationsEnvelope,
          409: problemTypeResponse("The parent would close a hierarchy cycle.", [
            MATTER_PARENT_CYCLE_PROBLEM_TYPE,
          ]),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const pair = await lockedPair(
          tx,
          request.params.number,
          request.body.parentMatterNumber,
          request.user,
        );
        await setMatterParent(tx, pair.first.id, pair.second.id);
        await recordActivity(tx, {
          entityType: "matter",
          entityId: pair.first.id,
          actorId: request.user.id,
          action: "matter.parent_set",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: pair.first.number,
            title: pair.first.title,
            parentNumber: pair.second.number,
            parentTitle: pair.second.title,
          },
        });
      });
      const anchor = await reachedMatter(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_MATTER);
      return buildRelations(app.db, request.user, anchor.id);
    },
  );

  app.delete(
    "/matters/:number/parent",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeMatterParent",
        summary: "Remove a Matter's parent after checking reach on both Matters",
        tags: ["matter-relations"],
        params: NumberParams,
        response: { 200: RelationsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        // Pre-read only to resolve the parent's public number. The pair
        // helper then locks both rows in number order, as every other
        // relationship write does, and the equality check below detects
        // a re-parent between those two moments.
        const preread = await reachedMatter(tx, request.user, request.params.number);
        if (!preread) throw httpError(404, NO_MATTER);
        if (!preread.parentId) throw httpError(409, "This Matter does not have a parent.");
        const [parentRef] = await tx
          .select({ number: matters.number })
          .from(matters)
          .where(eq(matters.id, preread.parentId))
          .limit(1);
        if (!parentRef) throw httpError(409, "This Matter's parent no longer exists.");
        const pair = await lockedPair(tx, request.params.number, parentRef.number, request.user);
        const child = pair.first;
        const parent = pair.second;
        if (child.parentId !== parent.id) {
          throw httpError(409, "This Matter's parent just changed. Reload and try again.");
        }
        await removeMatterParent(tx, child.id);
        await recordActivity(tx, {
          entityType: "matter",
          entityId: child.id,
          actorId: request.user.id,
          action: "matter.parent_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: child.number,
            title: child.title,
            parentNumber: parent.number,
            parentTitle: parent.title,
          },
        });
      });
      const anchor = await reachedMatter(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_MATTER);
      return buildRelations(app.db, request.user, anchor.id);
    },
  );
};
