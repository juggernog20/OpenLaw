// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contract Task reach, checklist reads and writes (CTR-017). Assignments,
 * activity and notifications commit in the same transaction.
 */

import type { Db } from "@openlaw/db";
import {
  and,
  asc,
  contracts,
  contractTasks,
  eq,
  sql,
  users,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import {
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  type ChangedFields,
} from "@openlaw/shared";
import { z } from "zod";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import {
  contractTeamScope,
  NO_CONTRACT,
  reachedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import type { Notifier } from "../../lib/notifications/notifier.js";
import { httpError } from "../../lib/problem.js";
import { prepareTaskAssignee } from "../../lib/task-assignment.js";

export const NO_TASK = "No task exists with this id.";
export const FROZEN = "This contract is archived. Restore it before changing its tasks.";

const TitleSchema = z.string().trim().min(1).max(MAX_TASK_TITLE_LENGTH);

/** One task this viewer reaches, and the record it is on. */
interface ReachedTask {
  id: string;
  title: string;
  description: string | null;
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
export async function reachedTask(
  tx: Transaction,
  user: AuthenticatedUser,
  taskId: string,
): Promise<ReachedTask | null> {
  const [row] = await tx
    .select({
      id: contractTasks.id,
      title: contractTasks.title,
      description: contractTasks.description,
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
        matterId: contracts.matterId,
        isConfidential: contracts.isConfidential,
        expiryDate: contracts.expiryDate,
        noticePeriodDays: contracts.noticePeriodDays,
        aiUnverified: contracts.aiUnverified,
        contractTypeId: contracts.contractTypeId,
        defaultApproverGroupId: contracts.defaultApproverGroupId,
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
export async function checklistOf(db: Executor, contractId: string) {
  const rows = await db
    .select({
      id: contractTasks.id,
      title: contractTasks.title,
      description: contractTasks.description,
      isDone: contractTasks.isDone,
      assigneeId: contractTasks.assigneeId,
      assigneeName: users.displayName,
      assigneeImage: users.image,
      dueDate: contractTasks.dueDate,
      displayOrder: contractTasks.displayOrder,
    })
    .from(contractTasks)
    .leftJoin(users, eq(contractTasks.assigneeId, users.id))
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
export function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
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

function assertMember(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}
export const CreateContractTaskBody = z.strictObject({
  title: TitleSchema,
  description: z.string().trim().max(MAX_TASK_DESCRIPTION_LENGTH).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  addToTeam: z.boolean().optional(),
  dueDate: z.iso.date().nullable().optional(),
});
export const UpdateContractTaskBody = z
  .strictObject({
    title: TitleSchema.optional(),
    description: z.string().trim().max(MAX_TASK_DESCRIPTION_LENGTH).nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    addToTeam: z.boolean().optional(),
    dueDate: z.iso.date().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one of title, description, assigneeId, or dueDate.",
  });

export async function createContractTask(
  _db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof CreateContractTaskBody>,
  notifier: Notifier,
) {
  assertMember(user);
  const body = CreateContractTaskBody.parse(input);
  const { title } = body;
  const assigneeId = body.assigneeId ?? null;
  const dueDate = body.dueDate ?? null;

  // The seam's transaction rather than the database's: a task added
  // with a name on it is an assignment (CTR-017), and the bell row
  // for it belongs inside the same commit as the task.
  const answer = await notifier.notifying(async (tx) => {
    const contract = await reachedContract(tx, user, number, {
      lock: true,
    });
    assertOpen(contract);

    await prepareTaskAssignee(tx, notifier, "contract", contract, user, assigneeId, body.addToTeam);

    const displayOrder = await nextDisplayOrder(tx, contract.id);

    const [created] = await tx
      .insert(contractTasks)
      .values({
        contractId: contract.id,
        title,
        description: body.description || null,
        isDone: false,
        assigneeId,
        dueDate,
        displayOrder,
      })
      .returning({ id: contractTasks.id });

    await recordActivity(tx, {
      entityType: "contract",
      entityId: contract.id,
      actorId: user.id,
      action: "task.added",
      visibility: RECORD_ACTIVITY_TIER,
      // The due date rides the entry rather than being read back
      // from the task: the entry says what was set then, and a task
      // can be edited or removed afterwards.
      payload: { taskId: created!.id, title, ...(dueDate ? { dueDate } : {}) },
    });

    // Being given a task is done *to* you, so it is NOT-002's group
    // 1: the bell rings and the email leaves at once. The route says
    // what happened; who hears about it, through which channel, and
    // whether the record even reaches them are all the seam's.
    if (assigneeId) {
      await notifier.taskAssigned(tx, {
        contractId: contract.id,
        contractNumber: contract.number,
        contractTitle: contract.title,
        actorId: user.id,
        actorName: user.displayName,
        taskId: created!.id,
        taskTitle: title,
        assigneeId,
      });
    }

    return { ...(await checklistOf(tx, contract.id)), createdTaskId: created!.id };
  });
  return answer;
}

export async function updateContractTask(
  _db: Db,
  user: AuthenticatedUser,
  taskId: string,
  input: z.input<typeof UpdateContractTaskBody>,
  notifier: Notifier,
) {
  assertMember(user);
  const body = UpdateContractTaskBody.parse(input);
  // The seam's transaction, for the reason createContractTask opens one:
  // this is the other way a task gets a name on it.
  return await notifier.notifying(async (tx) => {
    const task = await reachedTask(tx, user, taskId);
    if (!task) throw httpError(404, NO_TASK);
    if (task.contract.archivedAt) throw httpError(409, FROZEN);

    const wantedAssignee = body.assigneeId === undefined ? task.assigneeId : body.assigneeId;
    await prepareTaskAssignee(
      tx,
      notifier,
      "contract",
      task.contract,
      user,
      body.assigneeId,
      body.addToTeam,
    );

    const wanted = {
      title: body.title ?? task.title,
      description: body.description === undefined ? task.description : body.description || null,
      assigneeId: wantedAssignee,
      dueDate: body.dueDate === undefined ? task.dueDate : body.dueDate,
    };
    const changed: ChangedFields = {};
    if (wanted.description !== task.description)
      changed.description = { from: task.description, to: wanted.description };
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
        actorId: user.id,
        action: "task.edited",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { taskId: task.id, title: wanted.title, changed },
      });
    }

    // Only a hand-over tells anybody: renaming a task, moving its
    // due date, or re-sending the assignee it already had are edits
    // to something that person already holds, and being told again
    // that it is theirs would be noise. Taking an assignee *off*
    // tells nobody either — the task was given to no one.
    if (changed.assigneeId && wanted.assigneeId) {
      await notifier.taskAssigned(tx, {
        contractId: task.contract.id,
        contractNumber: task.contract.number,
        contractTitle: task.contract.title,
        actorId: user.id,
        actorName: user.displayName,
        taskId: task.id,
        taskTitle: wanted.title,
        assigneeId: wanted.assigneeId,
      });
    }

    return checklistOf(tx, task.contract.id);
  });
}
