// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @openlaw/shared — types and utilities shared between the API, worker, and web app.
 * Built to dist/ so runtime consumers load plain JS (no type stripping).
 */

/**
 * The product's version, as `GET /api/v1/meta` and the OpenAPI document
 * answer it. A literal rather than a value read from a `package.json`,
 * because this package is bundled into the browser.
 *
 * The root `package.json` is the source of truth and this line quotes
 * it. `pnpm lint:versions` fails the build when the two disagree, so a
 * release bump that misses one of them cannot ship (#391).
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
  TaxonomyActionPrefix,
  TypeFieldActionPrefix,
} from "./activity.js";
// `EmptyActivityPayload` and `FieldChangePayload` are deliberately not
// re-exported. They are how `ActivityPayloadMap` is written — the shapes
// a slug's entry resolves to — and a consumer reaches them by indexing
// the map (`ActivityPayloadMap["user.theme_changed"]`), which is the
// read that stays right when a slug's payload changes shape. Exporting
// them by name invites a narrator to annotate against the shape instead
// of against the slug, and that annotation keeps compiling after the two
// have parted company.

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
 * The two refusals a send may answer with (CTR-013, TECH-020's pattern).
 *
 * They are staged here for `SOFT_GATE_PROBLEM_TYPE`'s reason: both ends
 * of the wire have to say the same string, so the string is declared
 * once rather than copied to whichever side branches on it next. **Today
 * only the API side reads them** — it throws them and names them in the
 * route's OpenAPI examples. No web surface branches on either one yet;
 * the send control is drawn from the record's own state.
 *
 * The moment a surface wants to draw the send control from what the seam
 * would refuse, it imports these rather than typing the strings again. A
 * drifted copy would not fail loudly — it would simply draw a control
 * the seam then refuses.
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
 * A comment attachment has already been filed onto the record
 * (CMT-011). The refusal carries the Document and Version ids as problem
 * extensions so a stale dialog can point at the one filing that won
 * instead of inviting a duplicate round (TECH-020).
 */
export const COMMENT_ATTACHMENT_ALREADY_FILED_PROBLEM_TYPE =
  "urn:openlaw:problem:comment-attachment-already-filed";

/**
 * The two refusals a term write branches on (CTR-006, TECH-020).
 *
 * CTR-006's term data cannot contradict its own type: an evergreen
 * contract has no end, and only an auto-renewing one rolls. Both
 * refusals name themselves for `SOFT_GATE_PROBLEM_TYPE`'s reason —
 * both ends of the wire have to say the same string.
 *
 * A client that reads them knows the term *type* and the value
 * disagree, which is a different repair from every other 400 the same
 * PATCH can give: either the type changes or the value is dropped, and
 * only the client knows which of the two the person meant. **No client
 * reads them today** — the record draws its term controls from the saved
 * type, so it meets these refusals only when the record moved under it,
 * and it renders that as the generic error. They are staged for the
 * surface that wants to tell the two repairs apart.
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
 * How long a contract's title may be (CTR-003).
 *
 * Shared for `MAX_TASK_TITLE_LENGTH`'s reason: the create callable
 * deliberately validates no title — that is the caller's job — and it
 * now has two callers, the create route and INT-006's conversion. The
 * boxes that collect one restate the bound as `maxLength`, so a title
 * a dialog accepts is a title the seam takes.
 */
export const MAX_CONTRACT_TITLE_LENGTH = 200;

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

/**
 * The surfaces that can hold a saved view (DD-019).
 *
 * `contracts` is the only list with a managed table today. Matters,
 * documents, and entities join by adding their key here and a column
 * catalogue on their page — no migration, because the column is text
 * (DD-019 clause 3).
 *
 * Shared because the seam validates the key on every write and the web
 * app names it on every read. One typo in either copy would silently
 * save views nobody's list ever asks for.
 */
export const LIST_VIEW_SURFACES = ["contracts"] as const;
export type ListViewSurface = (typeof LIST_VIEW_SURFACES)[number];

/**
 * The ceiling on a saved view's name (DD-019).
 *
 * Long enough for "Renewals due this quarter", short enough to read in
 * a menu row without truncating. The database holds the same number as
 * a check constraint, because a name is the one part of a view a person
 * types.
 */
export const MAX_LIST_VIEW_NAME_LENGTH = 60;

/**
 * How many views one person may save per surface.
 *
 * A menu is the whole interface for choosing one (DES-046 clause 6), so
 * the bound is what still reads as a menu rather than a list needing its
 * own search. Nothing about the table needs it; the reader does.
 */
export const MAX_LIST_VIEWS_PER_SURFACE = 25;

/**
 * The columns the contracts list can be sorted by (DD-019 clause 2).
 *
 * A closed set, not "any column": each key names a SQL expression the
 * seam can order and keyset-page on, and the reference number breaks
 * every tie (CTR-024).
 *
 * Three groups of column are deliberately absent, each for its own
 * reason:
 *
 * - **Derived at read** — the notice deadline, days remaining, the
 *   renewal proposal. No index can serve an ordering the row does not
 *   hold, and the arithmetic behind them lives in the API rather than in
 *   the table (CTR-006).
 * - **The contract value** (CTR-010). It is an amount, a currency, and a
 *   cadence, and there is no honest single order over the three: 500 GBP
 *   monthly against 900 USD one-time needs an exchange rate and a term,
 *   neither of which this product has. Ordering on the bare amount would
 *   answer confidently and wrongly. The named upgrade path is a stored
 *   normalized amount, which wants an FX decision first.
 * - **The custom fields** (CTR-016). They live in one `jsonb` map and
 *   are attached per type, so a sort over one of them orders a column
 *   most rows do not have.
 *
 * **Staged here rather than shared today.** The seam is the only reader:
 * `GET /contracts` builds its `sort` enum from this list and refuses a
 * key it does not know. The web app's column catalogue does mark a
 * column sortable by naming a sort key — but it writes those keys as
 * bare string literals against a `sortKey?: string` field, so nothing
 * ties the two lists together and a key dropped from here would not
 * break the build. It lives in `packages/shared` because that is where
 * the wire vocabulary belongs and because typing the catalogue's
 * `sortKey` as `ContractSortKey` is the one-line change that would make
 * the tie real. Until somebody makes it, this is one list with one
 * reader.
 */
export const CONTRACT_SORT_KEYS = [
  "number",
  "title",
  "type",
  "status",
  "owner",
  "counterparty",
  "entity",
  "risk",
  "priority",
  "effectiveDate",
  "expiryDate",
  "createdAt",
  "updatedAt",
] as const;
export type ContractSortKey = (typeof CONTRACT_SORT_KEYS)[number];

/** Which way a sorted column runs. */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * The refusal a disposition branches on (INT-007, TECH-020).
 *
 * INT-007 has no claim step, so two triagers open the same Request and
 * both press. The server transitions a Request only from `new`, under
 * its own row lock, and the loser is answered **the outcome that was
 * recorded** rather than a second decline, resolution, or conversion.
 *
 * It names itself for `SOFT_GATE_PROBLEM_TYPE`'s reason: both ends of
 * the wire have to say the same string. The dialog reads it to tell a
 * lost race — where the answer is "somebody already decided, here is
 * what they decided" — from every other 409 a disposition can give,
 * where the answer is "fix what you sent".
 *
 * The refusal carries the outcome as an RFC 9457 extension member,
 * `outcome`, holding one of {@link REQUEST_OUTCOMES}. The Request
 * attachment route also carries `request`, the R-### whose portal
 * detail owns the thread that takes paper now, and `convertedContract`
 * where conversion made one the caller reaches under DD-014 (INT-002's
 * #438 addendum). A client must
 * never read any of those facts out of `detail`. That is copy, and copy
 * is rewritten.
 */
export const REQUEST_DISPOSITIONED_PROBLEM_TYPE = "urn:openlaw:problem:request-dispositioned";

/**
 * The three states a dispositioned Request can be in (INT-007) — the
 * lifecycle minus `new`.
 *
 * It is the vocabulary of the `outcome` extension member above, and it
 * is here rather than in one end because both ends read it: the seam
 * puts one of these on the refusal, and the dialog switches on it to
 * say what happened. `new` is not among them, because a Request still
 * at `new` is not a refusal at all.
 */
export const REQUEST_OUTCOMES = ["converted", "resolved", "declined"] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

/**
 * The seam's ceiling on a decline reason (INT-006, required).
 *
 * Longer than an approval note, because this is the whole of the answer
 * the requester gets: it is what the decline email carries and what the
 * portal banner renders verbatim. Shorter than a conversation, because
 * the conversation is the thread (CMT-004) and a decline that needs
 * paragraphs should be a Full Thread reply first.
 *
 * Shared for `MAX_APPROVAL_NOTE_LENGTH`'s reason: the box refuses a
 * longer reason and the route refuses it again, and two literals for
 * one wire contract would let the box keep accepting text the seam has
 * stopped taking.
 */
export const MAX_DECLINE_REASON_LENGTH = 2000;

/**
 * The seam's ceiling on a comment body (CMT-004), and on the closing
 * reply a resolution posts through the same call (INT-007).
 *
 * Where every other free-text field in the product is capped. Shared for
 * `MAX_DECLINE_REASON_LENGTH`'s reason: a box that goes on taking text
 * the route has stopped taking sends somebody back to edit words they
 * already wrote, and the only way the box and the route stay agreed is
 * one number.
 */
export const MAX_COMMENT_BODY_LENGTH = 10_000;
