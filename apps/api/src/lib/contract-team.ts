// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-026 and NOT-009 commit membership, narration, and notification together. */
import { contractTeam } from "@openlaw/db";
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
