// SPDX-License-Identifier: AGPL-3.0-only

/** Preserve legacy direct-send Stage behavior during recovery without
 * replacing a newer Status choice (CTR-013, #1174). */

import {
  activityLog,
  and,
  asc,
  contracts,
  contractStatuses,
  eq,
  isNull,
  sql,
  type ContractEnvelope,
  type Executor,
} from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../activity.js";
import type { Notifier, NotifyingTransaction } from "../notifications/notifier.js";

/** Count Status changes, including a move away and back. Other edits do not
 * revoke the sender's request to advance to Signature. Activity is append-only. */
export async function contractStatusRevision(db: Executor, contractId: string): Promise<number> {
  const [row] = await db
    .select({ revision: sql<number>`count(*)::integer` })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "contract"),
        eq(activityLog.entityId, contractId),
        eq(activityLog.action, "contract.status_changed"),
      ),
    );
  return row!.revision;
}

/** Reproduce the direct-send Status change only while the original choice
 * still holds. Unknown historical intent never authorizes a Stage change. */
export async function recoverDirectSendStage(
  tx: NotifyingTransaction,
  notifier: Notifier,
  envelope: Pick<
    ContractEnvelope,
    "contractId" | "creationKind" | "creationStatusId" | "creationStatusRevision"
  >,
): Promise<void> {
  if (
    envelope.creationKind !== "send" ||
    !envelope.creationStatusId ||
    envelope.creationStatusRevision === null
  )
    return;
  const [contract] = await tx
    .select()
    .from(contracts)
    .where(eq(contracts.id, envelope.contractId))
    .for("update");
  if (
    !contract ||
    contract.archivedAt ||
    contract.statusId !== envelope.creationStatusId ||
    (await contractStatusRevision(tx, contract.id)) !== envelope.creationStatusRevision
  )
    return;
  const [current] = await tx
    .select()
    .from(contractStatuses)
    .where(eq(contractStatuses.id, contract.statusId));
  const [signature] = await tx
    .select()
    .from(contractStatuses)
    .where(and(eq(contractStatuses.stage, "signature"), isNull(contractStatuses.archivedAt)))
    .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt))
    .limit(1)
    .for("share");
  if (!current || !signature || current.id === signature.id) return;
  await tx
    .update(contracts)
    .set({ statusId: signature.id, endedAt: null })
    .where(eq(contracts.id, contract.id));
  const change = {
    from: current.displayName,
    to: signature.displayName,
    fromStage: current.stage,
    toStage: signature.stage,
  };
  await recordActivity(tx, {
    entityType: "contract",
    entityId: contract.id,
    action: "contract.status_changed",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { number: contract.number, title: contract.title, ...change },
  });
  await notifier.statusChanged(tx, {
    contractId: contract.id,
    actorId: null,
    actorName: null,
    ...change,
  });
}
