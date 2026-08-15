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
