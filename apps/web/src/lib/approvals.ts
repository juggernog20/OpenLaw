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
import { api } from "./api";
import { problemDetail } from "./messages";

/** The API's answer for one contract's approvals, aliased to the
 * generated schema so an API change surfaces as a compile error here
 * rather than as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/approvals"]["get"]["responses"]["200"]["content"]["application/json"];

/** One approval request on a record (CTR-012). */
export type ContractApproval = ListResponse["approvals"][number];
export type ApprovalStatus = ContractApproval["status"];
/** The two answers an approver may give. A pending row has neither. */
export type ApprovalDecision = Exclude<ApprovalStatus, "pending">;

/** What a read or a write over the record's approvals answers: the
 * roster as it now stands, or why not. */
export type ApprovalsOutcome =
  { ok: true; approvals: ContractApproval[] } | { ok: false; detail?: string };

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

/** Reads one contract's approvals, whole. */
export async function readContractApprovals(contractNumber: number): Promise<ApprovalsOutcome> {
  const { data, error } = await api.GET("/api/v1/contracts/{number}/approvals", {
    params: { path: { number: contractNumber } },
  });
  return data
    ? { ok: true, approvals: data.approvals }
    : { ok: false, detail: problemDetail(error) };
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
  const { data, error } = await api.POST("/api/v1/contracts/{number}/approvals", {
    params: { path: { number: contractNumber } },
    body: { approverIds: [...approverIds] },
  });
  return data
    ? { ok: true, approvals: data.approvals }
    : { ok: false, detail: problemDetail(error) };
}

/** Approves or rejects one request, with an optional note. Final: the
 * seam refuses a second decision on the same row. */
export async function decideContractApproval(
  approvalId: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<ApprovalsOutcome> {
  const { data, error } = await api.POST("/api/v1/approvals/{approvalId}/decision", {
    params: { path: { approvalId } },
    body: { decision, ...(note ? { note } : {}) },
  });
  return data
    ? { ok: true, approvals: data.approvals }
    : { ok: false, detail: problemDetail(error) };
}

/**
 * Withdraws a pending request.
 *
 * The row is deleted and the activity entry is what is left of it
 * (CTR-012), so the roster comes back one row shorter and the section
 * replaces what it holds rather than working out which row went.
 */
export async function cancelContractApproval(approvalId: string): Promise<ApprovalsOutcome> {
  const { data, error } = await api.DELETE("/api/v1/approvals/{approvalId}", {
    params: { path: { approvalId } },
  });
  return data
    ? { ok: true, approvals: data.approvals }
    : { ok: false, detail: problemDetail(error) };
}
