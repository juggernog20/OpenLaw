// SPDX-License-Identifier: AGPL-3.0-only

/** Advance confirmed sends without replacing a newer Status choice. */

import {
  activityLog,
  and,
  asc,
  contracts,
  contractStatuses,
  eq,
  isNull,
  ne,
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

/** Direct sends and embedded sends advance only while the Status recorded
 * at preparation still holds. Preparing or saving a draft does not advance it. */
export async function advanceSentContractStage(
  tx: NotifyingTransaction,
  notifier: Notifier,
  envelope: Pick<
    ContractEnvelope,
    "contractId" | "creationKind" | "creationStatusId" | "creationStatusRevision"
  >,
): Promise<void> {
  if (
    !envelope.creationKind ||
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
    .where(
      and(
        eq(contractStatuses.stage, "signature"),
        isNull(contractStatuses.archivedAt),
        ne(contractStatuses.slug, "partially_signed"),
      ),
    )
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
