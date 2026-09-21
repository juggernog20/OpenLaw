// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, isNull, requestTypes } from "@openlaw/db";
import { readIntakeForm, intakeRows } from "../../lib/intake-form.js";
import { requireAuth } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { CounterpartyOptionSchema, searchCounterparties } from "../counterparties/routes.js";

/** Intake exposes registry labels only, without access to related Contracts or contact details. */
export const portalCounterpartiesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/request-types/:id/counterparties",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "searchIntakeCounterparties",
        tags: ["portal"],
        params: z.object({ id: z.string() }),
        querystring: z.object({ query: z.string().trim().max(200).optional() }),
        response: {
          200: z.object({ counterparties: z.array(CounterpartyOptionSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [form] = await app.db
        .select({ id: requestTypes.id })
        .from(requestTypes)
        .where(and(eq(requestTypes.id, request.params.id), isNull(requestTypes.archivedAt)))
        .limit(1);
      if (
        !form ||
        !intakeRows((await readIntakeForm(app.db, form.id)).form).some(
          (row) => row.rowRef === "counterparties",
        )
      )
        throw httpError(404, "This form does not collect counterparties.");
      return { counterparties: await searchCounterparties(app.db, request.query.query) };
    },
  );
};
