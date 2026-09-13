// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-010's name-only choices for Portal forms, which every signed-in role can use. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, entities, sql } from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { portalEntityScope } from "../../lib/portal-entities.js";
import { problemResponse } from "../../lib/problem.js";

export const portalEntityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/entities",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalEntities",
        summary:
          "Names for Portal Entity pickers: live, non-Confidential, Portal-listed Entities only (ENT-010)",
        tags: ["portal"],
        response: {
          200: z.object({ entities: z.array(z.object({ id: z.string(), name: z.string() })) }),
          default: problemResponse,
        },
      },
    },
    async () => ({
      entities: await app.db
        .select({ id: entities.id, name: entities.legalName })
        .from(entities)
        .where(portalEntityScope)
        .orderBy(asc(sql`lower(${entities.legalName})`), asc(entities.id)),
    }),
  );
};
