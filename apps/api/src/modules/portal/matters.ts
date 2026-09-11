// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  alias,
  and,
  count,
  eq,
  ilike,
  or,
  sql,
  type SQL,
  matters,
  matterStatuses,
  matterTypes,
  users,
} from "@openlaw/db";
import { PORTAL_MATTER_SORT_KEYS } from "@openlaw/shared";
import {
  PortalListQuery,
  ListChoice,
  ListFilterOptions,
  choices,
  searchPattern,
  afterCursor,
  listOrder,
} from "./list-query.js";
import { requireAuth } from "../../auth/guards.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Person = z.object({ id: z.string(), displayName: z.string(), image: z.string().nullable() });
const Matter = z.object({
  number: z.number().int(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  category: z.enum(["open", "closed"]),
  manager: Person.nullable(),
  businessOwner: Person.nullable(),
});

export const portalMatterRoutes: FastifyPluginAsyncZod = async (app) => {
  const owner = alias(users, "portal_matter_business_owner");
  const select = (sortExpr: SQL = sql`${matters.number}`) =>
    app.db
      .select({
        number: matters.number,
        typeId: matters.matterTypeId,
        statusId: matters.statusId,
        sortValue: sortExpr.as("portal_matter_sort_value"),
        title: matters.title,
        type: matterTypes.displayName,
        status: matterStatuses.displayName,
        category: matterStatuses.category,
        manager: { id: users.id, displayName: users.displayName, image: users.image },
        businessOwner: { id: owner.id, displayName: owner.displayName, image: owner.image },
      })
      .from(matters)
      .innerJoin(matterTypes, eq(matters.matterTypeId, matterTypes.id))
      .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
      .leftJoin(users, eq(matters.managerId, users.id))
      .leftJoin(owner, eq(matters.businessOwnerId, owner.id));

  app.get(
    "/portal/matters",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalMatters",
        tags: ["portal"],
        querystring: PortalListQuery.extend({
          statusId: z.string().min(1).max(100).optional(),
          category: z.enum(["open", "closed"]).optional(),
          sort: z.enum(PORTAL_MATTER_SORT_KEYS).optional(),
        }),
        response: {
          200: z.object({
            matters: z.array(Matter),
            total: z.number().int().nonnegative(),
            filterOptions: ListFilterOptions.extend({ statuses: z.array(ListChoice) }),
            nextCursor: z.number().int().positive().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const query = request.query;
      const scope = portalRecordScope(app.db, request.user, "matter");
      const pattern = query.q ? searchPattern(query.q) : undefined;
      const reference = query.q?.replace(/^M-?/i, "");
      const match = and(
        scope,
        pattern
          ? or(
              ilike(matters.title, pattern),
              /^\d+$/.test(reference ?? "")
                ? sql`${matters.number}::text = ${reference}`
                : undefined,
            )
          : undefined,
        query.typeId ? eq(matters.matterTypeId, query.typeId) : undefined,
        query.ownerId ? eq(matters.managerId, query.ownerId) : undefined,
        query.statusId ? eq(matters.statusId, query.statusId) : undefined,
        query.category ? eq(matterStatuses.category, query.category) : undefined,
      );
      const sorts = {
        number: sql`${matters.number}`,
        title: sql`lower(${matters.title})`,
        type: sql`lower(${matterTypes.displayName})`,
        status: sql`${matterStatuses.displayOrder}`,
        owner: sql`lower(${users.displayName})`,
      };
      const expr = sorts[query.sort ?? "number"];
      const dir = query.sort ? (query.dir ?? "asc") : "desc";
      const matching = select(expr).where(match).as("portal_matter_matches");
      const [[total], options] = await Promise.all([
        app.db.select({ value: count() }).from(matching),
        app.db
          .selectDistinct({
            typeId: matterTypes.id,
            typeName: matterTypes.displayName,
            ownerId: users.id,
            ownerName: users.displayName,
            statusId: matterStatuses.id,
            statusName: matterStatuses.displayName,
          })
          .from(matters)
          .innerJoin(matterTypes, eq(matters.matterTypeId, matterTypes.id))
          .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
          .leftJoin(users, eq(matters.managerId, users.id))
          .where(scope),
      ]);
      const filterOptions = {
        types: choices(options.map((row) => ({ id: row.typeId, displayName: row.typeName }))),
        owners: choices(options.map((row) => ({ id: row.ownerId, displayName: row.ownerName }))),
        statuses: choices(
          options.map((row) => ({ id: row.statusId, displayName: row.statusName })),
        ),
      };
      let boundary: SQL | undefined;
      if (query.cursor) {
        const [cursor] = await select(expr)
          .where(and(match, eq(matters.number, query.cursor)))
          .limit(1);
        if (!cursor) return { matters: [], nextCursor: null, total: total!.value, filterOptions };
        boundary = afterCursor(expr, sql`${matters.number}`, query.cursor, cursor.sortValue, dir);
      }
      const rows = await select(expr)
        .where(and(match, boundary))
        .orderBy(...listOrder(expr, sql`${matters.number}`, dir))
        .limit(26);
      const page = rows.slice(0, 25);
      return {
        matters: page,
        nextCursor: rows.length > 25 ? page.at(-1)!.number : null,
        total: total!.value,
        filterOptions,
      };
    },
  );

  app.get(
    "/portal/matters/:number",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalMatter",
        tags: ["portal"],
        params: z.object({ number: z.coerce.number().int().positive() }),
        response: { 200: z.object({ matter: Matter }), default: problemResponse },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const [matter] = await select()
        .where(
          and(
            eq(matters.number, request.params.number),
            portalRecordScope(app.db, request.user, "matter"),
          ),
        )
        .limit(1);
      if (!matter) throw httpError(404, "No matter exists with this number.");
      return { matter };
    },
  );
};
