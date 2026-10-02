// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A Business User's own Tasks in the Portal (MTR-005 addendum, 2026-10-02).
 * They read the Tasks assigned to them on records they reach in the Portal,
 * and complete or reopen one. Every other Task write stays Legal.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  contracts,
  contractTasks,
  eq,
  matters,
  matterTasks,
  sql,
  type Transaction,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import type { AuthenticatedUser } from "../../auth/user.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  AssignedTasksCursorSchema,
  AssignedTasksPageSchema,
  readAssignedTasks,
  TaskHomeRowSchema,
} from "../home/sections/tasks.js";

const Kind = z.enum(["contract", "matter"]);
const NO_TASK = "No Task assigned to you exists with this id.";

/** The viewer's own Task, locked with its record, or undefined. */
async function ownTask(
  tx: Transaction,
  user: AuthenticatedUser,
  kind: "contract" | "matter",
  taskId: string,
) {
  const tasks = kind === "contract" ? contractTasks : matterTasks;
  const record = kind === "contract" ? contracts : matters;
  const recordId = kind === "contract" ? contractTasks.contractId : matterTasks.matterId;
  const [row] = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      isDone: tasks.isDone,
      isOverdue: sql<boolean>`coalesce(not ${tasks.isDone} and ${tasks.dueDate} < current_date, false)`,
      recordId: record.id,
      recordNumber: record.number,
      recordTitle: record.title,
      recordIsConfidential: record.isConfidential,
    })
    .from(tasks)
    .innerJoin(record, eq(record.id, recordId))
    .where(
      and(eq(tasks.id, taskId), eq(tasks.assigneeId, user.id), portalRecordScope(tx, user, kind)),
    )
    .limit(1)
    .for("update", { of: record });
  return row;
}

export const portalTaskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/tasks",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalTasks",
        summary:
          "Tasks assigned to the signed-in user on Contracts and Matters they reach in the Portal, by due date with undated Tasks last. Completed Tasks are hidden by default. kind and number keep the Tasks on one record",
        tags: ["portal"],
        querystring: z
          .object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            cursor: AssignedTasksCursorSchema.optional(),
            includeCompleted: z.enum(["true", "false"]).optional(),
            kind: Kind.optional(),
            number: z.coerce.number().int().positive().optional(),
          })
          .refine((query) => (query.kind === undefined) === (query.number === undefined), {
            message: "Send kind and number together.",
          }),
        response: { 200: AssignedTasksPageSchema, default: problemResponse },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const { kind, number, includeCompleted, ...page } = request.query;
      return readAssignedTasks(app.db, request.user, {
        ...page,
        includeCompleted: includeCompleted === "true",
        portal: true,
        ...(kind && number ? { record: { kind, number } } : {}),
      });
    },
  );

  app.post(
    "/portal/tasks/:taskId/toggle",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "togglePortalTask",
        summary:
          "Complete or reopen one Task assigned to the signed-in user on a record they reach in the Portal. Logs task.completed or task.reopened with them as actor. Any other Task answers 404",
        tags: ["portal"],
        params: z.object({ taskId: z.string().min(1).max(64) }),
        body: z.strictObject({ kind: Kind }),
        response: { 200: z.object({ task: TaskHomeRowSchema }), default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const { kind } = request.body;
        const task = await ownTask(tx, request.user, kind, request.params.taskId);
        if (!task) throw httpError(404, NO_TASK);
        const isDone = !task.isDone;
        if (kind === "contract")
          await tx.update(contractTasks).set({ isDone }).where(eq(contractTasks.id, task.id));
        else await tx.update(matterTasks).set({ isDone }).where(eq(matterTasks.id, task.id));
        await recordActivity(tx, {
          entityType: kind,
          entityId: task.recordId,
          actorId: request.user.id,
          action: isDone ? "task.completed" : "task.reopened",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskId: task.id, title: task.title },
        });
        const updated = (await ownTask(tx, request.user, kind, task.id))!;
        return {
          task: {
            id: updated.id,
            title: updated.title,
            dueDate: updated.dueDate,
            isDone: updated.isDone,
            isOverdue: updated.isOverdue,
            record: {
              kind,
              id: updated.recordId,
              number: updated.recordNumber,
              title: updated.recordTitle,
              isConfidential: updated.recordIsConfidential,
            },
          },
        };
      }),
  );
};
