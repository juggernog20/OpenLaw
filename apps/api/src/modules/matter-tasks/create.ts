// SPDX-License-Identifier: AGPL-3.0-only

import {
  and,
  eq,
  isNull,
  matterTasks,
  matterTeam,
  sql,
  users,
  type Matter,
  type Transaction,
} from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { httpError } from "../../lib/problem.js";

const INVALID_ASSIGNEE =
  "The assignee must be the active Matter Manager or an active user on the Matter team.";

export interface CreateMatterTaskInput {
  matter: Pick<Matter, "id" | "managerId">;
  title: string;
  assigneeId: string | null;
  dueDate: string | null;
  actorId: string;
}

export async function assertValidMatterTaskAssignee(
  tx: Transaction,
  matter: Pick<Matter, "id" | "managerId">,
  assigneeId: string | null,
): Promise<void> {
  if (assigneeId === null) return;
  const [active] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, assigneeId), isNull(users.archivedAt)))
    .limit(1);
  if (!active) throw httpError(400, INVALID_ASSIGNEE);
  if (matter.managerId === assigneeId) return;
  const [onTeam] = await tx
    .select({ userId: matterTeam.userId })
    .from(matterTeam)
    .where(and(eq(matterTeam.matterId, matter.id), eq(matterTeam.userId, assigneeId)))
    .limit(1);
  if (!onTeam) throw httpError(400, INVALID_ASSIGNEE);
}

async function nextDisplayOrder(tx: Transaction, matterId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${matterTasks.displayOrder}), -1)` })
    .from(matterTasks)
    .where(eq(matterTasks.matterId, matterId));
  return (row?.max ?? -1) + 1;
}

/** Add one ordinary checklist row inside a caller-owned transaction. */
export async function createMatterTask(
  tx: Transaction,
  input: CreateMatterTaskInput,
): Promise<{ id: string }> {
  await assertValidMatterTaskAssignee(tx, input.matter, input.assigneeId);
  const [created] = await tx
    .insert(matterTasks)
    .values({
      matterId: input.matter.id,
      title: input.title,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      displayOrder: await nextDisplayOrder(tx, input.matter.id),
    })
    .returning({ id: matterTasks.id });
  await recordActivity(tx, {
    entityType: "matter",
    entityId: input.matter.id,
    actorId: input.actorId,
    action: "task.added",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { taskId: created!.id, title: input.title },
  });
  return created!;
}
