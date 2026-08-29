// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Activity vocabulary (DD-017): every action slug, paired with the
 * shape of the payload it writes.
 *
 * **It is here, and not in one app, because both ends read it.** The API
 * writes the rows; the web narrator turns one row into a sentence. The
 * slug half was already a typed union on the API, but the payload half
 * was `Record<string, unknown>` on the write side and string literals on
 * the read side — so renaming a key at a write site compiled on both
 * ends and the narration quietly fell through to the unknown arm. This
 * module is that pairing, said once, for the reason `CONTRACT_STAGES` is
 * here: two copies of one contract only fail loudly when a compiler
 * holds both.
 *
 * **Rows are append-only and outlive the code** (DD-017). Two rules
 * follow, and neither is optional:
 *
 * - The read routes' wire schema stays `z.string()` for `action`. A slug
 *   this build has never heard of is still in the table, and a closed
 *   enum there would have the response serializer throw on it.
 * - The narrator keeps an explicit fallback arm, and reads every payload
 *   key defensively. A payload shape here describes what the writer
 *   writes *today*; a row written years ago may carry less.
 *
 * So this map is the compiler's contract with the write sites, not a
 * promise about what is in the table.
 */

/** Payload for actions fully described by their slug. */
export type EmptyActivityPayload = Record<never, never>;

/**
 * The `{field, old, new}` shape the settings, profile, identity
 * provider, and connector writers use. The payload names the key it
 * changed rather than the slug doing it, because one slug covers every
 * field on the surface.
 *
 * Both sides are `unknown`: a theme is a string, a domain allowlist is
 * an array, and a rotated secret is the literal `[secret]` on both
 * sides. The narrator renders whatever it finds (DES-014).
 */
export type FieldChangePayload = {
  field: string;
  old: unknown;
  new: unknown;
};

/** Values before and after an edit, keyed by field. */
export type ChangedFields = Record<string, { from: unknown; to: unknown }>;

/** Re-keys a payload table under one action prefix, so three taxonomies
 * that write the same seven verbs are declared once. */
type Prefixed<P extends string, M> = { [K in keyof M & string as `${P}.${K}`]: M[K] };

// The taxonomies (#85: one machinery each)

/** The taxonomy tables' audit namespaces. */
export type TaxonomyActionPrefix =
  "contract_type" | "matter_type" | "entity_type" | "officer_role" | "request_type";
/** The catalogs of fields attached to a type — two type editors, and
 * the request type's form definition (INT-002), which is the same
 * machinery over the same catalog. */
export type TypeFieldActionPrefix =
  "contract_type_field" | "entity_type_field" | "matter_type_field" | "request_type_field";

/**
 * The seven verbs a settings taxonomy writes. A rename carries the pair
 * directly; an edit of the description carries the `changed` map, so the
 * viewer narrates it with the same helper every other edit uses.
 */
type TaxonomyPayloads = {
  created: { slug: string; displayName: string };
  renamed: { slug: string; from: string; to: string };
  updated: { slug: string; changed: ChangedFields };
  reordered: { order: string[] };
  /** `reassignedTo` names the type the rows moved to, or null when none
   * were using this one. */
  archived: {
    slug: string;
    displayName: string;
    inUseCount: number;
    reassignedTo: string | null;
  };
  restored: { slug: string; displayName: string };
  deleted: { slug: string; displayName: string };
};

/** The four verbs an attached-field catalog writes. */
type TypeFieldPayloads = {
  attached: { typeSlug: string; fieldSlug: string; isRequired: boolean };
  detached: { typeSlug: string; fieldSlug: string };
  reordered: { typeSlug: string; order: string[] };
  required_changed: { typeSlug: string; fieldSlug: string; isRequired: boolean };
};

// The whole vocabulary

/**
 * The profile and user administration (M5, SET-005). Each names the
 * person acted on by their email, because that is what an Administrator
 * searched for.
 */
type UserPayloads = {
  "user.theme_changed": FieldChangePayload;
  "user.timezone_changed": FieldChangePayload;
  /**
   * One notification preference, as the Personal → Notifications pane
   * saves it (NOT-001, M18/5).
   *
   * Not {@link FieldChangePayload}, because the thing changed is a pair
   * rather than a field: the group decides which events, the channel
   * decides where they land, and neither alone names what moved. There
   * is no `old` side either — the table holds overrides, so the value
   * before a first save is a default read out of application code and
   * not a stored fact this writer could report.
   */
  "user.notification_preference_changed": {
    /** One of NOT-002's five groups. */
    eventGroup: string;
    /** `in_app` or `email` (NOT-001's two channels). */
    channel: string;
    enabled: boolean;
  };
  "user.display_name_changed": FieldChangePayload;
  /** Presence-only: both sides are `[image]` or null, never the encoded
   * image — a data: URI in a payload would bloat every later query. */
  "user.avatar_changed": FieldChangePayload;
  "user.invited": { email: string; role: string };
  "user.invite_resent": { email: string };
  "user.invite_revoked": { email: string; role: string };
  "user.password_changed": EmptyActivityPayload;
  "user.other_sessions_revoked": EmptyActivityPayload;
  "user.two_factor_enrolled": EmptyActivityPayload;
  "user.two_factor_disabled": EmptyActivityPayload;
  "user.role_changed": { email: string; from: string; to: string };
  "user.archived": { email: string; role: string };
  "user.unarchived": { email: string; role: string };
  "user.sessions_revoked": { email: string; sessions: number };
};

/** The organization's own settings, one entry per changed field. */
type OrgSettingsPayloads = {
  "org_settings.updated": FieldChangePayload;
};

/**
 * The contract statuses (CTR-001). Nearly the taxonomy set, minus the
 * `updated` verb: a status has a stage rather than a description, so
 * there is no edit for it to write. Its payloads carry the stage, which
 * is the thing surfaces branch on.
 */
type ContractStatusPayloads = {
  "contract_status.created": { slug: string; displayName: string; stage: string };
  "contract_status.renamed": { slug: string; from: string; to: string };
  "contract_status.reordered": { order: string[] };
  "contract_status.archived": {
    slug: string;
    displayName: string;
    stage: string;
    inUseCount: number;
  };
  "contract_status.restored": { slug: string; displayName: string };
  "contract_status.deleted": { slug: string; displayName: string; stage: string };
};

/** Configurable matter statuses over the fixed open/closed category. */
type MatterStatusPayloads = {
  "matter_status.created": { slug: string; displayName: string; category: string };
  "matter_status.renamed": { slug: string; from: string; to: string };
  "matter_status.reordered": { order: string[] };
  "matter_status.archived": {
    slug: string;
    displayName: string;
    category: string;
    inUseCount: number;
    reassignedTo: string | null;
  };
  "matter_status.restored": { slug: string; displayName: string };
  "matter_status.deleted": { slug: string; displayName: string; category: string };
};

/**
 * The Request record (INT-001, INT-002, INT-007). A Request is born on
 * the portal, and triage decides its outcome. All three of INT-007's
 * dispositions narrate here (M21/7, M21/8, M21/9).
 *
 * The payload carries the Request's `number` and **no free text at
 * all** — not the summary, not the collected values, and not the
 * decline reason. Only the slugs that were answered. A `contract.*`
 * payload carries its title so an entry goes on naming the record after
 * a rename; a Request needs no such thing, because R-42 *is* its name
 * and the number never changes. And the difference matters here: DD-017
 * forbids `UPDATE` and `DELETE` on the log, and text that enters a
 * payload can never leave it — which is the same reason CMT-008 keeps
 * comment bodies out of `comment.*`. The reason a decline was given for
 * lives on the Request itself, where a correction can still reach it.
 */
type RequestPayloads = {
  "request.created": {
    number: number;
    requestType: string;
    urgency: string;
    /** The slugs the form answered, never the values. */
    customFields: string[];
  };
  /** INT-007's first disposition. Who declined is the actor on the row,
   * which is the audit datum INT-007 asks for; the entry says the act
   * and names the Request, and the reason stays on the record. */
  "request.declined": { number: number };
  /** INT-007's second disposition (M21/8): the ask was answered in the
   * thread and closed. The same shape the decline's entry has, for the
   * same reason — who resolved is the actor on the row, and the answer
   * itself is a comment on the thread rather than text in a payload. A
   * resolution with no closing reply looks identical here, because what
   * this entry records is the closure and not the answer. */
  "request.resolved": { number: number };
  /**
   * INT-007's third disposition (M21/9): the ask became a record.
   *
   * `contractNumber` is the whole of what the entry adds, and it is a
   * number rather than a title for the reason a Request's own payload
   * carries no title — C-42 *is* the contract's name and the sequence
   * never reissues it, so the sentence survives a rename and no free
   * text enters an append-only log. Conversion carries a module-aware
   * record reference internally; each module projects its own permanent
   * number key into this closed payload union. A Request becomes one
   * record, and the table already holds that as a check constraint.
   */
  "request.converted":
    { number: number; contractNumber: number } | { number: number; matterNumber: number };
  /**
   * The conversation left with the work (CMT-001, DD-017, M21/11).
   *
   * A conversion re-parents the Request's comment rows onto the record,
   * tiers intact, so legal answers in exactly one place from then on.
   * The entry is what a reader of the Request meets when they wonder
   * where the thread went, and the module-specific permanent number is
   * where it went.
   *
   * **It carries no count.** How many comments moved is how many
   * comments there were, at every tier, and this entry rides the
   * record tier a Contributor reads — a number here would say how much
   * Legal Only talk a Request held (DD-016). The entry states the move
   * and nothing about its size.
   *
   * A Request whose thread is empty writes no entry at all: nothing
   * moved, and a sentence about it would report on something that did
   * not happen.
   */
  "request.thread_moved":
    { number: number; contractNumber: number } | { number: number; matterNumber: number };
};

/**
 * The deflection links (INT-004). Four verbs, not the taxonomy's seven:
 * a link has no slug to key it, and it is removed outright rather than
 * archived — nothing points at one and there is no history to keep — so
 * `archived` and `restored` are sentences nobody would ever read.
 *
 * `placement` is the request type's **display name**, or null for the
 * portal home panel. The name rather than the id, because the id is
 * meaningless to somebody reading the log after the type is gone, and
 * the log is append-only.
 */
type IntakeLinkPayloads = {
  "intake_link.created": { label: string; url: string; placement: string | null };
  "intake_link.updated": { label: string; changed: ChangedFields };
  /** The labels in their new order — for the reason `placement` carries
   * a name: ids do not survive the rows they name. */
  "intake_link.reordered": { order: string[] };
  "intake_link.deleted": { label: string; url: string; placement: string | null };
};

/**
 * The field catalog (DES-021). Unordered and never hard-deleted, so it
 * writes neither `reordered` nor `deleted`. The two scope moves keep
 * their own verbs, because the scope decides which modules may attach
 * the field.
 */
type FieldCatalogPayloads = {
  "field.created": {
    slug: string;
    displayName: string;
    moduleScope: string;
    fieldType: string;
    fieldTag: string;
  };
  "field.updated": { slug: string; changed: ChangedFields };
  "field.promoted": { slug: string; from: string; to: string };
  "field.narrowed": { slug: string; from: string; to: string };
  "field.archived": {
    slug: string;
    displayName: string;
    moduleScope: string;
    inUseCount: number;
  };
  "field.restored": { slug: string; displayName: string };
};

/**
 * The CTR-012 approver-group templates (M14/1). The five list verbs are
 * the taxonomy set minus reorder and delete: a group has no display
 * order, and nothing hard-deletes one. The two member verbs are their
 * own, for the reason the contract team's are (CTR-004) — putting a
 * person on a template is not an edit of a field, and an Administrator
 * asking "who was on Commercial sign-off in March" has to be able to
 * filter the audit log on it.
 */
type ApproverGroupPayloads = {
  "approver_group.created": {
    displayName: string;
    description: string | null;
    memberCount: number;
    memberNames: string[];
  };
  "approver_group.renamed": { displayName: string; from: string; to: string };
  "approver_group.updated": { displayName: string; changed: ChangedFields };
  "approver_group.archived": { displayName: string };
  "approver_group.restored": { displayName: string };
  "approver_group.member_added": { displayName: string; memberId: string; memberName: string };
  "approver_group.member_removed": { displayName: string; memberId: string; memberName: string };
};

/** The MTR-013 Matter creation templates managed in Matters Settings. */
type MatterTemplatePayloads = {
  "matter_template.created": { displayName: string; matterTypeName: string };
  "matter_template.updated": { displayName: string; changed: ChangedFields };
  "matter_template.archived": { displayName: string };
  "matter_template.restored": { displayName: string };
};

/**
 * The sign-off on one contract (M14/3, CTR-012). These hang off the
 * contract, not off the request: an approval is a thing that happened to
 * the record, and its story belongs in that record's feed at the
 * standing record tier — so a Contributor on the team reads it exactly
 * as a Member does, and a confidential contract's audience is the only
 * audience it has.
 *
 * A verb per act, not one generic edit. Asking somebody, their answer
 * either way, and a withdrawal are four different things that happened,
 * and a reader of the feed has to be able to tell an approval from a
 * rejection without opening a payload.
 *
 * Cancellation deletes the pending row (CTR-012), so `approval.
 * cancelled` is the **only** remaining record that the request was ever
 * made — which is why its payload carries the approver's name rather
 * than only their id.
 */
type ApprovalPayloads = {
  /** `source` is `manual` or `group`; a group apply also names the group,
   * because one act asked several people and the feed must not read as
   * several hand-picked asks (M14/4). */
  "approval.requested": {
    approvalId: string | null;
    approverId: string;
    approverName: string;
    source: string;
    groupId?: string;
    groupName?: string;
  };
  /** Whether a note was given, never the note itself: the log is
   * append-only and the note lives on a row a cancellation may take. */
  "approval.approved": {
    approvalId: string;
    approverId: string;
    approverName: string;
    hasNote: boolean;
  };
  "approval.rejected": {
    approvalId: string;
    approverId: string;
    approverName: string;
    hasNote: boolean;
  };
  "approval.cancelled": { approvalId: string; approverId: string; approverName: string };
};

/**
 * The free-form dates on one contract (M16/3, CTR-009). These hang off
 * the contract for `ApprovalPayloads`' reason: a key date is a thing
 * about the record, and its story belongs in that record's feed at the
 * standing record tier — so a Contributor on the team reads it exactly
 * as a Member does, and a confidential contract's audience is the only
 * audience it has.
 *
 * A verb per act. Putting a date on a record, moving one, and taking one
 * off are three different things that happened, and a reader of the feed
 * has to be able to tell them apart without opening a payload.
 *
 * **Every payload carries the label**, because a removal deletes the row
 * and the entry is then the only thing left that says which date went —
 * the rule `approval.cancelled` and every `document.*` payload already
 * follow. On an edit it is the label as it stands **after** the edit, so
 * the sentence names the date the reader would go and look at; a rename
 * carries both sides in `changed`.
 */
type KeyDatePayloads = {
  "key_date.added": { keyDateId: string; label: string; date: string };
  /** `changed` holds only what moved, keyed `date`, `label`, or `note`
   * — the `contract.updated` shape, so the narrator reads one kind of
   * edit payload rather than two. */
  "key_date.edited": { keyDateId: string; label: string; changed: ChangedFields };
  "key_date.removed": { keyDateId: string; label: string; date: string };
};

/**
 * The lightweight checklist on one contract (M17/1, CTR-017). Five verbs,
 * one per act: add, edit, complete, reopen, remove. Each hangs off the
 * owning contract at the standing record tier, inside the write's own
 * transaction — the key-dates precedent.
 *
 * **Every payload carries the title**, because a removal deletes the row
 * and the entry is then the only thing left that says which task went —
 * the rule `key_date.removed` and every `document.*` payload already
 * follow.
 */
type TaskPayloads = {
  "task.added": { taskId: string; title: string };
  /** `changed` holds only what moved — the `key_date.edited` shape. */
  "task.edited": { taskId: string; title: string; changed: ChangedFields };
  "task.completed": { taskId: string; title: string };
  "task.reopened": { taskId: string; title: string };
  "task.reordered": { taskIds: string[] };
  "task.removed": { taskId: string; title: string };
};

/**
 * The registry record's own feed (M7): create and archive from #98, the
 * record surface's verbs from #99. A status change keeps its own verb —
 * status is the fixed code-branching enum (ENT-001), so the viewer
 * narrates "status changed" rather than a generic edit. A type
 * reassignment (#100) keeps its own verb too: the entity moved because
 * an Administrator archived its type, not because someone edited it.
 */
type EntityPayloads = {
  "entity.created": { legalName: string; entityType: string; status: string };
  "entity.updated": { legalName: string; changed: ChangedFields };
  "entity.status_changed": { legalName: string; from: string; to: string };
  "entity.type_reassigned": { legalName: string; from: string; to: string };
  "entity.archived": { legalName: string };
  "entity.restored": { legalName: string };
  "entity_officer.created": {
    legalName: string;
    officerName: string;
    role: string;
    appointedOn: string | null;
    resignedOn: string | null;
    userName: string | null;
  };
  "entity_officer.updated": {
    legalName: string;
    officerName: string;
    changed: ChangedFields;
  };
  "entity_officer.deleted": { legalName: string; officerName: string; role: string };
  "entity_registration.created": {
    legalName: string;
    jurisdiction: string;
    registrationNumber: string | null;
    registeredAgent: string | null;
    status: string;
  };
  "entity_registration.updated": {
    legalName: string;
    jurisdiction: string;
    changed: ChangedFields;
  };
  "entity_registration.deleted": {
    legalName: string;
    jurisdiction: string;
    registrationNumber: string | null;
  };
  "entity_holding.created": {
    legalName: string;
    ownerName: string;
    ownedName: string;
    ownershipPercent: number;
  };
  "entity_holding.updated": {
    legalName: string;
    ownerName: string;
    ownedName: string;
    from: number;
    to: number;
  };
  "entity_holding.deleted": {
    legalName: string;
    ownerName: string;
    ownedName: string;
    ownershipPercent: number;
  };
  "entity_obligation.created": {
    legalName: string;
    obligationId: string;
    label: string;
    nextDueOn: string;
  };
  "entity_obligation.updated": {
    legalName: string;
    obligationId: string;
    label: string;
    changed: ChangedFields;
  };
  "entity_obligation.deleted": {
    legalName: string;
    obligationId: string;
    label: string;
    nextDueOn: string;
  };
  "entity_obligation.filed": {
    legalName: string;
    obligationId: string;
    label: string;
    cycleDate: string;
    previousDueOn: string;
    nextDueOn: string | null;
    completedOn: string | null;
  };
};

/**
 * The contract record's own feed (M8). A status change keeps its own
 * verb: surfaces branch on the stage behind the status (CTR-001), so the
 * viewer narrates "status changed" rather than a generic edit. Team
 * changes keep their own verbs too — putting a person on a contract is
 * not an edit of a field, and the viewer names them (CTR-004). The Owner
 * is a field, so it rides `contract.updated`. The counterparties are the
 * same shape as the team and for the same reason (CTR-011): a party
 * joining or leaving the other side is not an edit of a field. The
 * primary change is its own verb because it also happens on its own —
 * removing the primary promotes the next party, and the log has to say
 * so rather than leave it implied. A type reassignment (#113) keeps its
 * own verb for the entity-record reason above. Setting and clearing the
 * Confidential flag (M10/2) keep their own verbs for a third reason:
 * DD-014 requires every walling-off of a record to be accountable by
 * actor and timestamp, and a verb an Administrator can filter the audit
 * log on is what makes that a query rather than a hunt through
 * `contract.updated` payloads.
 *
 * `stage_gate_overridden` (M14/5, CTR-012) keeps its own verb for that
 * third reason again: the soft gate is allowed to be pushed past, and
 * the whole reason it is allowed is that the push is recorded. It rides
 * beside the `status_changed` entry of the same commit rather than
 * inside it, because two things happened — the contract moved, and
 * somebody moved it past open sign-off — and only one of them is a fact
 * about the status.
 *
 * Every payload carries the record's number and title, so an entry still
 * names the contract it is about after a rename.
 */
type ContractPayloads = {
  /** `customFields` holds the slugs answered at birth, not the values:
   * the viewer narrates what was filled, and the values are on the
   * record to be read. */
  "contract.created": {
    number: number;
    title: string;
    contractType: string;
    status: string;
    customFields: string[];
  };
  /**
   * The conversion, narrated on the record it made (INT-006, DD-017,
   * M21/9). It sits beside `contract.created` rather than inside it,
   * because a contract born by conversion is an ordinary contract —
   * the M16 successor rule's sibling — and the fact that a Request is
   * where it came from is a second sentence about the same birth.
   *
   * `requestNumber` is R-###, which is the Request's name and never
   * changes, so the trail from work back to ask reads correctly however
   * either record is later edited.
   */
  "contract.created_from_request": { number: number; title: string; requestNumber: number };
  "contract.updated": {
    number: number;
    title: string;
    changed: ChangedFields;
    /** Present when DD-015's narrower writer made the edit, preserving
     * the role at the time of the append even if the user changes role later. */
    actorRole?: "contributor";
  };
  "contract.status_changed": {
    number: number;
    title: string;
    from: string;
    to: string;
    fromStage: string;
    toStage: string;
  };
  /** `approvers` names the people the push went past, because "who was
   * skipped" is the question the entry exists to answer. */
  "contract.stage_gate_overridden": {
    number: number;
    title: string;
    fromStage: string;
    toStage: string;
    approvers: {
      approvalId: string;
      approverId: string;
      approverName: string;
      status: string;
    }[];
  };
  "contract.type_reassigned": { number: number; title: string; from: string; to: string };
  "contract.team_added": { number: number; title: string; member: string; role: string };
  "contract.team_removed": { number: number; title: string; member: string; role: string };
  /** `created` says whether the organization was born here, so the
   * viewer can read "added Helix Labs GmbH (new)" only for that. */
  "contract.counterparty_added": {
    number: number;
    title: string;
    counterparty: string;
    isPrimary: boolean;
    created: boolean;
  };
  "contract.counterparty_removed": {
    number: number;
    title: string;
    counterparty: string;
    wasPrimary: boolean;
  };
  "contract.counterparty_primary_changed": {
    number: number;
    title: string;
    from: string | null;
    to: string;
  };
  "contract.confidentiality_set": { number: number; title: string };
  "contract.confidentiality_cleared": { number: number; title: string };
  /**
   * CTR-007's first renewal vehicle: a person confirmed the roll and the
   * expiry advanced (M16/4).
   *
   * It keeps its own verb rather than riding `contract.updated`, for
   * `stage_gate_overridden`'s reason twice over. **The act is what the
   * record has to prove.** CTR-006's engine never advances a date on its
   * own, so "this term rolled because a human said so" is a legal-state
   * fact, and a verb an Administrator can filter the audit log on is
   * what makes that a query rather than a hunt through edit payloads.
   * And **this entry is the renewal history**: the confirmed-renewal
   * rows on the record's Approvals & signing card and the "Last
   * renewal" fact among its facts are both read back from these
   * entries, per the contracts grill's G.R5 resolution. Nothing stores
   * a renewal, so nothing but this says one happened.
   *
   * `from` and `to` are the expiry either side of the roll. Both,
   * because a roll the person adjusted commits what they entered rather
   * than the proposal, and the entry has to say what the term actually
   * moved from and to rather than leave a reader to recompute it from a
   * renewal period that may itself have moved since.
   */
  "contract.renewal_confirmed": {
    number: number;
    title: string;
    from: string;
    to: string;
  };
  /**
   * CTR-015's two relation writes, and the two verbs M16/5's renewal
   * routing puts them on the record with.
   *
   * They keep their own verbs rather than riding `contract.updated` for
   * `team_added`'s reason: putting a record under another one, or
   * saying that it renews another one, is not an edit of a field. It is
   * a statement about two records, and a reader of the feed has to be
   * able to tell "this contract was parented to C-51" from "somebody
   * changed a date on it" without opening a payload.
   *
   * **The entry hangs off the record that changed, which is the new
   * one.** Nothing is written on the far end — CTR-015's no-cascade
   * stance is not only about status and confidentiality, and a feed
   * entry on a record whose row nobody touched would be the log
   * asserting an edit that never happened. What the far end shows is
   * M17's relations panel, read from the rows themselves.
   *
   * Both payloads name the other record by number **and** title, for
   * the reason every document payload names its file: the link may
   * outlive a rename, and the entry has to still say which contract was
   * meant.
   */
  "contract.parent_set": {
    number: number;
    title: string;
    parentNumber: number;
    parentTitle: string;
  };
  /** `relationType` is one of CTR-015's three, so the viewer selects a
   * sentence on it rather than printing a slug. M16 writes `renews`
   * alone; `related` and `amends` arrive with M17's manual linking.
   *
   * The three are restated here rather than imported, because this
   * package cannot depend on `@openlaw/db` — the schema keeps its own
   * copy in `ContractRelationType`. Narrowing them matters: typed as a
   * string, a mistyped slug compiles, reaches the narrator, and falls
   * through to the generic sentence instead of failing the build. */
  "contract.relation_added": {
    number: number;
    title: string;
    relationType: "related" | "renews" | "amends";
    relatedNumber: number;
    relatedTitle: string;
  };
  /**
   * A typed link removed by hand (M17/4, CTR-015). The same payload as
   * `relation_added` so the viewer reads what was taken away.
   */
  "contract.relation_removed": {
    number: number;
    title: string;
    relationType: "related" | "renews" | "amends";
    relatedNumber: number;
    relatedTitle: string;
  };
  /**
   * A contract taken out from under its parent by hand (M17/4, CTR-015).
   * The same payload as `parent_set` so the viewer reads what was undone.
   */
  "contract.parent_removed": {
    number: number;
    title: string;
    parentNumber: number;
    parentTitle: string;
  };
  /** MTR-007's one canonical Contract.matter_id mutation. The Activity
   * entry belongs to the Contract whose row changed; the Matter reads
   * the same datum rather than receiving a duplicate narration. */
  "contract.matter_linked": {
    number: number;
    title: string;
    matterNumber: number;
    matterTitle: string;
  };
  "contract.matter_unlinked": {
    number: number;
    title: string;
    matterNumber: number;
    matterTitle: string;
  };
  "contract.archived": { number: number; title: string };
  "contract.restored": { number: number; title: string };
};

/** The matter record vocabulary (M22). */
type MatterPayloads = {
  "matter.created": {
    number: number;
    title: string;
    matterType: string;
    status: string;
    customFields: string[];
    template?: string;
  };
  "matter.created_from_request": { number: number; title: string; requestNumber: number };
  "matter.confidentiality_set": { number: number; title: string };
  "matter.confidentiality_cleared": { number: number; title: string };
  "matter.updated": {
    number: number;
    title: string;
    changed: Record<string, { from: unknown; to: unknown }>;
    /** Present when DD-015's narrower writer made the edit. */
    actorRole?: "contributor";
  };
  "matter.status_changed": {
    number: number;
    title: string;
    from: string;
    to: string;
    fromCategory: "open" | "closed";
    toCategory: "open" | "closed";
  };
  "matter.team_added": { number: number; title: string; member: string; role: string };
  "matter.team_removed": { number: number; title: string; member: string; role: string };
  "matter.archived": { number: number; title: string };
  "matter.restored": { number: number; title: string };
  "matter.type_reassigned": { number: number; title: string; from: string; to: string };
  "matter.status_reassigned": { number: number; title: string; from: string; to: string };
  "matter.parent_set": {
    number: number;
    title: string;
    parentNumber: number;
    parentTitle: string;
  };
  "matter.parent_removed": {
    number: number;
    title: string;
    parentNumber: number;
    parentTitle: string;
  };
  "matter.relation_added": {
    number: number;
    title: string;
    relatedNumber: number;
    relatedTitle: string;
  };
  "matter.relation_removed": {
    number: number;
    title: string;
    relatedNumber: number;
    relatedTitle: string;
  };
};

/**
 * The conversation on a record (M9/2, M9/4). Every entry carries the
 * comment's own tier, so a Legal Only comment leaves no trace for anyone
 * who could not read it. They carry ids and metadata only — no comment
 * text ever enters a payload, because DD-017 forbids UPDATE and DELETE
 * here and an Administrator's hard redact has to be able to remove what
 * was said (CMT-006, amending CMT-005). Correcting a comment keeps its
 * own verb from taking it back: an edit and a delete are the author's
 * acts, and a redact is an Administrator's.
 */
type CommentPayloads = {
  "comment.posted": { commentId: string };
  "comment.edited": { commentId: string };
  "comment.deleted": { commentId: string };
  "comment.redacted": { commentId: string };
};

/**
 * The record's paper (M11/2 – M11/6, M13, DD-017). The entry hangs off
 * the owning contract, not off the document: access to a document is the
 * owning record's access and nothing else (DOC-008), so its story
 * belongs in that record's feed.
 *
 * **Every payload here carries the document's title**, because hard
 * deletion (DOC-010) removes the rows and the entry is then the only
 * place left that says what was erased.
 *
 * A verb per thing that happens, not one generic edit. Adding a round to
 * the chain is not the same event as putting the first file on the
 * record, and neither is renaming one — the feed has to read as a
 * negotiation rather than as a run of generic edits, and an
 * Administrator has to be able to filter the audit log on the one they
 * are looking for.
 */
type DocumentPayloads = {
  /** The destination rides by name: a folder is renamed and dissolved
   * freely, and this entry is a bulk drop's whole story (DOC-011). */
  "document.created": {
    documentId: string;
    versionId: string;
    title: string;
    folderName: string | null;
    /** Present when the first file was copied out of a thread. */
    sourceCommentId?: string;
    /** Preserves DD-015's narrower writer at append time. */
    actorRole?: "contributor";
  };
  "document.version_added": {
    documentId: string;
    versionId: string;
    title: string;
    versionNumber: number;
    kind: string;
    /** Present when this round was copied out of a thread. */
    sourceCommentId?: string;
    /** Preserves DD-015's narrower writer at append time. */
    actorRole?: "contributor";
  };
  "document.version_kind_changed": {
    documentId: string;
    versionId: string;
    title: string;
    versionNumber: number;
    from: string;
    to: string;
  };
  "document.updated": { documentId: string; title: string; changed: ChangedFields };
  /** Both titles, because hard deletion takes the rows and the entry has
   * to keep saying which document the instrument moved from and to. */
  "document.primary_set": {
    documentId: string;
    title: string;
    fromDocumentId: string | null;
    from: string | null;
    to: string;
  };
  "document.executed_set": {
    documentId: string;
    title: string;
    versionId: string;
    versionNumber: number;
  };
  "document.executed_cleared": {
    documentId: string;
    title: string;
    versionId: string;
    versionNumber: number | null;
  };
  "document.archived": { documentId: string; title: string };
  "document.restored": { documentId: string; title: string };
  "document.hard_deleted": { documentId: string; title: string; versionCount: number };
  "document.confidentiality_set": { documentId: string; title: string };
  "document.confidentiality_cleared": { documentId: string; title: string };
  /** One verb for both directions — into a folder and back out to the
   * record root — because it is one act with a destination. A null on
   * either side is the record root, which has no name because it is not
   * a folder. */
  "document.filed": {
    documentId: string;
    title: string;
    folderName: string | null;
    previousFolderName: string | null;
  };
};

/**
 * How a record's paper is filed (M13/2, DOC-006). Each payload carries
 * the folder's **name** — a folder is renamed and dissolved freely, so
 * the id would not draw a sentence a week later.
 *
 * Only *manual* folder work writes here. A folder that a bulk drop
 * find-or-creates on its way to a file writes nothing (DOC-011), because
 * the drop's story is its uploads and the feed narrates people rather
 * than traversal.
 */
type FolderPayloads = {
  "folder.created": { folderId: string; name: string; parentName: string | null };
  "folder.renamed": { folderId: string; name: string; previousName: string };
  "folder.moved": { folderId: string; name: string; parentName: string | null };
  "folder.deleted": { folderId: string; name: string };
};

/** The bring-your-own identity provider (TECH-008). The client secret's
 * two sides are both `[secret]`: the writer records that it was rotated
 * and never what it was. */
type SsoProviderPayloads = {
  "sso_provider.registered": { providerId: string; issuer: string; domain: string };
  "sso_provider.updated": { providerId: string; field: string; old: unknown; new: unknown };
};

/**
 * The e-signature connector (M15/1, CTR-013). A verb per act rather than
 * one generic settings edit: connecting an install to a signing provider
 * for the first time is a different event from rotating a key on the one
 * it already has, and an Administrator asking "when did the RSA key last
 * change" has to be able to filter the audit log on it.
 *
 * The last three are the connector's own lifecycle. **Turning the
 * connector off and taking it out are different events and always will
 * be**: one is reversible and keeps the credentials, and the other is
 * the moment those credentials left this install. A reader who cannot
 * tell them apart cannot answer "was the key still here last Tuesday",
 * which is the question a credential's history exists for.
 *
 * No payload ever carries a credential. The RSA key and the Connect
 * secret record as `[secret]` on both sides of their change, the SSO
 * client secret's shape and for its reason: this table is append-only,
 * so a secret that reached a payload would be in the record forever.
 * `signing_connector.removed` carries the estate and the integration key
 * for that reason too — they are configuration, and after the row is
 * gone this entry is the only thing that still says which account this
 * install was talking to.
 */
type SigningConnectorPayloads = {
  "signing_connector.configured": {
    provider: string;
    environment: string;
    integrationKey: string;
  };
  "signing_connector.updated": {
    provider: string;
    field: string;
    old: unknown;
    new: unknown;
  };
  /** Turned off, credentials kept. `liveEnvelopes` is how many rounds
   * were still out at that moment — the sweep cannot reach them while
   * the connector is off, and the entry is what says so afterwards. */
  "signing_connector.disabled": { provider: string; liveEnvelopes: number };
  /** Turned back on. The credentials are the ones that were there. */
  "signing_connector.enabled": { provider: string };
  /** Taken out. Refused while any envelope is live, so there is no
   * count to carry: the record can only reach this state with nothing
   * out. */
  "signing_connector.removed": {
    provider: string;
    environment: string;
    integrationKey: string;
  };
};

/**
 * One round of signature on one contract (M15/2, M15/3, CTR-013). These
 * hang off the contract, not off the envelope, for the reason the
 * approval verbs give: a send is a thing that happened to the record.
 *
 * A verb per act, not one generic envelope edit. A reader of the feed
 * has to be able to tell a completed signature from a withdrawn one
 * without opening a payload.
 *
 * The `envelope.sent` payload names the signers rather than only
 * counting them: the envelope's signer rows go when the record does, and
 * the feed is what still says who was asked to sign.
 *
 * The three endings are written by one place — the status transition in
 * `lib/signing/transitions.ts` — whichever feed reports them. Each
 * carries an actor only when a person caused it: a status the provider
 * pushed or the sweep read has no human behind it, and an entry with no
 * actor is how the feed says the integration spoke.
 */
type EnvelopeEndingPayload = {
  envelopeId: string;
  provider: string;
  providerEnvelopeId: string;
  status: string;
  /** The signer's or the voider's own words, kept only where the schema
   * allows one — a decline or a void that arrived without words has
   * none, and the sentence still reads. */
  reason?: string;
};

type EnvelopePayloads = {
  "envelope.sent": {
    envelopeId: string;
    provider: string;
    providerEnvelopeId: string;
    documentId: string;
    documentTitle: string;
    documentVersionId: string;
    documentVersionNumber: number;
    signers: { name: string; email: string }[];
  };
  "envelope.signed": EnvelopeEndingPayload;
  "envelope.declined": EnvelopeEndingPayload;
  "envelope.voided": EnvelopeEndingPayload;
};

/**
 * An external signer exercised a right to erasure (M15/7, #280).
 *
 * **Its own group, not an envelope one.** It hangs off `system` rather
 * than off a contract: an erasure is about a person and not about one
 * record, and it usually reaches several. Sitting in the envelope group
 * would put the code one line away from contradicting that sentence,
 * and leave whoever adds the next system-scoped action with no rule to
 * follow.
 *
 * **It names nobody**, which is the whole point: an entry carrying the
 * address of the person who asked to be forgotten would put it straight
 * back into the table the erasure just took it out of. The counts are
 * what make the act accountable — an Administrator did this, at this
 * moment, and it reached this much — without undoing it.
 */
type SignerErasurePayloads = {
  "signer.erased": { entriesRedacted: number; signerRowsDeleted: number };
};

/**
 * Data leaving the system (M9/7, DD-017). An export is a security event
 * in its own right, so taking one appends an entry at `admin_only`
 * naming the filters it was taken under. It hangs off `system`: an
 * export is about no single record.
 */
type ExportPayloads = {
  "export.performed": {
    surface: string;
    format: string;
    /** The query the export ran under, as the route received it. */
    filters: Record<string, unknown>;
  };
};

/**
 * The closed audit vocabulary (DD-017), slug by slug, each paired with
 * what its writer puts in the payload.
 *
 * Rows are append-only, so a mistyped slug becomes a permanently
 * unqueryable entry and a mistyped payload key becomes an entry the
 * narrator cannot read — the compiler is the only place to catch either.
 */
export type ActivityPayloadMap = UserPayloads &
  OrgSettingsPayloads &
  Prefixed<"contract_type", TaxonomyPayloads> &
  Prefixed<"matter_type", TaxonomyPayloads> &
  Prefixed<"entity_type", TaxonomyPayloads> &
  Prefixed<"officer_role", TaxonomyPayloads> &
  Prefixed<"request_type", TaxonomyPayloads> &
  Prefixed<"contract_type_field", TypeFieldPayloads> &
  Prefixed<"entity_type_field", TypeFieldPayloads> &
  Prefixed<"matter_type_field", TypeFieldPayloads> &
  Prefixed<"request_type_field", TypeFieldPayloads> &
  ContractStatusPayloads &
  MatterStatusPayloads &
  RequestPayloads &
  IntakeLinkPayloads &
  FieldCatalogPayloads &
  ApproverGroupPayloads &
  MatterTemplatePayloads &
  ApprovalPayloads &
  KeyDatePayloads &
  TaskPayloads &
  EntityPayloads &
  ContractPayloads &
  MatterPayloads &
  CommentPayloads &
  DocumentPayloads &
  FolderPayloads &
  SsoProviderPayloads &
  SigningConnectorPayloads &
  EnvelopePayloads &
  SignerErasurePayloads &
  ExportPayloads;

/** Every slug this build writes. */
export type ActivityAction = keyof ActivityPayloadMap & string;
