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

/**
 * A payload with nothing in it: the slug says the whole of what
 * happened, so there is nothing to carry beside it.
 */
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

/**
 * The `changed` map an edit carries: one entry per key, each with the
 * value before and the value after.
 */
export type ChangedFields = Record<string, { from: unknown; to: unknown }>;

/** Re-keys a payload table under one action prefix, so three taxonomies
 * that write the same seven verbs are declared once. */
type Prefixed<P extends string, M> = { [K in keyof M & string as `${P}.${K}`]: M[K] };

// ---------------------------------------------------------------------
// The taxonomies (#85: one machinery each)
// ---------------------------------------------------------------------

/** The taxonomy tables' audit namespaces. */
export type TaxonomyActionPrefix = "contract_type" | "matter_type" | "entity_type";
/** The two catalogs of fields attached to a type. */
export type TypeFieldActionPrefix = "contract_type_field" | "matter_type_field";

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

// ---------------------------------------------------------------------
// The whole vocabulary
// ---------------------------------------------------------------------

/**
 * The profile and user administration (M5, SET-005). Each names the
 * person acted on by their email, because that is what an Administrator
 * searched for.
 */
type UserPayloads = {
  "user.theme_changed": FieldChangePayload;
  "user.timezone_changed": FieldChangePayload;
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
  "contract.updated": { number: number; title: string; changed: ChangedFields };
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
  "contract.archived": { number: number; title: string };
  "contract.restored": { number: number; title: string };
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
  };
  "document.version_added": {
    documentId: string;
    versionId: string;
    title: string;
    versionNumber: number;
    kind: string;
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
  Prefixed<"contract_type_field", TypeFieldPayloads> &
  Prefixed<"matter_type_field", TypeFieldPayloads> &
  ContractStatusPayloads &
  FieldCatalogPayloads &
  ApproverGroupPayloads &
  ApprovalPayloads &
  KeyDatePayloads &
  EntityPayloads &
  ContractPayloads &
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
