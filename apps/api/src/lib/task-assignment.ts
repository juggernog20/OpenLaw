// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, contractTeam, matterTeam, users, type Transaction } from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "./activity.js";
import { confidentialityWrite } from "./contract-access.js";
import { matterConfidentialityWrite } from "./matter-access.js";
import { httpError } from "./problem.js";

type TaskRecord = {
  id: string;
  number: number;
  title: string;
  managerId: string | null;
  isConfidential: boolean;
};

/** Caller holds the record lock; membership, assignment, and notification commit together. */
export async function prepareTaskAssignee(
  tx: Transaction,
  kind: "contract" | "matter",
  record: TaskRecord,
  actor: AuthenticatedUser,
  assigneeId: string | null | undefined,
  addToTeam = false,
): Promise<void> {
  if (!assigneeId) {
    if (addToTeam) throw httpError(400, "Choose an assignee to add to the team.");
    return;
  }
  const [person] = await tx.select().from(users).where(eq(users.id, assigneeId)).for("update");
  if (!person || person.archivedAt || person.role === "business_user") {
    throw httpError(400, "Choose an active staff member as the assignee.");
  }
  if (record.managerId === assigneeId) return;
  const table = kind === "contract" ? contractTeam : matterTeam;
  const recordId = kind === "contract" ? contractTeam.contractId : matterTeam.matterId;
  const [member] = await tx
    .select({ userId: table.userId })
    .from(table)
    .where(and(eq(recordId, record.id), eq(table.userId, assigneeId)))
    .limit(1);
  if (member) return;
  if (!addToTeam) throw httpError(400, "Add this person to the team before assigning a task.");
  if (record.isConfidential) {
    const verdict =
      kind === "contract"
        ? await confidentialityWrite(tx, actor, record)
        : await matterConfidentialityWrite(tx, actor, record);
    if (verdict !== "allowed")
      throw httpError(403, "You cannot add people to this confidential record's team.");
  }
  const role = person.role === "contributor" ? "contributor" : "member";
  if (kind === "contract") {
    await tx.insert(contractTeam).values({ contractId: record.id, userId: assigneeId, role });
  } else {
    await tx.insert(matterTeam).values({ matterId: record.id, userId: assigneeId, role });
  }
  await recordActivity(tx, {
    entityType: kind,
    entityId: record.id,
    actorId: actor.id,
    action: kind === "contract" ? "contract.team_added" : "matter.team_added",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { number: record.number, title: record.title, member: person.displayName, role },
  });
}
