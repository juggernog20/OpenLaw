// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-026 and NOT-009 commit membership, narration, and notification together. */
import { and, eq, contractTeam, users, USER_ROLES, type Transaction } from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";
import {
  assertMayChangeTeam,
  assertEditable,
  lockedContract,
  lockedUser,
  selectTeam,
} from "../modules/contracts/record.js";
import { httpError } from "./problem.js";
import { teamPersonId, type TeamPerson } from "./team-person.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "./activity.js";
import type { Notifier, NotifyingTransaction } from "./notifications/notifier.js";

export async function addContractTeamMember(
  tx: NotifyingTransaction,
  notifier: Notifier,
  record: { id: string; number: number; title: string },
  actor: { id: string; displayName: string },
  person: { id: string; displayName: string },
): Promise<boolean> {
  const inserted = await tx
    .insert(contractTeam)
    .values({ contractId: record.id, userId: person.id })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return false;
  await recordActivity(tx, {
    entityType: "contract",
    entityId: record.id,
    actorId: actor.id,
    action: "contract.team_added",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { number: record.number, title: record.title, member: person.displayName },
  });
  await notifier.contractTeamAdded(tx, {
    contractId: record.id,
    contractNumber: record.number,
    contractTitle: record.title,
    actorId: actor.id,
    actorName: actor.displayName,
    userId: person.id,
  });
  return true;
}

/** Legal team changes share the HTTP guard order; Portal additions keep their own guards. */
export async function addToContractTeam(
  tx: NotifyingTransaction,
  notifier: Notifier,
  current: Awaited<ReturnType<typeof lockedContract>>,
  actor: AuthenticatedUser,
  target: TeamPerson,
) {
  await assertMayChangeTeam(tx, current, actor);
  assertEditable(current);
  const userId = await teamPersonId(tx, target);
  const person = await lockedUser(tx, userId, USER_ROLES, "That is not a person we can add.");
  if (!(await addContractTeamMember(tx, notifier, current.row, actor, person)))
    throw httpError(409, "This person is already on the team.");
  return selectTeam(tx, current.row.id);
}

export async function removeContractTeamMember(
  tx: Transaction,
  current: Awaited<ReturnType<typeof lockedContract>>,
  actor: AuthenticatedUser,
  target: TeamPerson,
) {
  await assertMayChangeTeam(tx, current, actor);
  assertEditable(current);
  const userId = await teamPersonId(tx, target);
  if (userId === current.row.businessOwnerId)
    throw httpError(409, "Change the Business Owner before removing this person from the team.");
  const [removed] = await tx
    .delete(contractTeam)
    .where(and(eq(contractTeam.contractId, current.row.id), eq(contractTeam.userId, userId)))
    .returning();
  if (!removed) throw httpError(404, "This person is not on the contract team.");
  const [person] = await tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  await recordActivity(tx, {
    entityType: "contract",
    entityId: current.row.id,
    actorId: actor.id,
    action: "contract.team_removed",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      number: current.row.number,
      title: current.row.title,
      member: person?.displayName ?? userId,
    },
  });
  return selectTeam(tx, current.row.id);
}
