// SPDX-License-Identifier: AGPL-3.0-only

/** INT-007 assigns an undecided Request and records its activity and notification together. */

import { and, asc, inArray, isNull, users } from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { NumberParams, REQUIRE_TRIAGER } from "./disposition.js";
import { RequestAssigneeSchema, StaffRequestSchema } from "./projection.js";
import { AssignRequestBody, assignRequest } from "./service.js";

const requireTriager = requireRole(...REQUIRE_TRIAGER);

export const requestAssignmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/requests/assignees",
    {
      preHandler: requireTriager,
      schema: {
        operationId: "requestAssigneeOptions",
        summary: "Active staff who can triage Requests",
        tags: ["requests"],
        response: {
          200: z.object({ people: z.array(RequestAssigneeSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => ({
      people: await app.db
        .select({ id: users.id, displayName: users.displayName, image: users.image })
        .from(users)
        .where(and(isNull(users.archivedAt), inArray(users.role, [...REQUIRE_TRIAGER])))
        .orderBy(asc(users.displayName), asc(users.id)),
    }),
  );

  app.patch(
    "/requests/:number/assignee",
    {
      preHandler: requireTriager,
      schema: {
        operationId: "assignRequest",
        summary: "Assign, reassign or clear the person responsible for triaging an open Request",
        tags: ["requests"],
        params: NumberParams,
        body: AssignRequestBody,
        response: { 200: z.object({ request: StaffRequestSchema }), default: problemResponse },
      },
    },
    async (request) =>
      assignRequest(app.db, request.user, request.params.number, request.body, app.notifier),
  );
};
