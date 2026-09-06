// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, requests, users } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { NumberParams, REQUIRE_TRIAGER } from "./disposition.js";
import {
  NO_REQUEST,
  RequestAssigneeSchema,
  StaffRequestSchema,
  staffRequestRow,
  toStaffRequest,
} from "./projection.js";

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
        body: z.strictObject({ assigneeId: z.string().min(1).max(64).nullable() }),
        response: { 200: z.object({ request: StaffRequestSchema }), default: problemResponse },
      },
    },
    async (request) =>
      app.notifier.notifying(async (tx) => {
        const [held] = await tx
          .select()
          .from(requests)
          .where(and(eq(requests.number, request.params.number), isNull(requests.archivedAt)))
          .for("update");
        if (!held) throw httpError(404, NO_REQUEST);
        if (held.status !== "new")
          throw httpError(
            409,
            "This request has already been triaged. Its assignment cannot be changed.",
          );
        const { assigneeId } = request.body;
        let name: string | null = null;
        if (assigneeId !== null) {
          const [person] = await tx
            .select()
            .from(users)
            .where(eq(users.id, assigneeId))
            .for("update");
          if (
            !person ||
            person.archivedAt ||
            (person.role !== "administrator" && person.role !== "legal_team_member")
          ) {
            throw httpError(
              400,
              "Choose an active Administrator or Legal Team Member to triage this request.",
            );
          }
          name = person.displayName;
        }
        if (held.assigneeId !== assigneeId) {
          await tx.update(requests).set({ assigneeId }).where(eq(requests.id, held.id));
          await recordActivity(tx, {
            entityType: "request",
            entityId: held.id,
            actorId: request.user.id,
            action: "request.assignee_changed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: held.number, assignee: name, from: held.assigneeId, to: assigneeId },
          });
          if (assigneeId)
            await app.notifier.requestAssigned(tx, {
              requestId: held.id,
              actorId: request.user.id,
              actorName: request.user.displayName,
              assigneeId,
            });
        }
        return { request: toStaffRequest(await staffRequestRow(tx, request.user, held.number)) };
      }),
  );
};
