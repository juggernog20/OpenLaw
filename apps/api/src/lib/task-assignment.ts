// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-005 and CTR-017 add Task assignees to teams. Membership, assignment, activity and notification commit together. */

import { and, eq, contractTeam, matterTeam, users } from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";
import { confidentialityWrite } from "./contract-access.js";
import { matterConfidentialityWrite } from "./matter-access.js";
import { addContractTeamMember } from "./contract-team.js";
import { addMatterTeamMember } from "./matter-team.js";
import type { Notifier, NotifyingTransaction } from "./notifications/notifier.js";
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
  tx: NotifyingTransaction,
  notifier: Notifier,
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
  // A Contract team row narrates and notifies through one write
  // (CTR-026). A Matter has no team notification yet, so its write only
  // narrates.
  if (kind === "contract") await addContractTeamMember(tx, notifier, record, actor, person);
  else await addMatterTeamMember(tx, record, actor, person);
}
