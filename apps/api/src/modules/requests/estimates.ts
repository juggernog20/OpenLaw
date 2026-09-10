// SPDX-License-Identifier: AGPL-3.0-only

/** INT-003: a confirmed return estimate is independent of the requester's Needed by date. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, isNull, requests } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { NumberParams, REQUIRE_TRIAGER } from "./disposition.js";
import { NO_REQUEST, StaffRequestSchema, staffRequestRow, toStaffRequest } from "./projection.js";

export const requestEstimateRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    "/requests/:number/expected-by",
    {
      preHandler: requireRole(...REQUIRE_TRIAGER),
      schema: {
        operationId: "setRequestEstimate",
        summary: "Set or clear Legal's return estimate on an open or in-progress Request",
        tags: ["requests"],
        params: NumberParams,
        body: z.strictObject({ expectedBy: z.iso.date().nullable() }),
        response: { 200: z.object({ request: StaffRequestSchema }), default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const [held] = await tx
          .select()
          .from(requests)
          .where(and(eq(requests.number, request.params.number), isNull(requests.archivedAt)))
          .for("update");
        if (!held) throw httpError(404, NO_REQUEST);
        if (held.status === "resolved" || held.status === "declined")
          throw httpError(409, "This request is closed. Its return estimate cannot be changed.");
        const { expectedBy } = request.body;
        if (held.expectedBy !== expectedBy) {
          await tx.update(requests).set({ expectedBy }).where(eq(requests.id, held.id));
          await recordActivity(tx, {
            entityType: "request",
            entityId: held.id,
            actorId: request.user.id,
            action: "request.expected_by_changed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: held.number, from: held.expectedBy, to: expectedBy },
          });
        }
        return { request: toStaffRequest(await staffRequestRow(tx, request.user, held.number)) };
      }),
  );
};
