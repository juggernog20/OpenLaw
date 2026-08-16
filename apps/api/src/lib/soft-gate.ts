// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The soft gate on stage advancement (CTR-012, CTR-001).
 *
 * This is the first server-side code that **branches on stage**. It
 * reads the `stage` of the status a contract is leaving and the stage
 * of the status it is moving to, and nothing else — never a label, and
 * never a slug. CTR-001 put the six-stage backbone there precisely so
 * approvals, e-signature, and renewals could branch on a fixed enum
 * while a team renames "Awaiting approval" to whatever it calls it.
 *
 * **The rule is one sentence.** Moving a contract from a stage at or
 * before `approval` to a stage after `approval`, while the record holds
 * an approval nobody has resolved, is refused once and allowed on the
 * second ask. The second ask carries the override flag, and it writes
 * the override into the activity log.
 *
 * **It warns; it never blocks** (CTR-012, MTR-008's signal-not-lock
 * philosophy). CTR-001 leaves transitions unrestricted because real
 * deals collapse and reopen, and a hard gate would block the legitimate
 * small-team case where the person holding the policy and the person
 * overriding it are the same human. So the gate costs one deliberate
 * press, and the press is what the audit trail records.
 *
 * **Unresolved means pending *or* rejected** (CTR-012 says
 * "pending/rejected"). A rejection that nobody answered with a fresh
 * ask is exactly the case the warning exists for: somebody said no, and
 * the contract is on its way to signature anyway. Only an approval
 * resolves an ask.
 *
 * **Regression never trips it.** The gate asks whether the contract
 * crossed the approval line going forward. Moving back — signature to
 * review, active to draft — is legal (CTR-001), and warning about
 * sign-off on the way *back* would be a warning about nothing.
 *
 * It lives beside the status commit rather than inside the contracts
 * module because it is one rule about two modules: the contracts PATCH
 * is the only door it guards today, and the shape of that rule belongs
 * with the approvals it reads.
 */

import { and, contractApprovals, eq, inArray, users, CONTRACT_STAGES } from "@openlaw/db";
import type { ContractStage, Executor } from "@openlaw/db";
import {
  SOFT_GATE_PROBLEM_TYPE,
  UNRESOLVED_APPROVAL_STATUSES,
  type UnresolvedApprovalStatus,
} from "@openlaw/shared";
import { httpError } from "./problem.js";

/** The line the gate is drawn at (CTR-001). */
const APPROVAL_STAGE: ContractStage = "approval";

/** An ask nobody has resolved, as the refusal and the override entry
 * both name it. */
export interface UnresolvedApproval {
  id: string;
  approverId: string;
  approverName: string;
  /** `pending` or `rejected` — the two CTR-012 calls unresolved. */
  status: UnresolvedApprovalStatus;
}

/** Where a stage sits in the CTR-001 canonical order. */
const stageIndex = (stage: ContractStage): number => CONTRACT_STAGES.indexOf(stage);

/**
 * Does this move cross the approval line, going forward?
 *
 * At or before `approval` on the way in, after `approval` on the way
 * out. "At" is included on purpose: the ordinary path is `approval` →
 * `signature`, and a gate that only caught a jump from `review` would
 * miss every real advancement.
 */
export function crossesApprovalGate(from: ContractStage, to: ContractStage): boolean {
  const line = stageIndex(APPROVAL_STAGE);
  return stageIndex(from) <= line && stageIndex(to) > line;
}

/**
 * Every ask on one contract that nobody has resolved, oldest first.
 *
 * Read under the contract row's lock, which the status commit already
 * holds — so the set the refusal names is the set that was there when
 * the status was written, not a set that moved underneath it.
 */
export async function unresolvedApprovals(
  tx: Executor,
  contractId: string,
): Promise<UnresolvedApproval[]> {
  const rows = await tx
    .select({
      id: contractApprovals.id,
      approverId: contractApprovals.approverId,
      approverName: users.displayName,
      status: contractApprovals.status,
    })
    .from(contractApprovals)
    .innerJoin(users, eq(contractApprovals.approverId, users.id))
    .where(
      and(
        eq(contractApprovals.contractId, contractId),
        inArray(contractApprovals.status, [...UNRESOLVED_APPROVAL_STATUSES]),
      ),
    )
    .orderBy(contractApprovals.createdAt, contractApprovals.id);
  return rows.map((row) => ({
    id: row.id,
    approverId: row.approverId,
    approverName: row.approverName,
    status: row.status as UnresolvedApprovalStatus,
  }));
}

/** "Sarah Chen (pending) and Marcus Webb (rejected)" — the refusal
 * names them, because who is unresolved is the thing the reader acts
 * on. */
function nameThem(rows: readonly UnresolvedApproval[]): string {
  const parts = rows.map((row) => `${row.approverName} (${row.status})`);
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Asks the gate about one status change, inside the transaction that is
 * committing it.
 *
 * Answers `null` when the gate has nothing to say — the move does not
 * cross the line, or every ask on the record is answered. Throws the
 * 409 when it does have something to say and the caller did not
 * override. Answers the unresolved set when the caller **did**
 * override, so the caller narrates it.
 *
 * The order matters: the cheap stage comparison runs first, so an
 * ordinary edit never reads the approvals table at all.
 */
export async function assertApprovalGate(
  tx: Executor,
  contractId: string,
  from: ContractStage,
  to: ContractStage,
  override: boolean,
): Promise<UnresolvedApproval[] | null> {
  if (!crossesApprovalGate(from, to)) return null;
  const unresolved = await unresolvedApprovals(tx, contractId);
  if (unresolved.length === 0) return null;
  if (!override) {
    throw httpError(
      409,
      `This contract has unresolved approvals: ${nameThem(unresolved)}. ` +
        "Confirm the move to record it as an override.",
      { type: SOFT_GATE_PROBLEM_TYPE },
    );
  }
  return unresolved;
}
