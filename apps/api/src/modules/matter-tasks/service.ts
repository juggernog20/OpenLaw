// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Matter Task reach, archive guards and updates (MTR-005). Assignment changes
 * keep team membership, activity and notifications in one transaction.
 */

import type { Db } from "@openlaw/db";
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
import {
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  type ChangedFields,
} from "@openlaw/shared";
import { z } from "zod";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import { matterTeamScope, NO_MATTER } from "../../lib/matter-access.js";
import type { Notifier } from "../../lib/notifications/notifier.js";
import { httpError } from "../../lib/problem.js";
import { prepareTaskAssignee } from "../../lib/task-assignment.js";
import { assertValidMatterTaskAssignee } from "./create.js";

const TitleSchema = z.string().trim().min(1).max(MAX_TASK_TITLE_LENGTH);
const NO_TASK = "No Matter Task exists with this id.";
const FROZEN = "This matter is archived. Restore it before changing its Tasks.";

interface ReachedTask {
  id: string;
  title: string;
  description: string | null;
  isDone: boolean;
  assigneeId: string | null;
  dueDate: string | null;
  displayOrder: number;
  matter: Matter;
}

export async function checklistOf(db: Executor, matterId: string) {
  const tasks = await db
    .select({
      id: matterTasks.id,
      title: matterTasks.title,
      description: matterTasks.description,
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
    .orderBy(asc(matterTasks.dueDate), asc(matterTasks.displayOrder), asc(matterTasks.id));
  return {
    tasks,
    doneCount: tasks.filter((task) => task.isDone).length,
    totalCount: tasks.length,
  };
}

export async function reachedTask(
  tx: Transaction,
  user: AuthenticatedUser,
  taskId: string,
): Promise<ReachedTask | null> {
  const [row] = await tx
    .select({
      id: matterTasks.id,
      title: matterTasks.title,
      description: matterTasks.description,
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

export function assertWritable(matter: Matter | null): asserts matter is Matter {
  if (!matter) throw httpError(404, NO_MATTER);
  if (matter.archivedAt) throw httpError(409, FROZEN);
}

export function assertTaskWritable(task: ReachedTask | null): asserts task is ReachedTask {
  if (!task) throw httpError(404, NO_TASK);
  if (task.matter.archivedAt) throw httpError(409, FROZEN);
}

function assertMember(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}

export const UpdateMatterTaskBody = z
  .strictObject({
    title: TitleSchema.optional(),
    description: z.string().trim().max(MAX_TASK_DESCRIPTION_LENGTH).nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    addToTeam: z.boolean().optional(),
    dueDate: z.iso.date().nullable().optional(),
  })
  .meta({ minProperties: 1 })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one of title, description, assigneeId, or dueDate.",
  });
export async function updateMatterTask(
  _db: Db,
  user: AuthenticatedUser,
  taskId: string,
  input: z.input<typeof UpdateMatterTaskBody>,
  notifier: Notifier,
) {
  assertMember(user);
  const body = UpdateMatterTaskBody.parse(input);
  return notifier.notifying(async (tx) => {
    const task = await reachedTask(tx, user, taskId);
    assertTaskWritable(task);
    const assigneeId = body.assigneeId === undefined ? task.assigneeId : body.assigneeId;
    await prepareTaskAssignee(
      tx,
      notifier,
      "matter",
      task.matter,
      user,
      body.assigneeId,
      body.addToTeam,
    );
    if (body.assigneeId !== undefined) {
      await assertValidMatterTaskAssignee(tx, task.matter, assigneeId);
    }
    const wanted = {
      title: body.title ?? task.title,
      description: body.description === undefined ? task.description : body.description || null,
      assigneeId,
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
      await tx.update(matterTasks).set(wanted).where(eq(matterTasks.id, task.id));
      await recordActivity(tx, {
        entityType: "matter",
        entityId: task.matter.id,
        actorId: user.id,
        action: "task.edited",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { taskId: task.id, title: wanted.title, changed },
      });
    }
    if (changed.assigneeId && wanted.assigneeId) {
      await notifier.matterTaskAssigned(tx, {
        matterId: task.matter.id,
        matterNumber: task.matter.number,
        matterTitle: task.matter.title,
        actorId: user.id,
        actorName: user.displayName,
        taskId: task.id,
        taskTitle: wanted.title,
        assigneeId: wanted.assigneeId,
      });
    }
    return checklistOf(tx, task.matter.id);
  });
}
