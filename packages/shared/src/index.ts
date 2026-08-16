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

/**
 * The two refusals a send branches on (CTR-013, TECH-020's pattern).
 *
 * They are here for `SOFT_GATE_PROBLEM_TYPE`'s reason: both ends of the
 * wire have to say the same string. The API throws them, and the record
 * uses them to decide whether the send control belongs on the card at
 * all — so a drifted copy would not fail loudly, it would simply draw a
 * control the seam then refuses.
 *
 * A client must never tell these apart by reading `detail`. That is
 * copy, and copy is rewritten.
 */
/** This install has no e-signature connector, so nothing can be sent. */
export const SIGNING_NOT_CONFIGURED_PROBLEM_TYPE = "urn:openlaw:problem:signing-not-configured";
/** The contract already has an envelope out, and two envelopes must
 * never race for one signature. */
export const ENVELOPE_LIVE_PROBLEM_TYPE = "urn:openlaw:problem:envelope-live";

/**
 * How many people one envelope may be sent to (CTR-013).
 *
 * A bound rather than a preference, and a generous one: naming a
 * handful of signers by hand is a real ask, and a deal with more than
 * ten of them is not what this product is for. Shared because the
 * dialog stops adding rows at it and the send request refuses past it —
 * two literals for one wire contract would let the dialog offer a
 * signer the seam then rejects.
 */
export const MAX_ENVELOPE_SIGNERS = 10;

/**
 * The ceiling on the invitation's subject line (CTR-013).
 *
 * It is one line in somebody else's inbox, not a message: the record's
 * long-form conversation is its comments (CMT-004), and v1's signing
 * seam carries a subject and no body.
 */
export const MAX_ENVELOPE_SUBJECT_LENGTH = 200;
