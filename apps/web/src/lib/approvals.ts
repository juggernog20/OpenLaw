// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The approvals vocabulary the contract record's Approvals section
 * reads (M14/3, CTR-012): the row shape the API answers, the DES-005
 * pill family each decision draws in, and the four calls the section
 * makes.
 *
 * **The roster is read and answered whole.** Every write answers the
 * record's whole roster rather than the row it was addressed at, and
 * the section replaces what it holds. That matters on a re-request
 * after a rejection, which adds a row rather than changing one, and on
 * a cancellation, which takes one away — in both cases more of the
 * roster moves than the row the caller pointed at.
 *
 * **Order is the server's.** Oldest ask first, so a rejection reads
 * above the ask that answers it. Nothing here sorts anything.
 */

import type { paths } from "@openlaw/api-client";
import { UNRESOLVED_APPROVAL_STATUSES } from "@openlaw/shared";
import { api } from "./api";
import { problem, type Problem } from "./problem";

/** The API's answer for one contract's approvals, aliased to the
 * generated schema so an API change surfaces as a compile error here
 * rather than as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/approvals"]["get"]["responses"]["200"]["content"]["application/json"];

export type ContractApproval = ListResponse["approvals"][number];
export type ApprovalStatus = ContractApproval["status"];
/** The two answers an approver may give. A pending row has neither. */
export type ApprovalDecision = Exclude<ApprovalStatus, "pending">;

/** What a read or a write over the record's approvals answers: the
 * roster as it now stands, or why not. */
export type ApprovalsOutcome =
  { ok: true; approvals: ContractApproval[] } | ({ ok: false } & Problem);

/**
 * The decision pill's family (DES-005's paired status-pill families,
 * grill-plan H.X1).
 *
 * Waiting on a named person is `assigned`, which is the same family the
 * approval **stage** takes in `STAGE_PILL` — the pipeline and the
 * roster say the same thing about the same contract, so they say it in
 * the same colour. An approval is `success` and a rejection is
 * `danger`: those are the two outcomes, and DES-005 already spends
 * those families on exactly that reading elsewhere.
 */
export const APPROVAL_PILL: Record<ApprovalStatus, string> = {
  pending: "bg-status-assigned-bg text-status-assigned-fg",
  approved: "bg-status-success-bg text-status-success-fg",
  rejected: "bg-status-danger-bg text-status-danger-fg",
};

/**
 * An ask CTR-012's soft gate counts as unresolved — pending, or a
 * rejection nobody re-requested.
 *
 * The two states come from `@openlaw/shared`, which is the same list
 * the seam refuses on. A client that decided this for itself could name
 * a different set than the refusal it is explaining.
 */
export const isUnresolved = (approval: ContractApproval): boolean =>
  (UNRESOLVED_APPROVAL_STATUSES as readonly string[]).includes(approval.status);

export async function readContractApprovals(contractNumber: number): Promise<ApprovalsOutcome> {
  const result = await api
    .GET("/api/v1/contracts/{number}/approvals", {
      params: { path: { number: contractNumber } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, approvals: result.data.approvals }
    : { ok: false, ...(await problem(result)) };
}

/**
 * Asks named colleagues to sign the contract off (CTR-012).
 *
 * Every approver named goes in one request, because they are one act:
 * the seam creates them together or refuses them together, so a list
 * with one ineligible person in it never lands half of itself.
 */
export async function requestContractApprovals(
  contractNumber: number,
  approverIds: readonly string[],
): Promise<ApprovalsOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/approvals", {
      params: { path: { number: contractNumber } },
      body: { approverIds: [...approverIds] },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, approvals: result.data.approvals }
    : { ok: false, ...(await problem(result)) };
}

/**
 * Applies an approver group to the contract (CTR-012).
 *
 * One call for a whole template, because applying it is one act: the
 * seam snapshots the group's current members onto the record, skips
 * anybody who already has a request open, and refuses the apply
 * outright when that leaves nobody to ask.
 *
 * It answers the whole roster, exactly as a named ask does — the same
 * door, so the section replaces what it holds and never has to work out
 * which rows the apply added.
 */
export async function applyApproverGroup(
  contractNumber: number,
  groupId: string,
): Promise<ApprovalsOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/approvals/group", {
      params: { path: { number: contractNumber } },
      body: { groupId },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, approvals: result.data.approvals }
    : { ok: false, ...(await problem(result)) };
}

/** Approves or rejects one request, with an optional note. Final: the
 * seam refuses a second decision on the same row. */
export async function decideContractApproval(
  approvalId: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<ApprovalsOutcome> {
  const result = await api
    .POST("/api/v1/approvals/{approvalId}/decision", {
      params: { path: { approvalId } },
      body: { decision, ...(note ? { note } : {}) },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, approvals: result.data.approvals }
    : { ok: false, ...(await problem(result)) };
}

/**
 * Withdraws a pending request.
 *
 * The row is deleted and the activity entry is what is left of it
 * (CTR-012), so the roster comes back one row shorter and the section
 * replaces what it holds rather than working out which row went.
 */
export async function cancelContractApproval(approvalId: string): Promise<ApprovalsOutcome> {
  const result = await api
    .DELETE("/api/v1/approvals/{approvalId}", {
      params: { path: { approvalId } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, approvals: result.data.approvals }
    : { ok: false, ...(await problem(result)) };
}
