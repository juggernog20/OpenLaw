// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @openlaw/shared — types and utilities shared between the API, worker, and web app.
 * Built to dist/ so runtime consumers load plain JS (no type stripping).
 */

export const OPENLAW_VERSION = "0.0.1";

/**
 * The RFC 9457 problem type CTR-012's soft gate refuses with (TECH-020).
 *
 * It is a wire contract, and it is here because both ends of the wire
 * have to say the same string: the API throws it, and the contract
 * record branches on it to raise its confirmation dialog. Two copies
 * that drifted would not fail loudly — the dialog would simply stop
 * appearing, and the warning the gate exists to give would be gone.
 */
export const SOFT_GATE_PROBLEM_TYPE = "urn:openlaw:problem:approval-soft-gate";

/**
 * The two approval states CTR-012 calls unresolved. An approval is the
 * only answer that resolves an ask, so a rejection nobody re-requested
 * still trips the gate.
 *
 * Shared for the same reason as the problem type: the API decides what
 * is unresolved, and the dialog lists what is unresolved. A state added
 * to one and not the other would refuse a move and then name nobody.
 */
export const UNRESOLVED_APPROVAL_STATUSES = ["pending", "rejected"] as const;
export type UnresolvedApprovalStatus = (typeof UNRESOLVED_APPROVAL_STATUSES)[number];

/**
 * CTR-001's fixed six-stage backbone, in canonical forward order.
 *
 * The order is a sequence, not a ratchet: a contract may move to any
 * status, so a stage may go backwards. The pipeline renders where the
 * contract sits in this list, never how far it has travelled.
 *
 * It is here rather than in one end because **both ends read the order,
 * and only one of them would notice a change.** The soft gate decides
 * whether a transition crosses the approval line by this index, and the
 * record's pipeline draws the marker by the same index. Membership
 * divergence between two copies fails to compile, because each is
 * checked against its own generated union — order divergence does not.
 * Reorder one copy and the gate silently stops agreeing with what the
 * pipeline draws.
 */
export const CONTRACT_STAGES = [
  "draft",
  "review",
  "approval",
  "signature",
  "active",
  "ended",
] as const;
export type ContractStage = (typeof CONTRACT_STAGES)[number];

/**
 * The seam's ceiling on an approval decision note (CTR-012, optional).
 *
 * The ceiling is a sentence or two, not an essay: the record's long-form
 * conversation is its comments (CMT-004), and the roster draws this in
 * one table cell. Shared because the box refuses a longer note and the
 * request refuses it again — two literals for one wire contract would
 * let the box keep truncating at a bound the seam no longer holds.
 */
export const MAX_APPROVAL_NOTE_LENGTH = 1000;
