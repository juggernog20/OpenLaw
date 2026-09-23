// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's task checklist (M17/1, CTR-017): lightweight items with a
 * done flag, an optional assignee, an optional due date, and a display
 * order — nothing more.
 *
 * A Member+ user with reach adds a task, edits it, toggles it, reorders
 * it, and removes it. Reads are the contract read floor, so a
 * Contributor on the team reads the checklist.
 *
 * **Task due dates never join the deadline union.** A task due date is a
 * team intention — "finish the redline by Friday" — not a contractual
 * obligation (CTR-017). The code enforces this by simply never routing
 * them to the key-dates surface.
 *
 * **Every act is narrated** (DD-017). Add, edit, complete, reopen, and
 * remove each append one entry on the owning contract at the standing
 * record tier, inside the same transaction as the write — so a failed
 * log write rolls the mutation back rather than leaving an unrecorded
 * change. A removal deletes the row, which is why its entry carries the
 * title rather than only the id: the entry is what is left of the task.
 *
 * **Access is inherited and nothing is held here** (DD-014, CTR-021).
 * Every route answers the owning contract's reach question first, with
 * the same `reachedContract` read the record, its paper, its approvals,
 * its key dates, and its feed are read through.
 */

import { and, contractTasks, eq } from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import { NO_CONTRACT, reachedContract } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { removeTaskThread } from "../comments/audience.js";
import {
  assertOpen,
  checklistOf,
  createContractTask,
  CreateContractTaskBody,
  FROZEN,
  NO_TASK,
  reachedTask,
  updateContractTask,
  UpdateContractTaskBody,
} from "./service.js";

/** The contract read floor (CTR-021): a Contributor on the team reads the
 * checklist. The role alone opens nothing — the reach predicate narrows
 * it to the records they hold a `contract_team` row on. */
const requireTaskReader = requireRole("administrator", "legal_team_member");

/** Adding, editing, toggling, reordering, and removing tasks are Member+.
 * A Contributor reads the checklist but DD-015 gives them no Task write. */
const requireMember = requireRole("administrator", "legal_team_member");

const RecordIdSchema = z.string().min(1).max(64);

const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const TaskParams = z.object({ taskId: RecordIdSchema });

/** One task as the API answers it. */
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

export const contractTasksRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /contracts/:number/tasks — read the checklist

  app.get(
    "/contracts/:number/tasks",
    {
      preHandler: requireTaskReader,
      schema: {
        operationId: "listContractTasks",
        summary:
          "One contract's task checklist (CTR-017): lightweight items " +
          "with a done flag, an optional assignee, an optional due " +
          "date, and a display order. Task due dates never appear in " +
          "the deadline union or the next-deadline marker. Access is " +
          "inherited from the contract: a Contributor on the team " +
          "reads the checklist, and anyone who cannot reach the " +
          "contract is answered 404",
        tags: ["tasks"],
        params: NumberParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return await checklistOf(app.db, contract.id);
    },
  );

  // POST /contracts/:number/tasks — add a task

  app.post(
    "/contracts/:number/tasks",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractTask",
        description:
          "Assignees must be active staff who manage the record or belong to its team. Set addToTeam to add an eligible person before assignment. An invalid assignee or a missing team membership without addToTeam returns 400. Adding someone to a Confidential record requires permission to change its audience, otherwise the request returns 403. Membership, assignment, activity and notification commit together.",
        summary:
          "Add a task to a contract's checklist (CTR-017). A blank " +
          "title is refused. The task starts not done, with the " +
          "display order after the last existing task. Appends one " +
          "task.added entry on the owning contract at the " +
          "working-team tier (DD-017). Member+: a Contributor who " +
          "reaches the record is refused 403. An archived contract " +
          "takes no new task until it is restored",
        tags: ["tasks"],
        params: NumberParams,
        body: CreateContractTaskBody,
        response: { 201: TasksEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      return reply
        .status(201)
        .send(
          await createContractTask(
            app.db,
            request.user,
            request.params.number,
            request.body,
            app.notifier,
          ),
        );
    },
  );

  // PATCH /tasks/:taskId — edit a task

  app.patch(
    "/tasks/:taskId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContractTask",
        description:
          "Assignees must be active staff who manage the record or belong to its team. Set addToTeam to add an eligible person before assignment. An invalid assignee or a missing team membership without addToTeam returns 400. Adding someone to a Confidential record requires permission to change its audience, otherwise the request returns 403. Membership, assignment, activity and notification commit together.",
        summary:
          "Edit a task's title, description, assignee, or due date (CTR-017). " +
          "Every field is optional and only what is sent is read. A " +
          "request that changes nothing writes nothing and narrates " +
          "nothing. Appends one task.edited entry naming only what " +
          "moved, at the working-team tier (DD-017). A task on a " +
          "contract this viewer cannot reach answers 404; an archived " +
          "contract takes no edit until it is restored",
        tags: ["tasks"],
        params: TaskParams,
        body: UpdateContractTaskBody,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return updateContractTask(
        app.db,
        request.user,
        request.params.taskId,
        request.body,
        app.notifier,
      );
    },
  );

  // POST /tasks/:taskId/toggle — toggle a task's done state

  app.post(
    "/tasks/:taskId/toggle",
    {
      preHandler: requireMember,
      schema: {
        operationId: "toggleContractTask",
        summary:
          "Toggle a task between done and not done (CTR-017). " +
          "Completes an open task or reopens a done one. Appends one " +
          "task.completed or task.reopened entry at the working-team " +
          "tier (DD-017). A task on a contract this viewer cannot " +
          "reach answers 404; an archived contract takes no toggle " +
          "until it is restored",
        tags: ["tasks"],
        params: TaskParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        if (!task) throw httpError(404, NO_TASK);
        if (task.contract.archivedAt) throw httpError(409, FROZEN);

        const newDone = !task.isDone;
        await tx
          .update(contractTasks)
          .set({ isDone: newDone })
          .where(eq(contractTasks.id, task.id));

        await recordActivity(tx, {
          entityType: "contract",
          entityId: task.contract.id,
          actorId: request.user.id,
          action: newDone ? "task.completed" : "task.reopened",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskId: task.id, title: task.title },
        });

        return checklistOf(tx, task.contract.id);
      });
    },
  );

  // PUT /contracts/:number/tasks/reorder — reorder the checklist

  app.put(
    "/contracts/:number/tasks/reorder",
    {
      preHandler: requireMember,
      schema: {
        operationId: "reorderContractTasks",
        summary:
          "Reorder a contract's task checklist (CTR-017). The body " +
          "carries the full ordered list of task ids; every task on " +
          "the contract must appear exactly once. Member+; an " +
          "archived contract takes no reorder until it is restored",
        tags: ["tasks"],
        params: NumberParams,
        body: z.strictObject({
          taskIds: z.array(z.string().min(1)).min(1),
        }),
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { taskIds } = request.body;

      return await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        assertOpen(contract);

        // Every existing task must appear exactly once, and nothing else.
        const existing = await tx
          .select({ id: contractTasks.id })
          .from(contractTasks)
          .where(eq(contractTasks.contractId, contract.id));
        const own = new Set(existing.map((row) => row.id));
        const named = new Set(taskIds);
        if (
          named.size !== taskIds.length ||
          named.size !== own.size ||
          taskIds.some((id) => !own.has(id))
        ) {
          throw httpError(400, "The reorder must name every task on this contract exactly once.");
        }

        // Batch update display orders.
        for (let i = 0; i < taskIds.length; i++) {
          await tx
            .update(contractTasks)
            .set({ displayOrder: i })
            .where(
              and(eq(contractTasks.id, taskIds[i]!), eq(contractTasks.contractId, contract.id)),
            );
        }

        return checklistOf(tx, contract.id);
      });
    },
  );

  // DELETE /tasks/:taskId — remove a task

  app.delete(
    "/tasks/:taskId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractTask",
        summary:
          "Take a task off a contract's checklist (CTR-017). The row " +
          "is deleted and the task.removed activity entry is the " +
          "durable record of it, which is why that entry carries the " +
          "title. A task carrying any comment, deleted and redacted " +
          "ones included, answers 409 and is marked done instead of " +
          "removed. A task on a contract this viewer cannot reach " +
          "answers 404; an archived contract takes no removal until " +
          "it is restored",
        tags: ["tasks"],
        params: TaskParams,
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        if (!task) throw httpError(404, NO_TASK);
        if (task.contract.archivedAt) throw httpError(409, FROZEN);

        // The Task's own row, held while its thread is counted: a post
        // resolving this Task waits here, so the count and the delete
        // are one decision (CMT-006).
        await tx
          .select({ id: contractTasks.id })
          .from(contractTasks)
          .where(eq(contractTasks.id, task.id))
          .limit(1)
          .for("update");
        await removeTaskThread(tx, "contract_task", task.id);

        await tx.delete(contractTasks).where(eq(contractTasks.id, task.id));

        await recordActivity(tx, {
          entityType: "contract",
          entityId: task.contract.id,
          actorId: request.user.id,
          action: "task.removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskId: task.id, title: task.title },
        });

        return checklistOf(tx, task.contract.id);
      });
    },
  );
};
