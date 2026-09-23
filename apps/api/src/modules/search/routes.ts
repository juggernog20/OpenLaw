// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { QuerySchema, SearchRowSchema, search } from "./service.js";

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/search",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "search",
        summary:
          "Ranked full-text search across Contracts, Matters, Documents, Entities, " +
          "Counterparties, and Requests (M25). Omit limit, kind, and cursor " +
          "for the header's grouped answer of ten per kind. Supplying any " +
          "of them selects the flat results-page order, which defaults to 25 " +
          "and pages by rank and id. A cursor whose row has since been archived, deleted, " +
          "or walled off ends the page set with an empty answer. Document hits identify " +
          "the owning record and latest version; only the latest version is searched",
        tags: ["search"],
        querystring: QuerySchema,
        response: {
          200: z.object({
            results: z.array(SearchRowSchema),
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => search(app.db, request.user, request.query),
  );
};
