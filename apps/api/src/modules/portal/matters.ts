// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { alias, and, desc, eq, lt, matters, matterStatuses, matterTypes, users } from "@openlaw/db";
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
  const select = () =>
    app.db
      .select({
        number: matters.number,
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
        querystring: z.object({ cursor: z.coerce.number().int().positive().optional() }),
        response: {
          200: z.object({
            matters: z.array(Matter),
            nextCursor: z.number().int().positive().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const scope = portalRecordScope(app.db, request.user, "matter");
      if (request.query.cursor) {
        const [cursor] = await select()
          .where(and(scope, eq(matters.number, request.query.cursor)))
          .limit(1);
        if (!cursor) return { matters: [], nextCursor: null };
      }
      const rows = await select()
        .where(
          and(scope, request.query.cursor ? lt(matters.number, request.query.cursor) : undefined),
        )
        .orderBy(desc(matters.number))
        .limit(26);
      const page = rows.slice(0, 25);
      return { matters: page, nextCursor: rows.length > 25 ? page.at(-1)!.number : null };
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
