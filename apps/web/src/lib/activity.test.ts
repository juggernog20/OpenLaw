// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The narration layer at its own interface (#253).
 *
 * `narrateActivity` is the whole of "what does this entry say", and two
 * surfaces read it — the record feed and the Administrator's audit log.
 * It was covered only through page mounts, which exercise the handful of
 * slugs a page happens to answer with. These tests call it directly, on
 * every slug the vocabulary holds.
 *
 * **The fixture below is typed against `@openlaw/shared`.** Its keys are
 * the whole of `ActivityAction` and each value is that slug's own
 * payload shape, so a renamed payload key does not compile here, and a
 * new action slug is missing a fixture until somebody writes one. That
 * is the round trip: the shape the API writes, read back out as the
 * sentence a person sees.
 *
 * **The fallback is tested as a feature, not as an accident.** The log
 * is append-only and outlives the code (DD-017), so a slug this build
 * has never heard of is still in the table and still has to come out.
 */

import { describe, expect, it } from "vitest";
import { createIntl } from "react-intl";
import type { ActivityAction, ActivityPayloadMap } from "@openlaw/shared";
import { narrateActivity, type NarratableEntry } from "./activity";

// No message catalog: every arm carries its own `defaultMessage`, which
// is the string this test is about. `onError` swallows the
// missing-translation notice that produces.
const intl = createIntl({ locale: "en-US", defaultLocale: "en-US", onError: () => {} });

const ACTOR = { displayName: "Nadia Counsel" };

/** One entry as the wire delivers it: a slug, an actor, and a payload
 * that is `Record<string, unknown>` by the time it gets here. */
function narrate(action: string, payload: object, actor: { displayName: string } | null = ACTOR) {
  const entry: NarratableEntry = {
    action,
    actor,
    payload: payload as Record<string, unknown>,
  };
  return narrateActivity(intl, entry);
}

/** The old→new pair every taxonomy rename carries. */
const TAXONOMY_RENAME = { slug: "nda", from: "N.D.A.", to: "NDA" };
/** What an edit of a taxonomy row's description looks like. */
const TAXONOMY_UPDATE = {
  slug: "nda",
  changed: { description: { from: null, to: "Short-form confidentiality" } },
};
const TAXONOMY_ARCHIVE = {
  slug: "nda",
  displayName: "NDA",
  inUseCount: 3,
  reassignedTo: "other",
};
const TAXONOMY_NAMED = { slug: "nda", displayName: "NDA" };
const TYPE_FIELD_ATTACH = { typeSlug: "nda", fieldSlug: "governing-law", isRequired: true };
const APPROVER = { approvalId: "apr_1", approverId: "usr_2", approverName: "Sarah Chen" };
const ENVELOPE_ENDING = {
  envelopeId: "env_1",
  provider: "docusign",
  providerEnvelopeId: "de_1",
  status: "signed",
};

/**
 * One payload per slug, typed against the shared vocabulary.
 *
 * Exhaustive by construction: the key type is `ActivityAction`, so this
 * object does not compile until every slug the API can write has a
 * sample here.
 */
const SAMPLE_PAYLOADS: { [A in ActivityAction]: ActivityPayloadMap[A] } = {
  // Profile and user administration
  "user.briefing_sent": {
    approvalCount: 1,
    taskCount: 2,
    dateCount: 2,
    knowledgeCount: 1,
    intakeCount: 0,
  },
  "user.theme_changed": { field: "theme", old: "light", new: "dark" },
  "user.timezone_changed": { field: "timezone", old: "UTC", new: "Asia/Dubai" },
  "user.notification_preference_changed": {
    eventGroup: "activity_on_your_records",
    channel: "email",
    enabled: true,
  },
  "user.display_name_changed": { field: "display_name", old: "N. Counsel", new: "Nadia Counsel" },
  "user.avatar_changed": { field: "avatar", old: null, new: "[image]" },
  "user.invited": { email: "sam@example.com", role: "legal_team_member" },
  "user.invite_resent": { email: "sam@example.com" },
  "user.invite_revoked": { email: "sam@example.com", role: "legal_team_member" },
  "user.password_changed": {},
  "user.other_sessions_revoked": {},
  "user.two_factor_enrolled": {},
  "user.two_factor_disabled": {},
  "user.role_changed": {
    email: "sam@example.com",
    from: "contributor",
    to: "legal_team_member",
  },
  "user.archived": { email: "sam@example.com", role: "contributor" },
  "user.unarchived": { email: "sam@example.com", role: "contributor" },
  "user.sessions_revoked": { email: "sam@example.com", sessions: 2 },

  // Organization settings
  "org_settings.updated": { field: "defaultTimezone", old: "UTC", new: "Asia/Dubai" },

  // Settings taxonomies
  "contract_type.created": TAXONOMY_NAMED,
  "contract_type.renamed": TAXONOMY_RENAME,
  "contract_type.updated": TAXONOMY_UPDATE,
  "contract_type.reordered": { order: ["nda", "msa"] },
  "contract_type.archived": TAXONOMY_ARCHIVE,
  "contract_type.restored": TAXONOMY_NAMED,
  "contract_type.deleted": TAXONOMY_NAMED,
  "matter_type.created": TAXONOMY_NAMED,
  "matter_type.renamed": TAXONOMY_RENAME,
  "matter_type.updated": TAXONOMY_UPDATE,
  "matter_type.reordered": { order: ["dispute", "advice"] },
  "matter_type.archived": TAXONOMY_ARCHIVE,
  "matter_type.restored": TAXONOMY_NAMED,
  "matter_type.deleted": TAXONOMY_NAMED,
  "entity_type.created": TAXONOMY_NAMED,
  "entity_type.renamed": TAXONOMY_RENAME,
  "entity_type.updated": TAXONOMY_UPDATE,
  "entity_type.reordered": { order: ["llc", "gmbh"] },
  "entity_type.archived": TAXONOMY_ARCHIVE,
  "entity_type.restored": TAXONOMY_NAMED,
  "entity_type.deleted": TAXONOMY_NAMED,
  "knowledge_type.created": TAXONOMY_NAMED,
  "knowledge_type.renamed": TAXONOMY_RENAME,
  "knowledge_type.updated": TAXONOMY_UPDATE,
  "knowledge_type.reordered": { order: ["template", "playbook"] },
  "knowledge_type.archived": TAXONOMY_ARCHIVE,
  "knowledge_type.restored": TAXONOMY_NAMED,
  "knowledge_type.deleted": TAXONOMY_NAMED,
  "officer_role.created": TAXONOMY_NAMED,
  "officer_role.renamed": TAXONOMY_RENAME,
  "officer_role.updated": TAXONOMY_UPDATE,
  "officer_role.reordered": { order: ["director", "secretary"] },
  "officer_role.archived": TAXONOMY_ARCHIVE,
  "officer_role.restored": TAXONOMY_NAMED,
  "officer_role.deleted": TAXONOMY_NAMED,
  "request_type.created": TAXONOMY_NAMED,
  "request_type.renamed": TAXONOMY_RENAME,
  "request_type.updated": TAXONOMY_UPDATE,
  "request_type.reordered": { order: ["nda_request", "legal_question"] },
  "request_type.archived": TAXONOMY_ARCHIVE,
  "request_type.restored": TAXONOMY_NAMED,
  "request_type.deleted": TAXONOMY_NAMED,

  // Fields attached to a type
  "contract_type_field.attached": TYPE_FIELD_ATTACH,
  "contract_type_field.detached": { typeSlug: "nda", fieldSlug: "governing-law" },
  "contract_type_field.reordered": { typeSlug: "nda", order: ["governing-law", "term"] },
  "contract_type_field.required_changed": TYPE_FIELD_ATTACH,
  "entity_type_field.attached": {
    typeSlug: "llc",
    fieldSlug: "company-number",
    isRequired: false,
  },
  "entity_type_field.detached": { typeSlug: "llc", fieldSlug: "company-number" },
  "entity_type_field.reordered": { typeSlug: "llc", order: ["company-number"] },
  "entity_type_field.required_changed": {
    typeSlug: "llc",
    fieldSlug: "company-number",
    isRequired: true,
  },
  "matter_type_field.attached": { typeSlug: "dispute", fieldSlug: "court", isRequired: false },
  "matter_type_field.detached": { typeSlug: "dispute", fieldSlug: "court" },
  "matter_type_field.reordered": { typeSlug: "dispute", order: ["court"] },
  "matter_type_field.required_changed": {
    typeSlug: "dispute",
    fieldSlug: "court",
    isRequired: true,
  },
  "request_type_field.attached": {
    typeSlug: "nda_request",
    fieldSlug: "counterparty_name",
    isRequired: false,
  },
  "request_type_field.detached": { typeSlug: "nda_request", fieldSlug: "counterparty_name" },
  "request_type_field.reordered": { typeSlug: "nda_request", order: ["counterparty_name"] },
  "request_type_field.required_changed": {
    typeSlug: "nda_request",
    fieldSlug: "counterparty_name",
    isRequired: true,
  },

  // Contract statuses
  "contract_status.created": { slug: "in-review", displayName: "In review", stage: "review" },
  "contract_status.renamed": { slug: "in-review", from: "Review", to: "In review" },
  "contract_status.reordered": { order: ["draft", "in-review"] },
  "contract_status.archived": {
    slug: "in-review",
    displayName: "In review",
    stage: "review",
    inUseCount: 0,
  },
  "contract_status.restored": { slug: "in-review", displayName: "In review" },
  "contract_status.deleted": { slug: "in-review", displayName: "In review", stage: "review" },

  // Matter statuses
  "matter_status.created": {
    slug: "investigation",
    displayName: "Investigation",
    category: "open",
  },
  "matter_status.renamed": { slug: "investigation", from: "Review", to: "Investigation" },
  "matter_status.reordered": { order: ["open", "investigation", "closed"] },
  "matter_status.archived": {
    slug: "investigation",
    displayName: "Investigation",
    category: "open",
    inUseCount: 2,
    reassignedTo: "Open",
  },
  "matter_status.restored": { slug: "investigation", displayName: "Investigation" },
  "matter_status.deleted": {
    slug: "investigation",
    displayName: "Investigation",
    category: "open",
  },

  // Deflection links (INT-004)
  "intake_link.created": {
    label: "NDA FAQ",
    url: "https://wiki.example.com/nda-faq",
    placement: null,
  },
  "intake_link.updated": {
    label: "NDA FAQ",
    changed: { placement: { from: null, to: "Contract review" } },
  },
  "intake_link.reordered": { order: ["NDA FAQ", "Purchasing policy"] },
  "intake_link.deleted": {
    label: "NDA FAQ",
    url: "https://wiki.example.com/nda-faq",
    placement: "Contract review",
  },

  // Field catalog
  "field.created": {
    slug: "governing-law",
    displayName: "Governing law",
    moduleScope: "contract",
    fieldType: "text",
    fieldTag: "legal",
  },
  "field.updated": {
    slug: "governing-law",
    changed: { displayName: { from: "Law", to: "Governing law" } },
  },
  "field.promoted": { slug: "governing-law", from: "contract", to: "all" },
  "field.narrowed": { slug: "governing-law", from: "all", to: "contract" },
  "field.archived": {
    slug: "governing-law",
    displayName: "Governing law",
    moduleScope: "contract",
    inUseCount: 4,
  },
  "field.restored": { slug: "governing-law", displayName: "Governing law" },

  // Approver-group templates
  "approver_group.created": {
    displayName: "Commercial sign-off",
    description: "Deals over 50k",
    memberCount: 2,
    memberNames: ["Sarah Chen", "Marcus Webb"],
  },
  "approver_group.renamed": {
    displayName: "Commercial sign-off",
    from: "Commercial",
    to: "Commercial sign-off",
  },
  "approver_group.updated": {
    displayName: "Commercial sign-off",
    changed: { description: { from: null, to: "Deals over 50k" } },
  },
  "approver_group.archived": { displayName: "Commercial sign-off" },
  "approver_group.restored": { displayName: "Commercial sign-off" },
  "approver_group.member_added": {
    displayName: "Commercial sign-off",
    memberId: "usr_2",
    memberName: "Sarah Chen",
  },
  "approver_group.member_removed": {
    displayName: "Commercial sign-off",
    memberId: "usr_2",
    memberName: "Sarah Chen",
  },

  // Matter creation templates
  "matter_template.created": {
    displayName: "Employment – Termination",
    matterTypeName: "Employment",
  },
  "matter_template.updated": {
    displayName: "Employment – Termination",
    changed: { defaultPriority: { from: null, to: "high" } },
  },
  "matter_template.archived": { displayName: "Employment – Termination" },
  "matter_template.restored": { displayName: "Employment – Termination" },

  // Sign-off on one contract
  "approval.requested": {
    ...APPROVER,
    source: "group",
    groupId: "grp_1",
    groupName: "Commercial sign-off",
  },
  "approval.approved": { ...APPROVER, hasNote: true },
  "approval.rejected": { ...APPROVER, hasNote: false },
  "approval.cancelled": APPROVER,

  // Record key dates (CTR-009)
  "key_date.added": {
    keyDateId: "kd-1",
    label: "Price review window opens",
    date: "2027-03-01",
  },
  "key_date.edited": {
    keyDateId: "kd-1",
    label: "Price review window opens",
    changed: { date: { from: "2027-03-01", to: "2027-04-01" } },
  },
  "key_date.removed": {
    keyDateId: "kd-1",
    label: "Price review window opens",
    date: "2027-04-01",
  },

  // Record tasks (CTR-017)
  "task.added": { taskId: "t-1", title: "Draft the NDA" },
  "task.edited": {
    taskId: "t-1",
    title: "Draft the NDA",
    changed: { dueDate: { from: null, to: "2027-06-01" } },
  },
  "task.completed": { taskId: "t-1", title: "Draft the NDA" },
  "task.reopened": { taskId: "t-1", title: "Draft the NDA" },
  "task.reordered": { taskIds: ["t-2", "t-1"] },
  "task.removed": { taskId: "t-1", title: "Draft the NDA" },

  // Entity registry
  "entity.created": { legalName: "Helix Labs GmbH", entityType: "GmbH", status: "active" },
  "entity.updated": {
    legalName: "Helix Labs GmbH",
    changed: { jurisdiction: { from: "DE", to: "AT" } },
  },
  "entity.status_changed": { legalName: "Helix Labs GmbH", from: "active", to: "dormant" },
  "entity.type_reassigned": { legalName: "Helix Labs GmbH", from: "GmbH", to: "AG" },
  "knowledge_item.type_reassigned": {
    title: "Contract review playbook",
    from: "Playbook",
    to: "Article",
  },
  "knowledge_item.created": {
    title: "Contract review playbook",
    knowledgeType: "Playbook",
    folder: "Commercial",
  },
  "knowledge_item.updated": {
    title: "Contract review playbook",
    changed: { folder: { from: "Commercial", to: "Corporate" } },
  },
  "knowledge_item.published": { title: "Contract review playbook" },
  "knowledge_item.unpublished": { title: "Contract review playbook" },
  "knowledge_item.archived": {
    title: "Contract review playbook",
    replacedBy: "Current contract review playbook",
  },
  "knowledge_item.restored": { title: "Contract review playbook" },
  "knowledge_folder.created": {
    folderId: "folder-1",
    name: "Commercial",
    parentName: null,
  },
  "knowledge_folder.renamed": {
    folderId: "folder-1",
    name: "Contracts",
    previousName: "Commercial",
  },
  "knowledge_folder.moved": {
    folderId: "folder-1",
    name: "Contracts",
    parentName: "Playbooks",
  },
  "knowledge_folder.reordered": {
    parentName: null,
    folderIds: ["folder-2", "folder-1"],
  },
  "knowledge_folder.deleted": { folderId: "folder-1", name: "Contracts" },
  "entity.confidentiality_set": { legalName: "Helix Labs GmbH" },
  "entity.confidentiality_cleared": { legalName: "Helix Labs GmbH" },
  "entity_grant.added": {
    legalName: "Helix Labs GmbH",
    userId: "usr-2",
    userName: "Nadia Counsel",
  },
  "entity_grant.removed": {
    legalName: "Helix Labs GmbH",
    userId: "usr-2",
    userName: "Nadia Counsel",
  },
  "entity.archived": { legalName: "Helix Labs GmbH" },
  "entity.restored": { legalName: "Helix Labs GmbH" },
  "entity_officer.created": {
    legalName: "Helix Labs GmbH",
    officerName: "Nadia Counsel",
    role: "Director",
    appointedOn: "2026-08-29",
    resignedOn: null,
    userName: "Nadia Counsel",
  },
  "entity_officer.updated": {
    legalName: "Helix Labs GmbH",
    officerName: "Nadia Counsel",
    changed: { resignedOn: { from: null, to: "2027-08-29" } },
  },
  "entity_officer.deleted": {
    legalName: "Helix Labs GmbH",
    officerName: "Nadia Counsel",
    role: "Director",
  },
  "entity_registration.created": {
    legalName: "Helix Labs GmbH",
    jurisdiction: "Delaware",
    registrationNumber: "DE-44",
    registeredAgent: "CSC",
    status: "active",
  },
  "entity_registration.updated": {
    legalName: "Helix Labs GmbH",
    jurisdiction: "Delaware",
    changed: { status: { from: "active", to: "lapsed" } },
  },
  "entity_registration.deleted": {
    legalName: "Helix Labs GmbH",
    jurisdiction: "Delaware",
    registrationNumber: "DE-44",
  },
  "entity_holding.created": {
    legalName: "Helix Labs GmbH",
    ownerName: "Helix Holdings Inc.",
    ownedName: "Helix Labs GmbH",
    ownershipPercent: 60,
  },
  "entity_holding.updated": {
    legalName: "Helix Labs GmbH",
    ownerName: "Helix Holdings Inc.",
    ownedName: "Helix Labs GmbH",
    from: 60,
    to: 75,
  },
  "entity_holding.deleted": {
    legalName: "Helix Labs GmbH",
    ownerName: "Helix Holdings Inc.",
    ownedName: "Helix Labs GmbH",
    ownershipPercent: 75,
  },
  "entity_obligation.created": {
    legalName: "Helix Labs GmbH",
    obligationId: "obligation-1",
    label: "Annual return",
    nextDueOn: "2026-09-30",
  },
  "entity_obligation.updated": {
    legalName: "Helix Labs GmbH",
    obligationId: "obligation-1",
    label: "Annual return",
    changed: { nextDueOn: { from: "2026-09-30", to: "2026-10-01" } },
  },
  "entity_obligation.deleted": {
    legalName: "Helix Labs GmbH",
    obligationId: "obligation-1",
    label: "Annual return",
    nextDueOn: "2026-10-01",
  },
  "entity_obligation.filed": {
    legalName: "Helix Labs GmbH",
    obligationId: "obligation-1",
    label: "Annual return",
    cycleDate: "2026-09-20",
    previousDueOn: "2026-09-30",
    nextDueOn: "2027-09-30",
    completedOn: null,
  },

  // Contract record
  "contract.created_from_request": {
    number: 41,
    title: "Helix supply agreement",
    requestNumber: 42,
  },
  "contract.created": {
    number: 41,
    title: "Helix supply agreement",
    contractType: "MSA",
    status: "Draft",
    customFields: ["governing-law"],
  },
  "contract.matter_linked": {
    number: 51,
    title: "Northwind NDA",
    matterNumber: 12,
    matterTitle: "Northwind expansion",
  },
  "contract.matter_unlinked": {
    number: 51,
    title: "Northwind NDA",
    matterNumber: 12,
    matterTitle: "Northwind expansion",
  },
  "contract.updated": {
    number: 41,
    title: "Helix supply agreement",
    changed: { title: { from: "Helix supply", to: "Helix supply agreement" } },
  },
  "contract.status_changed": {
    number: 41,
    title: "Helix supply agreement",
    from: "In review",
    to: "Signed",
    fromStage: "review",
    toStage: "signature",
  },
  "contract.stage_gate_overridden": {
    number: 41,
    title: "Helix supply agreement",
    fromStage: "approval",
    toStage: "signature",
    approvers: [{ ...APPROVER, status: "pending" }],
  },
  "contract.type_reassigned": {
    number: 41,
    title: "Helix supply agreement",
    from: "NDA",
    to: "MSA",
  },
  "contract.team_added": {
    number: 41,
    title: "Helix supply agreement",
    member: "Sarah Chen",
    role: "contributor",
  },
  "contract.team_removed": {
    number: 41,
    title: "Helix supply agreement",
    member: "Sarah Chen",
    role: "contributor",
  },
  "contract.counterparty_added": {
    number: 41,
    title: "Helix supply agreement",
    counterparty: "Helix Labs GmbH",
    isPrimary: true,
    created: true,
  },
  "contract.counterparty_removed": {
    number: 41,
    title: "Helix supply agreement",
    counterparty: "Helix Labs GmbH",
    wasPrimary: false,
  },
  "contract.counterparty_primary_changed": {
    number: 41,
    title: "Helix supply agreement",
    from: "Helix Labs GmbH",
    to: "Orbit Ltd",
  },
  "contract.renewal_confirmed": {
    number: 41,
    title: "Helix supply agreement",
    from: "2026-06-30",
    to: "2027-06-30",
  },
  "contract.parent_set": {
    number: 41,
    title: "Helix supply agreement",
    parentNumber: 12,
    parentTitle: "Helix master services agreement",
  },
  "contract.relation_added": {
    number: 41,
    title: "Helix supply agreement",
    relationType: "renews",
    relatedNumber: 12,
    relatedTitle: "Helix master services agreement",
  },
  "contract.relation_removed": {
    number: 41,
    title: "Helix supply agreement",
    relationType: "renews",
    relatedNumber: 12,
    relatedTitle: "Helix master services agreement",
  },
  "contract.parent_removed": {
    number: 41,
    title: "Helix supply agreement",
    parentNumber: 12,
    parentTitle: "Helix master services agreement",
  },
  "contract.confidentiality_set": { number: 41, title: "Helix supply agreement" },
  "contract.confidentiality_cleared": { number: 41, title: "Helix supply agreement" },
  "contract.archived": { number: 41, title: "Helix supply agreement" },
  "contract.restored": { number: 41, title: "Helix supply agreement" },

  // Matter record
  "matter.created": {
    number: 7,
    title: "Employment advice",
    matterType: "Employment",
    status: "Open",
    customFields: ["business-unit"],
  },
  "matter.created_from_request": {
    number: 7,
    title: "Employment advice",
    requestNumber: 42,
  },
  "matter.updated": {
    number: 7,
    title: "Employment advice",
    changed: { priority: { from: "medium", to: "high" } },
  },
  "matter.status_changed": {
    number: 7,
    title: "Employment advice",
    from: "Open",
    to: "Resolved",
    fromCategory: "open",
    toCategory: "closed",
  },
  "matter.type_reassigned": {
    number: 7,
    title: "Employment advice",
    from: "Employment",
    to: "Advisory",
  },
  "matter.status_reassigned": {
    number: 7,
    title: "Employment advice",
    from: "Investigation",
    to: "Open",
  },
  "matter.confidentiality_set": { number: 7, title: "Employment advice" },
  "matter.confidentiality_cleared": { number: 7, title: "Employment advice" },
  "matter.team_added": {
    number: 7,
    title: "Employment advice",
    member: "Mina Member",
    role: "member",
  },
  "matter.team_removed": {
    number: 7,
    title: "Employment advice",
    member: "Mina Member",
    role: "member",
  },
  "matter.archived": { number: 7, title: "Employment advice" },
  "matter.restored": { number: 7, title: "Employment advice" },
  "matter.parent_set": {
    number: 7,
    title: "Employment advice",
    parentNumber: 3,
    parentTitle: "Workforce programme",
  },
  "matter.parent_removed": {
    number: 7,
    title: "Employment advice",
    parentNumber: 3,
    parentTitle: "Workforce programme",
  },
  "matter.relation_added": {
    number: 7,
    title: "Employment advice",
    relatedNumber: 9,
    relatedTitle: "Regulatory response",
  },
  "matter.relation_removed": {
    number: 7,
    title: "Employment advice",
    relatedNumber: 9,
    relatedTitle: "Regulatory response",
  },

  // Record conversation
  "comment.posted": { commentId: "cmt_1" },
  "comment.edited": { commentId: "cmt_1" },
  "comment.deleted": { commentId: "cmt_1" },
  "comment.redacted": { commentId: "cmt_1" },

  // Request record
  "request.created": {
    number: 42,
    requestType: "Contract review",
    urgency: "high",
    customFields: ["counterparty"],
  },
  "request.declined": { number: 42 },
  "request.resolved": { number: 42 },
  "request.converted": { number: 42, contractNumber: 51 },
  "request.thread_moved": { number: 42, contractNumber: 51 },

  // Record documents
  "document.created": {
    documentId: "doc_1",
    versionId: "ver_1",
    title: "Supply agreement v1.pdf",
    folderName: "Drafts",
  },
  "document.version_added": {
    documentId: "doc_1",
    versionId: "ver_2",
    title: "Supply agreement v1.pdf",
    versionNumber: 2,
    kind: "negotiation",
  },
  "document.version_kind_changed": {
    documentId: "doc_1",
    versionId: "ver_2",
    title: "Supply agreement v1.pdf",
    versionNumber: 2,
    from: "draft_ours",
    to: "draft_theirs",
  },
  "document.updated": {
    documentId: "doc_1",
    title: "Supply agreement.pdf",
    changed: { title: { from: "Supply agreement v1.pdf", to: "Supply agreement.pdf" } },
  },
  "document.primary_set": {
    documentId: "doc_1",
    title: "Supply agreement.pdf",
    fromDocumentId: "doc_0",
    from: "Term sheet.pdf",
    to: "Supply agreement.pdf",
  },
  "document.executed_set": {
    documentId: "doc_1",
    title: "Supply agreement.pdf",
    versionId: "ver_3",
    versionNumber: 3,
  },
  "document.executed_cleared": {
    documentId: "doc_1",
    title: "Supply agreement.pdf",
    versionId: "ver_3",
    versionNumber: 3,
  },
  "document.archived": { documentId: "doc_1", title: "Supply agreement.pdf" },
  "document.restored": { documentId: "doc_1", title: "Supply agreement.pdf" },
  "document.hard_deleted": {
    documentId: "doc_1",
    title: "Supply agreement.pdf",
    versionCount: 3,
  },
  "document.confidentiality_set": { documentId: "doc_1", title: "Supply agreement.pdf" },
  "document.confidentiality_cleared": { documentId: "doc_1", title: "Supply agreement.pdf" },
  "document.filed": {
    documentId: "doc_1",
    title: "Supply agreement.pdf",
    folderName: "Signed",
    previousFolderName: "Drafts",
  },

  // Document filing
  "folder.created": { folderId: "fld_1", name: "Exhibits", parentName: "Drafts" },
  "folder.renamed": { folderId: "fld_1", name: "Exhibits", previousName: "Annexes" },
  "folder.moved": { folderId: "fld_1", name: "Exhibits", parentName: null },
  "folder.deleted": { folderId: "fld_1", name: "Exhibits" },

  // Identity provider
  "sso_provider.registered": {
    providerId: "acme-okta",
    issuer: "https://acme.okta.com",
    domain: "acme.example",
  },
  "sso_provider.updated": {
    providerId: "acme-okta",
    field: "clientSecret",
    old: "[secret]",
    new: "[secret]",
  },

  // E-signature connector
  "signing_connector.configured": {
    provider: "docusign",
    environment: "demo",
    integrationKey: "ik_1",
  },
  "signing_connector.updated": {
    provider: "docusign",
    field: "privateKey",
    old: "[secret]",
    new: "[secret]",
  },
  "signer.erased": { entriesRedacted: 2, signerRowsDeleted: 3 },
  "signing_connector.disabled": { provider: "docusign", liveEnvelopes: 2 },
  "signing_connector.enabled": { provider: "docusign" },
  "signing_connector.removed": {
    provider: "docusign",
    environment: "demo",
    integrationKey: "ik_1",
  },

  // AI connector
  "ai_connector.configured": {
    preset: "openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-test",
  },
  "ai_connector.updated": {
    preset: "openai",
    field: "apiKey",
    old: "[secret]",
    new: "[secret]",
  },
  "ai_connector.disabled": { preset: "openai" },
  "ai_connector.enabled": { preset: "openai" },
  "ai_connector.removed": {
    preset: "openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-test",
  },

  // Signature round
  "envelope.sent": {
    envelopeId: "env_1",
    provider: "docusign",
    providerEnvelopeId: "de_1",
    documentId: "doc_1",
    documentTitle: "Supply agreement.pdf",
    documentVersionId: "ver_3",
    documentVersionNumber: 3,
    signers: [{ name: "Sarah Chen", email: "sarah@example.com" }],
  },
  "envelope.signed": ENVELOPE_ENDING,
  "envelope.declined": {
    ...ENVELOPE_ENDING,
    status: "declined",
    reason: "The indemnity cap is wrong",
  },
  "envelope.voided": { ...ENVELOPE_ENDING, status: "voided", reason: "Superseded" },

  // Data export
  "export.performed": {
    surface: "audit_log",
    format: "csv",
    filters: { entityType: "contract" },
  },
};

const ACTIONS = Object.keys(SAMPLE_PAYLOADS) as ActivityAction[];

describe("the vocabulary, slug by slug", () => {
  it("has a slug to narrate at all", () => {
    // Completeness is the compiler's (the fixture is keyed by
    // `ActivityAction`). What a compiler cannot catch is an empty list
    // handed to `it.each`, which passes by running nothing — so the
    // floor is here, where a vacuous suite is loud.
    expect(ACTIONS.length).toBeGreaterThan(100);
  });

  it.each(ACTIONS)("narrates %s through its own arm", (action) => {
    const narration = narrateActivity(intl, {
      action,
      actor: ACTOR,
      payload: SAMPLE_PAYLOADS[action] as Record<string, unknown>,
    });
    // Not the fallback: this slug has a sentence of its own.
    expect(narration.sentence).not.toBe(`${ACTOR.displayName} — ${action}`);
    expect(narration.sentence.length).toBeGreaterThan(0);
    // No ICU placeholder survived, and no value resolved to nothing —
    // including the nullable ones (a folder at the record root, a
    // primary document moving from nobody), which have to reach the
    // reader as a sentence rather than as the word "null".
    expect(narration.sentence).not.toMatch(/[{}]/);
    expect(narration.sentence).not.toContain("undefined");
    expect(narration.sentence).not.toContain("null");
    expect(narration.icon).toBeDefined();
    for (const change of narration.changes) {
      expect(change.label.length).toBeGreaterThan(0);
      expect(change.from.length).toBeGreaterThan(0);
      expect(change.to.length).toBeGreaterThan(0);
    }
  });
});

describe("the counted branches of the connector and erasure sentences", () => {
  // `wholeCount` maps a missing or malformed count to 0, which is
  // exactly what an entry written by an older build produces. The
  // fixtures above all count above one, so without these the `=0` and
  // `one` branches never render.
  it("says what an erasure that matched nothing did", () => {
    expect(narrate("signer.erased", { entriesRedacted: 0, signerRowsDeleted: 0 }).sentence).toBe(
      "Nadia Counsel erased an external signer's name and address from no entries",
    );
  });

  it("counts one redacted entry in the singular", () => {
    expect(narrate("signer.erased", { entriesRedacted: 1, signerRowsDeleted: 1 }).sentence).toBe(
      "Nadia Counsel erased an external signer's name and address from 1 entry",
    );
  });

  it("says plainly when a connector was turned off with nothing out", () => {
    expect(
      narrate("signing_connector.disabled", { provider: "docusign", liveEnvelopes: 0 }).sentence,
    ).toBe(
      "Nadia Counsel turned off the e-signature connector docusign, with nothing out for signature",
    );
  });

  it("counts one round still out in the singular", () => {
    expect(
      narrate("signing_connector.disabled", { provider: "docusign", liveEnvelopes: 1 }).sentence,
    ).toBe(
      "Nadia Counsel turned off the e-signature connector docusign, with 1 round still out for signature",
    );
  });

  it("reads an entry from an older build, whose count is not there at all", () => {
    // Not a hypothetical: these payload keys arrived with #273 and #280,
    // so every entry appended before them has none of them.
    expect(narrate("signing_connector.disabled", { provider: "docusign" }).sentence).toBe(
      "Nadia Counsel turned off the e-signature connector docusign, with nothing out for signature",
    );
  });
});

describe("the cross-reference fallbacks between an ask and its record", () => {
  // `crossReference` collapses to a wording about the record when the
  // payload carries no usable number. Every fixture above carries one,
  // so without these the fallback arms never render — and a payload
  // written by an older build, or by a bug, is exactly what produces
  // them.
  it("names another contract when a conversion entry carries no number", () => {
    expect(narrate("request.converted", { number: 42 }).sentence).toBe(
      "Nadia Counsel converted this request into another contract",
    );
    expect(narrate("request.thread_moved", { number: 42 }).sentence).toBe(
      "Nadia Counsel moved this conversation onto another contract",
    );
  });

  it("names another contract when the number is not a whole one", () => {
    expect(narrate("request.converted", { number: 42, contractNumber: "51" }).sentence).toBe(
      "Nadia Counsel converted this request into another contract",
    );
    expect(narrate("request.thread_moved", { number: 42, contractNumber: 51.5 }).sentence).toBe(
      "Nadia Counsel moved this conversation onto another contract",
    );
  });

  it("names the matter a Request became", () => {
    expect(narrate("request.converted", { number: 42, matterNumber: 12 }).sentence).toBe(
      "Nadia Counsel converted this request into M-12",
    );
    expect(narrate("request.thread_moved", { number: 42, matterNumber: 12 }).sentence).toBe(
      "Nadia Counsel moved this conversation onto M-12",
    );
  });

  it("names the template a matter was created from, and stays quiet without one", () => {
    expect(
      narrate("matter.created", {
        ...SAMPLE_PAYLOADS["matter.created"],
        template: "Employment standard",
      }).sentence,
    ).toBe("Nadia Counsel created this matter from the Employment standard template");
    expect(narrate("matter.created", SAMPLE_PAYLOADS["matter.created"]).sentence).toBe(
      "Nadia Counsel created this matter",
    );
    expect(
      narrate("matter.created", {
        ...SAMPLE_PAYLOADS["matter.created"],
        template: "none",
      }).sentence,
    ).toBe("Nadia Counsel created this matter from the none template");
  });

  it("names a request when the record's own entry carries no number", () => {
    expect(
      narrate("contract.created_from_request", { number: 51, title: "Northwind NDA" }).sentence,
    ).toBe("Nadia Counsel created this contract from a request");
    expect(
      narrate("contract.created_from_request", {
        number: 51,
        title: "Northwind NDA",
        requestNumber: null,
      }).sentence,
    ).toBe("Nadia Counsel created this contract from a request");
    expect(
      narrate("matter.created_from_request", {
        number: 12,
        title: "Meridian dispute",
      }).sentence,
    ).toBe("Nadia Counsel created this matter from a request");
  });
});

describe("the sentences a reader gets", () => {
  it("names a briefing section preference without exposing its slug", () => {
    expect(
      narrate("user.notification_preference_changed", {
        eventGroup: "briefing.intake",
        channel: "email",
        enabled: true,
      }).sentence,
    ).toBe("Nadia Counsel turned emails on for Intake in their briefing");
  });

  it("narrates both kinds behind a version-kind correction", () => {
    const narration = narrate(
      "document.version_kind_changed",
      SAMPLE_PAYLOADS["document.version_kind_changed"],
    );
    expect(narration.sentence).toBe(
      "Nadia Counsel changed the kind of version 2 of Supply agreement v1.pdf",
    );
    expect(narration.changes).toEqual([
      { label: "Kind", from: "Draft · ours", to: "Draft · theirs" },
    ]);
  });

  it("names the actor and the pair behind a status move", () => {
    const narration = narrate(
      "contract.status_changed",
      SAMPLE_PAYLOADS["contract.status_changed"],
    );
    expect(narration.sentence).toBe("Nadia Counsel changed the status");
    expect(narration.changes).toEqual([{ label: "Status", from: "In review", to: "Signed" }]);
  });

  it("names one changed field and counts several", () => {
    expect(narrate("contract.updated", SAMPLE_PAYLOADS["contract.updated"]).sentence).toBe(
      "Nadia Counsel changed Title",
    );
    const several = narrate("contract.updated", {
      number: 41,
      title: "Helix supply agreement",
      changed: {
        title: { from: "A", to: "B" },
        description: { from: "C", to: "D" },
      },
    });
    expect(several.sentence).toBe("Nadia Counsel changed 2 fields");
  });

  it("counts each reminder lead time in days, day-of in words (#322)", () => {
    // A bare "7, 1, and 0" says nothing about what the numbers count.
    const narration = narrate("org_settings.updated", {
      field: "reminderOffsetDays",
      old: [7, 1, 0],
      new: [90, 7],
    });
    expect(narration.sentence).toBe("Nadia Counsel changed the organization settings");
    expect(narration.changes).toEqual([
      { label: "Reminder lead times", from: "7 days, 1 day, and day of", to: "90 days and 7 days" },
    ]);
  });

  it("says where a folder was made, and says when it was made at the root", () => {
    expect(narrate("folder.created", SAMPLE_PAYLOADS["folder.created"]).sentence).toBe(
      "Nadia Counsel made the Exhibits folder in Drafts",
    );
    expect(
      narrate("folder.created", { folderId: "fld_2", name: "Exhibits", parentName: null }).sentence,
    ).toBe("Nadia Counsel made the Exhibits folder");
  });

  it("says which group an approval was asked from, and says nothing when it was hand-picked", () => {
    expect(narrate("approval.requested", SAMPLE_PAYLOADS["approval.requested"]).sentence).toBe(
      "Nadia Counsel asked Sarah Chen to approve this contract, from the Commercial sign-off group",
    );
    expect(narrate("approval.requested", { ...APPROVER, source: "manual" }).sentence).toBe(
      "Nadia Counsel asked Sarah Chen to approve this contract",
    );
  });

  it("carries a decline's reason into the sentence", () => {
    expect(narrate("envelope.declined", SAMPLE_PAYLOADS["envelope.declined"]).sentence).toBe(
      "This contract's envelope was declined — The indemnity cap is wrong",
    );
    expect(narrate("envelope.declined", { ...ENVELOPE_ENDING, status: "declined" }).sentence).toBe(
      "This contract's envelope was declined",
    );
  });

  it("names a voider, and speaks passively when the integration voided", () => {
    expect(narrate("envelope.voided", SAMPLE_PAYLOADS["envelope.voided"]).sentence).toBe(
      "Nadia Counsel voided this contract's envelope — Superseded",
    );
    expect(narrate("envelope.voided", SAMPLE_PAYLOADS["envelope.voided"], null).sentence).toBe(
      "This contract's envelope was voided — Superseded",
    );
  });

  it("names which list a taxonomy entry is about", () => {
    expect(narrate("contract_type.created", TAXONOMY_NAMED).sentence).toBe(
      "Nadia Counsel added the contract type NDA",
    );
    expect(narrate("entity_type.archived", TAXONOMY_ARCHIVE).sentence).toBe(
      "Nadia Counsel archived the entity type NDA",
    );
    expect(narrate("contract_type_field.attached", TYPE_FIELD_ATTACH).sentence).toBe(
      "Nadia Counsel attached the field governing-law to the contract type nda",
    );
  });

  it("reads a role change in the words the Users pane uses", () => {
    const narration = narrate("user.role_changed", SAMPLE_PAYLOADS["user.role_changed"]);
    expect(narration.sentence).toBe("Nadia Counsel changed the role of sam@example.com");
    expect(narration.changes).toEqual([
      { label: "Role", from: "Contributor", to: "Legal team member" },
    ]);
  });

  it("names the far record of a relation by reference and title, one arm per type", () => {
    expect(narrate("contract.parent_set", SAMPLE_PAYLOADS["contract.parent_set"]).sentence).toBe(
      "Nadia Counsel put this contract under C-12 (Helix master services agreement)",
    );
    expect(
      narrate("contract.relation_added", SAMPLE_PAYLOADS["contract.relation_added"]).sentence,
    ).toBe("Nadia Counsel linked this contract — it renews C-12 (Helix master services agreement)");
    const amends = { ...SAMPLE_PAYLOADS["contract.relation_added"], relationType: "amends" };
    expect(narrate("contract.relation_added", amends).sentence).toBe(
      "Nadia Counsel linked this contract — it amends C-12 (Helix master services agreement)",
    );
    // A type this build has never heard of still reads as a sentence:
    // the log is append-only, and `related` takes the same arm because
    // it has no verb of its own.
    const later = { ...SAMPLE_PAYLOADS["contract.relation_added"], relationType: "supersedes" };
    expect(narrate("contract.relation_added", later).sentence).toBe(
      "Nadia Counsel linked this contract — related to C-12 (Helix master services agreement)",
    );
  });

  it("narrates Matter hierarchy and related-Matter actions", () => {
    expect(narrate("matter.parent_set", SAMPLE_PAYLOADS["matter.parent_set"]).sentence).toBe(
      "Nadia Counsel put this Matter under M-3 (Workforce programme)",
    );
    expect(
      narrate("matter.relation_added", SAMPLE_PAYLOADS["matter.relation_added"]).sentence,
    ).toBe("Nadia Counsel related this Matter to M-9 (Regulatory response)");
  });

  it("reads a relation entry that lost one half of the far record's name", () => {
    // Both halves answer different questions, so each absence has its
    // own shape: no title leaves the reference standing alone, and no
    // reference falls back to a record rather than to a person.
    const untitled = { ...SAMPLE_PAYLOADS["contract.parent_set"], parentTitle: "" };
    expect(narrate("contract.parent_set", untitled).sentence).toBe(
      "Nadia Counsel put this contract under C-12",
    );
    expect(
      narrate("contract.parent_set", { number: 41, title: "Helix supply agreement" }).sentence,
    ).toBe("Nadia Counsel put this contract under another contract");
  });

  it("says OpenLaw when no person is behind the entry", () => {
    expect(narrate("envelope.signed", ENVELOPE_ENDING, null).sentence).toBe(
      "This contract's envelope was signed",
    );
    expect(narrate("comment.posted", { commentId: "cmt_1" }, null).sentence).toBe(
      "OpenLaw commented",
    );
  });
});

describe("the fallback arm (DD-017: the log outlives the code)", () => {
  it("renders a slug this build has never heard of", () => {
    const narration = narrate("matter.filed", { matterId: "mat_1" });
    expect(narration.sentence).toBe("Nadia Counsel — matter.filed");
    expect(narration.changes).toEqual([]);
    expect(narration.icon).toBeDefined();
  });

  it("renders an unknown slug with no actor as OpenLaw", () => {
    expect(narrate("matter.filed", {}, null).sentence).toBe("OpenLaw — matter.filed");
  });

  it("renders a slug that names something on Object.prototype", () => {
    // Nothing constrains the `action` column, so a row can say
    // `constructor`. A bare index into the arms table would answer a
    // function for it and take the panel down on the one case the
    // fallback exists to survive.
    for (const slug of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(narrate(slug, {}).sentence).toBe(`Nadia Counsel — ${slug}`);
    }
  });

  it("renders a known slug whose payload has lost its keys", () => {
    // One level down from the unknown slug: the arm is here, but the row
    // was written by a build that put different keys in it.
    expect(narrate("contract.updated", {}).sentence).toBe("Nadia Counsel changed this contract");
    expect(narrate("folder.renamed", {}).sentence).toBe(
      "Nadia Counsel renamed the unnamed folder to unnamed",
    );
    expect(narrate("contract.status_changed", {}).changes).toEqual([]);
  });
});
