// SPDX-License-Identifier: AGPL-3.0-only

/** Advance confirmed sends forward without replacing a newer Status choice. */

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
import {
  crossesApprovalGate,
  recordGateOverride,
  sendMovesStage,
  unresolvedApprovals,
} from "../soft-gate.js";
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
 * at preparation still holds. Preparing or saving a draft does not advance it.
 *
 * The Soft gate was asked when the round was reserved, and a round that
 * would cross it was reserved only with the override. So when the gate
 * still has something to say here, the move records the override in the
 * preparer's name. */
export async function advanceSentContractStage(
  tx: NotifyingTransaction,
  notifier: Notifier,
  envelope: Pick<
    ContractEnvelope,
    "contractId" | "creationKind" | "creationStatusId" | "creationStatusRevision" | "sentBy"
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
  await moveSentContract(tx, notifier, contract, null, envelope.sentBy);
}

/**
 * Moves a Contract to its first live Signature status after a confirmed
 * send, inside the transaction that records the send.
 *
 * The move goes forward only. A Contract already at `signature`, or
 * Active, or Ended, keeps its Status and its ended date, and the answer
 * is `kept`. The answer is `unconfigured` when a move is owed and no
 * live Signature status exists.
 *
 * A move that crosses the approval line while an Approval request is
 * still unresolved records CTR-012's override beside the status change.
 * The caller asked the gate before the provider was called, so the
 * override was already given. `overrideActorId` names who gave it when
 * the move itself has no person behind it.
 */
export async function moveSentContract(
  tx: NotifyingTransaction,
  notifier: Notifier,
  contract: { id: string; number: number; title: string },
  actor: { id: string; displayName: string } | null,
  overrideActorId?: string,
): Promise<"moved" | "kept" | "unconfigured"> {
  const [current] = await tx
    .select({
      id: contractStatuses.id,
      displayName: contractStatuses.displayName,
      stage: contractStatuses.stage,
    })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(eq(contracts.id, contract.id));
  if (!current || !sendMovesStage(current.stage)) return "kept";
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
  if (!signature) return "unconfigured";
  const overridden = crossesApprovalGate(current.stage, signature.stage)
    ? await unresolvedApprovals(tx, contract.id)
    : [];
  await tx.update(contracts).set({ statusId: signature.id }).where(eq(contracts.id, contract.id));
  const change = {
    from: current.displayName,
    to: signature.displayName,
    fromStage: current.stage,
    toStage: signature.stage,
  };
  await recordActivity(tx, {
    entityType: "contract",
    entityId: contract.id,
    ...(actor ? { actorId: actor.id } : {}),
    action: "contract.status_changed",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { number: contract.number, title: contract.title, ...change },
  });
  if (overridden.length > 0) {
    const gateActorId = actor?.id ?? overrideActorId;
    await recordGateOverride(tx, {
      contractId: contract.id,
      ...(gateActorId === undefined ? {} : { actorId: gateActorId }),
      number: contract.number,
      title: contract.title,
      fromStage: change.fromStage,
      toStage: change.toStage,
      overridden,
    });
  }
  await notifier.statusChanged(tx, {
    contractId: contract.id,
    actorId: actor?.id ?? null,
    actorName: actor?.displayName ?? null,
    ...change,
  });
  return "moved";
}
