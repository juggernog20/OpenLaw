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

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractTasks,
  contracts,
  eq,
  sql,
  users,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { MAX_TASK_TITLE_LENGTH, type ChangedFields } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  NO_CONTRACT,
  reachedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The contract read floor (CTR-021): a Contributor on the team reads the
 * checklist. The role alone opens nothing — the reach predicate narrows
 * it to the records they hold a `contract_team` row on. */
const requireTaskReader = requireRole("administrator", "legal_team_member", "contributor");

/** Adding, editing, toggling, reordering, and removing tasks are Member+.
 * A Contributor reads the checklist; their write grid arrives with M23
 * (DD-015). */
const requireMember = requireRole("administrator", "legal_team_member");

const NO_TASK = "No task exists with this id.";
const FROZEN = "This contract is archived. Restore it before changing its tasks.";

const RecordIdSchema = z.string().min(1).max(64);
const TitleSchema = z.string().trim().min(1).max(MAX_TASK_TITLE_LENGTH);

const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const TaskParams = z.object({ taskId: RecordIdSchema });

/** One task as the API answers it. */
const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  isDone: z.boolean(),
  assigneeId: z.string().nullable(),
  dueDate: z.iso.date().nullable(),
  displayOrder: z.int(),
});

const TasksEnvelope = z.object({
  tasks: z.array(TaskSchema),
  doneCount: z.int(),
  totalCount: z.int(),
});

export const contractTasksRoutes: FastifyPluginAsyncZod = async (app) => {
  /** One task this viewer reaches, and the record it is on. */
  interface ReachedTask {
    id: string;
    title: string;
    isDone: boolean;
    assigneeId: string | null;
    dueDate: string | null;
    displayOrder: number;
    contract: ReachedContract;
  }

  /**
   * One task this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and the reach predicate rides
   * beside the id, so a task on a contract the viewer cannot reach is
   * indistinguishable from one that was never created.
   */
  async function reachedTask(
    tx: Transaction,
    user: AuthenticatedUser,
    taskId: string,
  ): Promise<ReachedTask | null> {
    const [row] = await tx
      .select({
        id: contractTasks.id,
        title: contractTasks.title,
        isDone: contractTasks.isDone,
        assigneeId: contractTasks.assigneeId,
        dueDate: contractTasks.dueDate,
        displayOrder: contractTasks.displayOrder,
        contract: {
          id: contracts.id,
          number: contracts.number,
          title: contracts.title,
          archivedAt: contracts.archivedAt,
          managerId: contracts.managerId,
          primaryDocumentId: contracts.primaryDocumentId,
          isConfidential: contracts.isConfidential,
          expiryDate: contracts.expiryDate,
          noticePeriodDays: contracts.noticePeriodDays,
        },
      })
      .from(contractTasks)
      .innerJoin(contracts, eq(contractTasks.contractId, contracts.id))
      .where(and(eq(contractTasks.id, taskId), contractTeamScope(tx, user)))
      .limit(1)
      .for("update", { of: contracts });
    return row ?? null;
  }

  /** One contract's whole checklist, ordered by display order. */
  async function checklistOf(db: Executor, contractId: string) {
    const rows = await db
      .select({
        id: contractTasks.id,
        title: contractTasks.title,
        isDone: contractTasks.isDone,
        assigneeId: contractTasks.assigneeId,
        dueDate: contractTasks.dueDate,
        displayOrder: contractTasks.displayOrder,
      })
      .from(contractTasks)
      .where(eq(contractTasks.contractId, contractId))
      .orderBy(asc(contractTasks.displayOrder), asc(contractTasks.id));

    const tasks = rows.map((row) => ({
      ...row,
      dueDate: row.dueDate ?? null,
      assigneeId: row.assigneeId ?? null,
    }));
    const doneCount = tasks.filter((task) => task.isDone).length;
    return { tasks, doneCount, totalCount: tasks.length };
  }

  /** The two refusals every task write shares, in the order they have
   * to be asked in. */
  function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) throw httpError(409, FROZEN);
  }

  /** The next display order for a new task on this contract. */
  async function nextDisplayOrder(db: Executor, contractId: string): Promise<number> {
    const [row] = await db
      .select({ max: sql<number>`coalesce(max(${contractTasks.displayOrder}), -1)` })
      .from(contractTasks)
      .where(eq(contractTasks.contractId, contractId));
    return (row?.max ?? -1) + 1;
  }

  // ------------------------------------------------------------------
  // GET /contracts/:number/tasks — read the checklist
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // POST /contracts/:number/tasks — add a task
  // ------------------------------------------------------------------

  app.post(
    "/contracts/:number/tasks",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractTask",
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
        body: z.strictObject({
          title: TitleSchema,
          assigneeId: z.string().nullable().optional(),
          dueDate: z.iso.date().nullable().optional(),
        }),
        response: { 201: TasksEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { title } = request.body;
      const assigneeId = request.body.assigneeId ?? null;
      const dueDate = request.body.dueDate ?? null;

      const answer = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        assertOpen(contract);

        if (assigneeId) {
          const [user] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, assigneeId));
          if (!user) throw httpError(400, "The assignee does not exist.");
        }

        const displayOrder = await nextDisplayOrder(tx, contract.id);

        const [created] = await tx
          .insert(contractTasks)
          .values({
            contractId: contract.id,
            title,
            isDone: false,
            assigneeId,
            dueDate,
            displayOrder,
          })
          .returning({ id: contractTasks.id });

        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "task.added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { taskId: created!.id, title },
        });

        return checklistOf(tx, contract.id);
      });
      return reply.status(201).send(answer);
    },
  );

  // ------------------------------------------------------------------
  // PATCH /tasks/:taskId — edit a task
  // ------------------------------------------------------------------

  app.patch(
    "/tasks/:taskId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContractTask",
        summary:
          "Edit a task's title, assignee, or due date (CTR-017). " +
          "Every field is optional and only what is sent is read. A " +
          "request that changes nothing writes nothing and narrates " +
          "nothing. Appends one task.edited entry naming only what " +
          "moved, at the working-team tier (DD-017). A task on a " +
          "contract this viewer cannot reach answers 404; an archived " +
          "contract takes no edit until it is restored",
        tags: ["tasks"],
        params: TaskParams,
        body: z
          .strictObject({
            title: TitleSchema.optional(),
            assigneeId: z.string().nullable().optional(),
            dueDate: z.iso.date().nullable().optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            message: "Send at least one of title, assigneeId, or dueDate.",
          }),
        response: { 200: TasksEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        const task = await reachedTask(tx, request.user, request.params.taskId);
        if (!task) throw httpError(404, NO_TASK);
        if (task.contract.archivedAt) throw httpError(409, FROZEN);

        const wantedAssignee =
          request.body.assigneeId === undefined ? task.assigneeId : request.body.assigneeId;
        if (wantedAssignee) {
          const [found] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, wantedAssignee));
          if (!found) throw httpError(400, "The assignee does not exist.");
        }

        const wanted = {
          title: request.body.title ?? task.title,
          assigneeId: wantedAssignee,
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
          await tx.update(contractTasks).set(wanted).where(eq(contractTasks.id, task.id));

          await recordActivity(tx, {
            entityType: "contract",
            entityId: task.contract.id,
            actorId: request.user.id,
            action: "task.edited",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { taskId: task.id, title: wanted.title, changed },
          });
        }

        return checklistOf(tx, task.contract.id);
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /tasks/:taskId/toggle — toggle a task's done state
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // PUT /contracts/:number/tasks/reorder — reorder the checklist
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // DELETE /tasks/:taskId — remove a task
  // ------------------------------------------------------------------

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
          "title. A task on a contract this viewer cannot reach " +
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
