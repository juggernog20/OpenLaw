// SPDX-License-Identifier: AGPL-3.0-only

/** The lightweight checklist on a Matter (MTR-005, M23/4). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  matters,
  matterTasks,
  users,
  type Executor,
  type Matter,
  type Transaction,
} from "@openlaw/db";
import { MAX_TASK_TITLE_LENGTH, type ChangedFields } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { prepareTaskAssignee } from "../../lib/task-assignment.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { assertValidMatterTaskAssignee, createMatterTask } from "./create.js";

const requireReader = requireRole("administrator", "legal_team_member", "contributor");
const requireMember = requireRole("administrator", "legal_team_member");
const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const TaskParams = z.object({ taskId: z.string().min(1).max(64) });
const TitleSchema = z.string().trim().min(1).max(MAX_TASK_TITLE_LENGTH);
const NO_TASK = "No Matter Task exists with this id.";
const FROZEN = "This matter is archived. Restore it before changing its Tasks.";

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  isDone: z.boolean(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  assigneeImage: z.string().nullable(),
  dueDate: z.iso.date().nullable(),
  displayOrder: z.int(),
});
const TasksEnvelope = z.object({
  tasks: z.array(TaskSchema),
  doneCount: z.int(),
  totalCount: z.int(),
});

interface ReachedTask {
  id: string;
  title: string;
  isDone: boolean;
  assigneeId: string | null;
  dueDate: string | null;
  displayOrder: number;
  matter: Matter;
}

export const matterTasksRoutes: FastifyPluginAsyncZod = async (app) => {
  async function checklistOf(db: Executor, matterId: string) {
    const tasks = await db
      .select({
        id: matterTasks.id,
        title: matterTasks.title,
        isDone: matterTasks.isDone,
        assigneeId: matterTasks.assigneeId,
        assigneeName: users.displayName,
        assigneeImage: users.image,
        dueDate: matterTasks.dueDate,
        displayOrder: matterTasks.displayOrder,
      })
      .from(matterTasks)
      .leftJoin(users, eq(matterTasks.assigneeId, users.id))
      .where(eq(matterTasks.matterId, matterId))
      .orderBy(asc(matterTasks.displayOrder), asc(matterTasks.id));
    return {
      tasks,
      doneCount: tasks.filter((task) => task.isDone).length,
      totalCount: tasks.length,
    };
  }

  async function reachedTask(
    tx: Transaction,
    user: AuthenticatedUser,
    taskId: string,
  ): Promise<ReachedTask | null> {
    const [row] = await tx
      .select({
        id: matterTasks.id,
        title: matterTasks.title,
        isDone: matterTasks.isDone,
        assigneeId: matterTasks.assigneeId,
        dueDate: matterTasks.dueDate,
        displayOrder: matterTasks.displayOrder,
        matter: matters,
      })
      .from(matterTasks)
      .innerJoin(matters, eq(matterTasks.matterId, matters.id))
      .where(and(eq(matterTasks.id, taskId), matterTeamScope(tx, user)))
      .limit(1)
      .for("update", { of: matters });
    return row ?? null;
  }

  function assertWritable(matter: Matter | null): asserts matter is Matter {
    if (!matter) throw httpError(404, NO_MATTER);
    if (matter.archivedAt) throw httpError(409, FROZEN);
  }

  function assertTaskWritable(task: ReachedTask | null): asserts task is ReachedTask {
    if (!task) throw httpError(404, NO_TASK);
    if (task.matter.archivedAt) throw httpError(409, FROZEN);
  }

  app.get(
    "/matters/:number/tasks",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterTasks",
        summary:
          "List a reached Matter's lightweight checklist in stable display order. Contributors on the Matter can read it; Task due dates are internal and never enter deadline surfaces",
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
        summary:
          "Add a Task to a reached, non-archived Matter. Closing does not freeze the checklist",
        tags: ["matter-tasks"],
        params: NumberParams,
        body: z.strictObject({
          title: TitleSchema,
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
          "matter",
          matter,
          request.user,
          assigneeId,
          request.body.addToTeam,
        );
        const created = await createMatterTask(tx, {
          matter,
          title: request.body.title,
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
        return checklistOf(tx, matter.id);
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
        summary: "Edit a Task's title, assignee, or internal due date on a reached Matter",
        tags: ["matter-tasks"],
        params: TaskParams,
        body: z
          .strictObject({
            title: TitleSchema.optional(),
            assigneeId: z.string().nullable().optional(),
            addToTeam: z.boolean().optional(),
            dueDate: z.iso.date().nullable().optional(),
          })
          .meta({ minProperties: 1 })
          .refine((body) => Object.keys(body).length > 0, {
            message: "Send at least one of title, assigneeId, or dueDate.",
          }),
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.notifier.notifying(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        assertTaskWritable(task);
        const assigneeId =
          request.body.assigneeId === undefined ? task.assigneeId : request.body.assigneeId;
        await prepareTaskAssignee(
          tx,
          "matter",
          task.matter,
          request.user,
          request.body.assigneeId,
          request.body.addToTeam,
        );
        if (request.body.assigneeId !== undefined) {
          await assertValidMatterTaskAssignee(tx, task.matter, assigneeId);
        }
        const wanted = {
          title: request.body.title ?? task.title,
          assigneeId,
          dueDate: request.body.dueDate === undefined ? task.dueDate : request.body.dueDate,
        };
        const changed: ChangedFields = {};
        if (wanted.title !== task.title) changed.title = { from: task.title, to: wanted.title };
        if (wanted.assigneeId !== task.assigneeId) {
          changed.assigneeId = { from: task.assigneeId, to: wanted.assigneeId };
        }
        if (wanted.dueDate !== task.dueDate) {
          changed.dueDate = { from: task.dueDate, to: wanted.dueDate };
        }
        if (Object.keys(changed).length > 0) {
          await tx.update(matterTasks).set(wanted).where(eq(matterTasks.id, task.id));
          await recordActivity(tx, {
            entityType: "matter",
            entityId: task.matter.id,
            actorId: request.user.id,
            action: "task.edited",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { taskId: task.id, title: wanted.title, changed },
          });
        }
        if (changed.assigneeId && wanted.assigneeId) {
          await app.notifier.matterTaskAssigned(tx, {
            matterId: task.matter.id,
            matterNumber: task.matter.number,
            matterTitle: task.matter.title,
            actorId: request.user.id,
            actorName: request.user.displayName,
            taskId: task.id,
            taskTitle: wanted.title,
            assigneeId: wanted.assigneeId,
          });
        }
        return checklistOf(tx, task.matter.id);
      }),
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
        summary: "Replace a reached Matter checklist's complete display order",
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
        summary: "Remove one Task from a reached, non-archived Matter",
        tags: ["matter-tasks"],
        params: TaskParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        assertTaskWritable(task);
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
