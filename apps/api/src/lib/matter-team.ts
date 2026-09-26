// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023 team writes share guard order and DD-017 activity with the Matter routes. */
import { and, eq, matterTeam, users, type Transaction } from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";
import {
  assertAudienceActor,
  assertEditable,
  lockedMatter,
  lockedLiveUser,
  selectTeam,
} from "../modules/matters/record.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "./activity.js";
import { httpError } from "./problem.js";
import { teamPersonId, type TeamPerson } from "./team-person.js";

type MatterContext = Awaited<ReturnType<typeof lockedMatter>>;

async function assertMayChangeTeam(
  tx: Transaction,
  current: MatterContext,
  actor: AuthenticatedUser,
) {
  if (current.row.isConfidential)
    await assertAudienceActor(
      tx,
      current,
      actor,
      "Only an Administrator, the matter's creator, or its Matter Manager can change the team on a confidential matter.",
    );
}

/** Owner assignment keeps existing membership and writes activity only for a new member. */
export async function addMatterTeamMember(
  tx: Transaction,
  record: { id: string; number: number; title: string },
  actor: { id: string },
  person: { id: string; displayName: string },
): Promise<boolean> {
  const inserted = await tx
    .insert(matterTeam)
    .values({ matterId: record.id, userId: person.id })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return false;
  await recordActivity(tx, {
    entityType: "matter",
    entityId: record.id,
    actorId: actor.id,
    action: "matter.team_added",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { number: record.number, title: record.title, member: person.displayName },
  });
  return true;
}

export async function addToMatterTeam(
  tx: Transaction,
  current: MatterContext,
  actor: AuthenticatedUser,
  target: TeamPerson,
) {
  await assertMayChangeTeam(tx, current, actor);
  assertEditable(current);
  const person = await lockedLiveUser(tx, await teamPersonId(tx, target));
  if (!(await addMatterTeamMember(tx, current.row, actor, person)))
    throw httpError(409, "This person is already on the team.");
  return selectTeam(tx, current.row.id);
}

export async function removeMatterTeamMember(
  tx: Transaction,
  current: MatterContext,
  actor: AuthenticatedUser,
  target: TeamPerson,
) {
  await assertMayChangeTeam(tx, current, actor);
  assertEditable(current);
  const userId = await teamPersonId(tx, target);
  if (userId === current.row.businessOwnerId)
    throw httpError(409, "Change the Business Owner before removing this person from the team.");
  const [removed] = await tx
    .delete(matterTeam)
    .where(and(eq(matterTeam.matterId, current.row.id), eq(matterTeam.userId, userId)))
    .returning();
  if (!removed) throw httpError(404, "This person is not on the matter team.");
  const [person] = await tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  await recordActivity(tx, {
    entityType: "matter",
    entityId: current.row.id,
    actorId: actor.id,
    action: "matter.team_removed",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      number: current.row.number,
      title: current.row.title,
      member: person?.displayName ?? userId,
    },
  });
  return selectTeam(tx, current.row.id);
}
