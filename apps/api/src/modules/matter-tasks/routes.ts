// SPDX-License-Identifier: AGPL-3.0-only

/** The lightweight checklist on a Matter (MTR-005, M23/4). */

import { and, eq, matterTasks } from "@openlaw/db";
import { MAX_TASK_DESCRIPTION_LENGTH, MAX_TASK_TITLE_LENGTH } from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import { NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { prepareTaskAssignee } from "../../lib/task-assignment.js";
import { removeTaskThread } from "../comments/audience.js";
import { createMatterTask } from "./create.js";
import {
  assertTaskWritable,
  assertWritable,
  checklistOf,
  reachedTask,
  updateMatterTask,
  UpdateMatterTaskBody,
} from "./service.js";

const requireReader = requireRole("administrator", "legal_team_member");
const requireMember = requireRole("administrator", "legal_team_member");
const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const TaskParams = z.object({ taskId: z.string().min(1).max(64) });
const TitleSchema = z.string().trim().min(1).max(MAX_TASK_TITLE_LENGTH);

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isDone: z.boolean(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  assigneeImage: z.string().nullable(),
  dueDate: z.iso.date().nullable(),
  displayOrder: z.int(),
});
const TasksEnvelope = z.object({
  createdTaskId: z.string().optional(),
  tasks: z.array(TaskSchema),
  doneCount: z.int(),
  totalCount: z.int(),
});

export const matterTasksRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/matters/:number/tasks",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterTasks",
        summary:
          "List a reached Matter's lightweight checklist by due date, with undated Tasks last and display order breaking ties. Contributors on the Matter can read it; Task due dates are internal and never enter deadline surfaces",
        tags: ["matter-tasks"],
        params: NumberParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const matter = await reachedMatter(app.db, request.user, request.params.number);
      if (!matter) throw httpError(404, NO_MATTER);
      return checklistOf(app.db, matter.id);
    },
  );

  app.post(
    "/matters/:number/tasks",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addMatterTask",
        description:
          "Assignees must be active staff who manage the record or belong to its team. Set addToTeam to add an eligible person before assignment. An invalid assignee or a missing team membership without addToTeam returns 400. Adding someone to a Confidential record requires permission to change its audience, otherwise the request returns 403. Membership, assignment, activity and notification commit together.",
        summary:
          "Add a Task to a reached, non-archived Matter. Closing does not freeze the checklist",
        tags: ["matter-tasks"],
        params: NumberParams,
        body: z.strictObject({
          title: TitleSchema,
          description: z.string().trim().max(MAX_TASK_DESCRIPTION_LENGTH).nullable().optional(),
          assigneeId: z.string().nullable().optional(),
          addToTeam: z.boolean().optional(),
          dueDate: z.iso.date().nullable().optional(),
        }),
        response: { 201: TasksEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const answer = await app.notifier.notifying(async (tx) => {
        const matter = await reachedMatter(tx, request.user, request.params.number, { lock: true });
        assertWritable(matter);
        const assigneeId = request.body.assigneeId ?? null;
        await prepareTaskAssignee(
          tx,
          app.notifier,
          "matter",
          matter,
          request.user,
          assigneeId,
          request.body.addToTeam,
        );
        const created = await createMatterTask(tx, {
          matter,
          title: request.body.title,
          description: request.body.description,
          assigneeId,
          dueDate: request.body.dueDate ?? null,
          actorId: request.user.id,
        });
        if (assigneeId) {
          await app.notifier.matterTaskAssigned(tx, {
            matterId: matter.id,
            matterNumber: matter.number,
            matterTitle: matter.title,
            actorId: request.user.id,
            actorName: request.user.displayName,
            taskId: created.id,
            taskTitle: request.body.title,
            assigneeId,
          });
        }
        return { ...(await checklistOf(tx, matter.id)), createdTaskId: created.id };
      });
      return reply.status(201).send(answer);
    },
  );

  app.patch(
    "/matter-tasks/:taskId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateMatterTask",
        description:
          "Assignees must be active staff who manage the record or belong to its team. Set addToTeam to add an eligible person before assignment. An invalid assignee or a missing team membership without addToTeam returns 400. Adding someone to a Confidential record requires permission to change its audience, otherwise the request returns 403. Membership, assignment, activity and notification commit together.",
        summary: "Edit a Task's title, assignee, or internal due date on a reached Matter",
        tags: ["matter-tasks"],
        params: TaskParams,
        body: UpdateMatterTaskBody,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      updateMatterTask(app.db, request.user, request.params.taskId, request.body, app.notifier),
  );

  app.post(
    "/matter-tasks/:taskId/toggle",
    {
      preHandler: requireMember,
      schema: {
        operationId: "toggleMatterTask",
        summary: "Complete or reopen one Task on a reached, non-archived Matter",
        tags: ["matter-tasks"],
        params: TaskParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        assertTaskWritable(task);
        const isDone = !task.isDone;
        await tx.update(matterTasks).set({ isDone }).where(eq(matterTasks.id, task.id));
        await recordActivity(tx, {
          entityType: "matter",
          entityId: task.matter.id,
          actorId: request.user.id,
          action: isDone ? "task.completed" : "task.reopened",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskId: task.id, title: task.title },
        });
        return checklistOf(tx, task.matter.id);
      }),
  );

  app.put(
    "/matters/:number/tasks/reorder",
    {
      preHandler: requireMember,
      schema: {
        operationId: "reorderMatterTasks",
        summary:
          "Replace a reached Matter checklist's complete display order. The list reads by due date first, so stored display order only breaks ties between Tasks sharing a date and orders the undated ones",
        tags: ["matter-tasks"],
        params: NumberParams,
        body: z.strictObject({ taskIds: z.array(z.string().min(1)).min(1) }),
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const matter = await reachedMatter(tx, request.user, request.params.number, { lock: true });
        assertWritable(matter);
        const existing = await tx
          .select({ id: matterTasks.id })
          .from(matterTasks)
          .where(eq(matterTasks.matterId, matter.id));
        const own = new Set(existing.map((row) => row.id));
        const named = new Set(request.body.taskIds);
        if (
          named.size !== request.body.taskIds.length ||
          named.size !== own.size ||
          request.body.taskIds.some((id) => !own.has(id))
        ) {
          throw httpError(400, "The reorder must name every Task on this Matter exactly once.");
        }
        for (const [displayOrder, taskId] of request.body.taskIds.entries()) {
          await tx
            .update(matterTasks)
            .set({ displayOrder })
            .where(and(eq(matterTasks.id, taskId), eq(matterTasks.matterId, matter.id)));
        }
        await recordActivity(tx, {
          entityType: "matter",
          entityId: matter.id,
          actorId: request.user.id,
          action: "task.reordered",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskIds: request.body.taskIds },
        });
        return checklistOf(tx, matter.id);
      }),
  );

  app.delete(
    "/matter-tasks/:taskId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeMatterTask",
        summary:
          "Remove one Task from a reached, non-archived Matter. A Task carrying any comment, deleted and redacted ones included, answers 409 without changing the Task; mark it done instead",
        tags: ["matter-tasks"],
        params: TaskParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        assertTaskWritable(task);
        // The Task's own row, held while its thread is counted: a post
        // resolving this Task waits here, so the count and the delete
        // are one decision (CMT-006).
        await tx
          .select({ id: matterTasks.id })
          .from(matterTasks)
          .where(eq(matterTasks.id, task.id))
          .limit(1)
          .for("update");
        await removeTaskThread(tx, "matter_task", task.id);

        await tx.delete(matterTasks).where(eq(matterTasks.id, task.id));
        await recordActivity(tx, {
          entityType: "matter",
          entityId: task.matter.id,
          actorId: request.user.id,
          action: "task.removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskId: task.id, title: task.title },
        });
        return checklistOf(tx, task.matter.id);
      }),
  );
};
