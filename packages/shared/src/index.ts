// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @openlaw/shared — types and utilities shared between the API, worker, and web app.
 * Built to dist/ so runtime consumers load plain JS (no type stripping).
 */

export const OPENLAW_VERSION = "0.0.1";

/**
 * The Activity vocabulary (DD-017) — the action slugs and the payload
 * each one writes. It is a module of its own because it is long, and it
 * is re-exported here because `@openlaw/shared` has one entry point.
 */
export type {
  ActivityAction,
  ActivityPayloadMap,
  ChangedFields,
  EmptyActivityPayload,
  FieldChangePayload,
  TaxonomyActionPrefix,
  TypeFieldActionPrefix,
} from "./activity.js";

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
 * The two refusals a term write branches on (CTR-006, TECH-020).
 *
 * CTR-006's term data cannot contradict its own type: an evergreen
 * contract has no end, and only an auto-renewing one rolls. Both
 * refusals name themselves for `SOFT_GATE_PROBLEM_TYPE`'s reason —
 * both ends of the wire have to say the same string.
 *
 * A client reads them to know that the term *type* and the value
 * disagree, which is a different repair from every other 400 the same
 * PATCH can give: either the type changes or the value is dropped, and
 * only the client knows which of the two the person meant. The record
 * uses the same rule to decide which of the term controls it draws at
 * all, so it meets these refusals only when the record moved under it.
 *
 * A client must never tell these apart by reading `detail`. That is
 * copy, and copy is rewritten.
 */
/** An expiry date was sent for a contract whose term type is
 * `evergreen`. */
export const TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE = "urn:openlaw:problem:term-expiry-on-evergreen";
/** A renewal period was sent for a contract whose term type is not
 * `auto_renew`. */
export const TERM_RENEWAL_PERIOD_PROBLEM_TYPE = "urn:openlaw:problem:term-renewal-period";

/**
 * The refusal a confirmed roll branches on (CTR-006, CTR-007, TECH-020).
 *
 * A roll is confirmed against the expiry the person was looking at. The
 * request carries that date, the seam compares it under the contract's
 * row lock, and a mismatch is refused — so two people confirming the
 * same roll at the same moment advance the term **once**, and the
 * second one is told the record moved rather than rolling it a second
 * time.
 *
 * It names itself for `SOFT_GATE_PROBLEM_TYPE`'s reason: both ends of
 * the wire have to say the same string. The dialog reads it to tell a
 * lost race — where the answer is "look again, the term has already
 * advanced" — from every other 400 the same confirm can give, where the
 * answer is "fix what you typed".
 *
 * A client must never tell these apart by reading `detail`. That is
 * copy, and copy is rewritten.
 */
export const RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE = "urn:openlaw:problem:renewal-expiry-moved";

/**
 * The two refusals a relation write branches on (CTR-015, TECH-020).
 *
 * CTR-015 states both rules and leaves both to the application, because
 * neither can be said by a single row: a duplicate is a second row for
 * one pair and one type, and a cycle is a walk up the parent chain. Both
 * are also database rules — the compound primary key and the
 * not-your-own-parent check — but the database says them as a constraint
 * violation, and a caller needs an answer.
 *
 * They name themselves for `SOFT_GATE_PROBLEM_TYPE`'s reason: both ends
 * of the wire have to say the same string. A client reads them to tell a
 * link that already exists — where the repair is to stop, because the
 * record already says what the caller wanted it to say — from a link
 * that would fold the hierarchy back on itself, where the repair is to
 * pick another parent.
 *
 * A client must never tell these apart by reading `detail`. That is
 * copy, and copy is rewritten.
 */
/** A link of this type already runs between these two contracts, in
 * this direction (CTR-015's one-row-per-pair-per-type guard). */
export const CONTRACT_RELATION_EXISTS_PROBLEM_TYPE = "urn:openlaw:problem:contract-relation-exists";
/** The proposed parent already sits under the contract it was asked to
 * parent, so setting it would close a loop (CTR-015's no-cycles rule). */
export const CONTRACT_PARENT_CYCLE_PROBLEM_TYPE = "urn:openlaw:problem:contract-parent-cycle";
/** Both ends of the proposed link are the same contract. Its own type
 * rather than the cycle's, because the cycle names a *parent* and this
 * refusal answers every relation type; the repair is to pick another
 * far end, not another parent. */
export const CONTRACT_SELF_LINK_PROBLEM_TYPE = "urn:openlaw:problem:contract-self-link";

/**
 * The two bounds one key date is held to (CTR-009).
 *
 * A label is a line and a note is a paragraph. Neither is the record's
 * long-form conversation — that is what comments are for (CMT-004) — and
 * the deadline table draws both in one row, so a label that ran to a
 * paragraph would break the surface it exists for.
 *
 * Shared for `MAX_APPROVAL_NOTE_LENGTH`'s reason: the dialog's boxes
 * stop at these and the write refuses past them, and two literals for
 * one wire contract would let a box keep accepting text the seam has
 * stopped taking.
 */
export const MAX_KEY_DATE_LABEL_LENGTH = 200;
export const MAX_KEY_DATE_NOTE_LENGTH = 2000;

/**
 * One title constraint for the lightweight checklist (CTR-017). The
 * database's `btrim` guard and the route's Zod schema both say 200; this
 * keeps the input's `maxLength` in the same word.
 */
export const MAX_TASK_TITLE_LENGTH = 200;

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

/**
 * The ceiling on a decline's or a void's reason (CTR-013).
 *
 * Longer than a subject line, because this one is a sentence somebody
 * has to act on: "the indemnity cap is wrong" is what the record needs
 * back before the next round goes out. Shared because two mouths reach
 * it — a signer's words arrive over the provider's feed, and a voider
 * types theirs on the record — and both end up in the same cell.
 */
export const MAX_ENVELOPE_REASON_LENGTH = 1000;
