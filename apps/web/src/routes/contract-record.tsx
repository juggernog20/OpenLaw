// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record page (M8), at the CTR-003 number-based address
 * `/contracts/42`: the breadcrumb sub-bar carrying the reference, the
 * title, and the status pill, then the DES-032 section strip, and under
 * it the section it names beside the Team card the C2 mock draws in the
 * record's side column. Every field edits in place and commits
 * individually per DES-017 — no page edit mode, no dirty state, no Save
 * chrome — with the Owner, the type, status, priority, and risk as
 * selects.
 *
 * Five sections, five addresses. **Overview** (`/contracts/42`) is
 * the record's own columns: the Contract card, the Description card
 * under it, and the Term timeline card that closes the section.
 * **Fields** (`/contracts/42/fields`) is what this contract's
 * type asks for on top of them. **Documents**
 * (`/contracts/42/documents`) is the paper. **Approvals**
 * (`/contracts/42/approvals`) is who has been asked to sign it off
 * (CTR-012, DES-035). **Key dates** (`/contracts/42/key-dates`) is
 * every date the record has, as one union — the team's own named dates,
 * the expiry, and the derived notice deadline (CTR-009, DES-042). The
 * Team card is not one of the five — it stands beside all of them,
 * because who is on a contract is context for reading any part of it.
 *
 * The custom fields are CTR-016's, and they earn the card the C2 mock
 * draws for them. The contract's type decides which of them appear and
 * in what order; each commits inline, keyed by the field's slug. All
 * nine field types render through a control of their own, and the two
 * that name a row reuse the record's own pickers: `user` offers the
 * people the Owner select offers, `entity` the registry the signing
 * entity select reads.
 *
 * Re-typing is the one edit here that is not a plain field commit.
 * Changing the type re-checks the **new** type's hard-required fields
 * (MTR-014), and a record cannot fill fields its current type does not
 * attach — so a re-type with gaps opens a dialog that collects them and
 * commits the type and the values as one. That is the compound edit
 * DES-017 carves out of the inline rule. The seam refuses either way;
 * the dialog is what makes the refusal answerable.
 *
 * The value is CTR-010's, and it is the one field here that is not a
 * scalar: an amount, its currency, and its cadence are three controls
 * that commit together, clear together, and revert together. DES-017
 * still governs it — the group is what blur and Escape act on, because
 * a value half-committed or half-reverted is a value nobody chose.
 *
 * The term is CTR-006's, and it is five fields with one rule running
 * between them. The type — fixed, auto-renewing, or evergreen — decides
 * which of the other four the record may hold: an evergreen contract is
 * offered no expiry, and nothing but an auto-renewing one is asked how
 * far a roll goes. Those two are drawn as facts with an em dash rather
 * than as boxes the seam would refuse everything typed into, which is
 * the honest blank the grill's X.6 rule asks for. The notice period is
 * drawn whatever the type says, because a notice obligation sits on any
 * kind of term. Days remaining closes the group: it is derived from the
 * expiry and stored nowhere, so it is a fact of the record rather than
 * a field of it, and it is blank for a contract with no end.
 *
 * The Term timeline card closes the Overview with the same term drawn
 * as a picture (DES-041): the periods the record's dates imply, the
 * today line, and the derived notice-deadline mark. It holds nothing of
 * its own — every mark on it is one of the dates the card above edits.
 *
 * The people are CTR-004's: one Owner (`manager_id`, labelled "Owner",
 * name only) who may be left unassigned, and the working group in the
 * Team card. Adding a person names two things at once — who and in
 * which role — so it takes a dialog, which is the compound-edit case
 * DES-017 carves out of the inline rule.
 *
 * Both sides of the contract are CTR-011's, and they sit side by side
 * in the Contract card, labelled as the C2 mock labels them. "Our
 * entity" is the Entity that signs, picked from the M7 registry.
 * "Counterparties" is theirs: the party list, primary first, with the
 * shared typeahead under it. The mock draws the counterparty as one
 * read-only name in a hero meta strip that DES-017 removed with the
 * page-level Edit toggle it belonged to, so it lands here with the
 * other fields instead — the same move the Owner and the signing entity
 * already made.
 *
 * This is the first production mount of the DES-016 record activity
 * bar, and all three of its slots are here. Chat (CMT-004) and history
 * (DD-017) are the two entity-generic panels, each keyed by this
 * record's reference rather than by its CTR-003 number; the settings
 * deep-link (SET-001) sits below the divider. Matters (M22) and
 * documents (M11) mount the same two panels.
 *
 * The sub-bar says where the contract sits twice, at two zooms
 * (CTR-001). The pill takes the status label, which is renameable; the
 * stage pipeline beside it takes the fixed stage that label maps to,
 * and marks the contract's position in the six. Position, not
 * progress: transitions are unrestricted, so a status change that lands
 * on an earlier stage moves the marker back.
 *
 * Archive (soft delete — for mistakes and imports, not for ending a
 * contract) and restore live in the sub-bar; an archived record reads
 * as facts until restored.
 *
 * Confidentiality (DD-014) is the record's third audience question,
 * and the page answers it twice. The flag itself is a field of the
 * record like any other, committed inline (DES-017) from the Contract
 * card; the banner above the sub-bar is DES-009's Tier 2, drawn as
 * `S8 ConfBanner` in the C8 mock and rendered for every viewer who
 * reaches a confidential record. The two entity-generic panels take
 * the flag too: DES-009's Tier 1 micro-marker on every comment and
 * every activity entry, and its Tier 3 notice under the composer.
 *
 * Three actors may change the audience — Administrators, the record's
 * creator, and its Owner (CTR-022). They are the only ones who get a
 * working control and the only ones offered the banner's "Manage team"
 * link. Every other included viewer still reads the control, inert, the
 * way an archived record already renders: the audience is a fact of the
 * record, and hiding the control would hide the fact with it. The gate
 * here mirrors `confidentialityWrite` exactly, because the API is the
 * authority and a second rule would drift.
 *
 * The page has two audiences (CTR-021). Member+ get the record above. A
 * Contributor on the contract's team gets the same page read-only: the
 * DES-017 inline-commit surface with every input inert, exactly the way
 * an archived record already renders, and with no archive, no restore,
 * no team or counterparty control, and no picker reads behind them. The
 * DD-015 business/legal editable-field split is not built here. A
 * Contributor who is not on the contract never gets this far — the API
 * answers 404, as it does for a contract that does not exist. Business
 * Users are bounced home, and the API's 403 is the real refusal.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, defineMessage, useIntl, type IntlShape } from "react-intl";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FileText,
  PenLine,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE, SOFT_GATE_PROBLEM_TYPE } from "@openlaw/shared";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  ADDABLE_TEAM_ROLES,
  cadenceLabel,
  contractReference,
  daysRemainingLabel,
  type ContractCounterparty,
  type ContractValue,
  formatContractValue,
  riskLabel,
  severityLabel,
  SEVERITY_LEVELS,
  signingEntityOptions,
  STAGE_PILL,
  teamRoleLabel,
  TERM_TYPES,
  termTypeLabel,
  VALUE_CADENCES,
  type ContractRow,
  type ContractStatusOption,
  type ContractTeamMember,
  type ContractTeamRole,
  type ContractTypeOption,
  type SeverityLevel,
  type TermType,
  type ValueCadence,
  type UserOption,
} from "../lib/contracts";
import { ENVELOPE_PILL, type ContractEnvelope, type SigningState } from "../lib/envelopes";
import {
  commitsOnChange,
  sameDraft,
  toDraft,
  toValue,
  unansweredRequired,
  type AttachedField,
  type CustomFieldDraft,
  type CustomFieldRefs,
  type CustomFieldValue,
  type CustomFieldValues,
} from "../lib/custom-fields";
import {
  currencyFractionDigits,
  currencyOptions,
  formatShortDate,
  toMajorUnits,
  toMinorUnits,
} from "../lib/format";
import { APPROVAL_PILL, isUnresolved, type ContractApproval } from "../lib/approvals";
import { readContractKeyDates, type ContractDeadline } from "../lib/key-dates";
import { type ContractTask } from "../lib/tasks";
import { confirmContractRenewal, type ConfirmedRenewal } from "../lib/renewals";
import { FOLDER_ROOT, type ContractDocument } from "../lib/documents";
import type { ContractFolder } from "../lib/folders";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problemDetail, problemType } from "../lib/messages";
import { cn } from "../lib/utils";
import { canReadContracts, isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { useActivityApplet } from "../components/activity/activity-applet";
import { useCommentApplet } from "../components/comments/comment-applet";
import { RecordApplets } from "../components/shell/record-applets";
import { RecordTabs } from "../components/shell/record-tabs";
import type { Applet } from "../components/shell/applets";
import { ApprovalsSigningCard } from "../components/approvals/approvals-signing-card";
import { Avatar } from "../components/avatar";
import { ConfidentialBanner } from "../components/confidential-banner";
import { ConfidentialToggle } from "../components/confidential-toggle";
import { ConfirmRenewalDialog } from "../components/contracts/confirm-renewal-dialog";
import { CreateContractDialog } from "../components/contracts/create-contract-dialog";
import { KeyDatesCard } from "../components/contracts/key-dates-card";
import { RelatedContractsCard } from "../components/contracts/related-contracts-card";
import { TasksCard } from "../components/contracts/tasks-card";
import { RenewalBanner } from "../components/contracts/renewal-banner";
import { TermTimelineCard } from "../components/contracts/term-timeline-card";
import { CounterpartyPicker, type CounterpartyPick } from "../components/counterparty-picker";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import { DocPanel } from "../components/documents/doc-panel";
import { DocumentsCard } from "../components/documents/documents-card";
import { PageTitle } from "../components/page-title";
import { StagePipeline } from "../components/stage-pipeline";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

/** The record's sections (DES-032), in the order the strip draws them.
 * The Overview is the bare address, so it has no segment of its own. */
const RECORD_TABS = ["fields", "documents", "approvals", "key-dates", "tasks"] as const;
type RecordTabName = "overview" | (typeof RECORD_TABS)[number];

export async function contractRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // A Business User gets no surface at all. The API's 403 stands
  // behind this.
  if (!canReadContracts(user.role)) return redirect("/");
  const number = Number(params.contractNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error("That is not a contract reference.");
  // A section this record does not have is not an error — the record
  // exists. It lands on the Overview, which is what the bare address
  // already means.
  if (params.tab && !RECORD_TABS.includes(params.tab as (typeof RECORD_TABS)[number])) {
    return redirect(`/contracts/${number}`);
  }
  // The pickers exist to commit from, so a read-only viewer reads
  // none of them. Both seams are Member+ and would refuse a
  // Contributor anyway; the record read alone carries every name the
  // page has to draw.
  const canEdit = isMemberPlus(user.role);
  const [
    record,
    documents,
    folders,
    approvals,
    signing,
    keyDates,
    tasks,
    relations,
    options,
    registry,
  ] = await Promise.all([
    api.GET("/api/v1/contracts/{number}", { params: { path: { number } } }),
    // The record's paper (M11/2). Read by every viewer who reaches the
    // page — a Contributor on the team reads and downloads it too
    // (DD-015) — and answered 404 for anyone the record itself is
    // hidden from, which is the same refusal the record read gives.
    //
    // The record root only (M13/3): the tree draws its folders first and
    // then the documents filed nowhere, and a folder's own documents
    // load when it is opened. Reading the record's whole paper here
    // would draw every filed document twice.
    api.GET("/api/v1/contracts/{number}/documents", {
      params: { path: { number }, query: { folder: FOLDER_ROOT } },
    }),
    // How that paper is filed (M13/2, DOC-006). One read for the whole
    // tree, because a record's folder set is small and drawing it a
    // level at a time would be a round trip per press.
    api.GET("/api/v1/contracts/{number}/folders", { params: { path: { number } } }),
    // Who has been asked to sign the record off (M14/3, CTR-012). Read
    // by every viewer who reaches the page — a Contributor on the team
    // reads the roster too — and answered 404 for anyone the record
    // itself is hidden from, which is the same refusal the record read
    // gives.
    api.GET("/api/v1/contracts/{number}/approvals", { params: { path: { number } } }),
    // What paper this record has sent out for signature (M15/2,
    // CTR-013), read by every viewer who reaches the page for the
    // roster's reason. It carries two facts beside the envelopes —
    // whether this install has a connector, and the chain a send would
    // offer — so the card decides in one condition whether to draw the
    // send control at all.
    api.GET("/api/v1/contracts/{number}/envelopes", { params: { path: { number } } }),
    // Every date on the record (M16/3, CTR-009): its key dates, its
    // expiry, and its derived notice deadline, as one union the seam has
    // already ordered and marked. Read by every viewer who reaches the
    // page for the roster's reason — a Contributor on the team reads the
    // record's deadlines too.
    api.GET("/api/v1/contracts/{number}/key-dates", { params: { path: { number } } }),
    // The record's task checklist (M17/1, CTR-017): lightweight items
    // with a done flag, an optional assignee, an optional due date, and
    // a display order. Read by every viewer who reaches the page for
    // the roster's reason — a Contributor on the team reads the checklist.
    api.GET("/api/v1/contracts/{number}/tasks", { params: { path: { number } } }),
    // The contract's relation surface (M17/2, CTR-015): its parent chain,
    // children, and typed links. Optional — a read failure does not block
    // the page, it only hides the Related contracts card.
    api
      .GET("/api/v1/contracts/{number}/relations", { params: { path: { number } } })
      .catch(() => ({ data: undefined, error: undefined })),
    canEdit ? api.GET("/api/v1/contracts/options") : undefined,
    // The registry's own Member+ list is the signing-entity picker's
    // source (CTR-011): it is ordered by legal name and already leaves
    // archived entities out, so the contracts surface needs no read of
    // its own the way it does for the Administrator-only taxonomies.
    canEdit ? api.GET("/api/v1/entities") : undefined,
  ]);
  // The documents read is required, like the record read: every viewer
  // who reaches this page reads the paper on it (DD-015). A failure
  // here must not render as "No documents on this contract yet" — an
  // empty list is a fact about the record, not a fallback for a read
  // that did not happen.
  if (
    !record.data ||
    !documents.data ||
    !folders.data ||
    !approvals.data ||
    !signing.data ||
    !keyDates.data ||
    !tasks.data ||
    (canEdit && !(options?.data && registry?.data))
  ) {
    throw new Error("The contract could not be read.");
  }
  return {
    user,
    canEdit,
    contract: record.data.contract,
    documents: documents.data.documents,
    /** The record's folders, whole (M13/2). Required like the paper: an
     * empty tree is a fact about the record, not a fallback for a read
     * that did not happen. */
    folders: folders.data.folders,
    /** Who has been asked to approve the record (M14/3). Required like
     * the paper: an empty roster is a fact about the record, not a
     * fallback for a read that did not happen. */
    approvals: approvals.data.approvals,
    /** The record's signing state (M15/2). Required like the roster:
     * an install with no connector is a fact about the deployment, not
     * a fallback for a read that did not happen. */
    signing: signing.data,
    /** Every date on the record, as one CTR-009 union (M16/3). Required
     * like the roster: a record with no dates at all is a fact about it,
     * not a fallback for a read that did not happen. */
    deadlines: keyDates.data.deadlines,
    /** The record's task checklist (M17/1, CTR-017). Required like the
     * roster: a record with no tasks at all is a fact about it, not a
     * fallback for a read that did not happen. */
    tasks: tasks.data.tasks,
    taskDoneCount: tasks.data.doneCount,
    taskTotalCount: tasks.data.totalCount,
    /** Every confirmed roll on the record, most recent first (M16/4,
     * CTR-006). It rides the record read because nothing stores a
     * renewal — these are the activity log's own entries read back
     * (grill row G.R5) — and two surfaces draw them: the card's rows,
     * and the Contract card's "Last renewal" fact. */
    renewals: record.data.renewals,
    /** Where the next page of paper starts, or null when the first page
     * is all of it (CTR-024). */
    documentsCursor: documents.data.nextCursor,
    fields: record.data.fields,
    customFieldRefs: record.data.customFieldRefs,
    team: record.data.team,
    counterparties: record.data.counterparties,
    contractTypes: options?.data?.contractTypes ?? [],
    contractStatuses: options?.data?.contractStatuses ?? [],
    users: options?.data?.users ?? [],
    /** The live approver-group templates the Approvals section's apply
     * picker offers (M14/4, CTR-012). Member+ only, like the rest of
     * the options answer: a read-only viewer applies nothing. */
    approverGroups: options?.data?.approverGroups ?? [],
    entities: registry?.data?.entities ?? [],
    /** The contract's relation surface (M17/2, CTR-015): parent chain,
     * children, and typed links. Optional — a read failure hides the
     * card rather than blocking the page. */
    relations: relations?.data ?? null,
  };
}

/** The fields that commit as free text (DES-017); the Owner, our
 * signing entity, the type, the status, priority, and risk have their
 * own selects, and the counterparties have their own routes. */
type TextFieldKey = "title" | "description";
/**
 * The four term fields that commit as typed text (CTR-006, DES-017):
 * two calendar dates and two counts. The term type is the fifth, and it
 * is a select, so it commits on its own change like every other select
 * on this card.
 */
type TermDraftKey = "effectiveDate" | "expiryDate" | "renewalPeriodMonths" | "noticePeriodDays";
/** One custom field's key, namespaced by slug so a catalog field named
 * "Title" and the record's own title are never one micro-state. */
type CustomFieldKey = `field:${string}`;
/** What one committed field answers with: nothing more when it landed,
 * and the seam's own refusal when it did not — its sentence, and the
 * RFC 9457 `type` that identifies it, for the one refusal the record
 * acts on rather than prints (CTR-012's soft gate). */
type CommitOutcome = { ok: true } | { ok: false; detail?: string; type?: string };
type FieldKey =
  | TextFieldKey
  | TermDraftKey
  | CustomFieldKey
  | "termType"
  | "managerId"
  | "entityId"
  | "counterparties"
  | "contractTypeId"
  | "statusId"
  | "priority"
  | "risk"
  | "value"
  | "isConfidential";

/**
 * The em dash the record prints where it holds nothing (grill row X.6):
 * a term field the contract's type cannot hold, and a countdown with no
 * expiry to count to. One string, so no two of those places can
 * disagree about what an absence looks like.
 */
const NOT_RECORDED = defineMessage({ id: "contracts.record.notRecorded", defaultMessage: "—" });

/** The Team card's anchor. Two places name it: the card itself, and
 * the confidentiality banner's "Manage team" link, which is a fragment
 * to it — one constant, so the link cannot point at nothing. */
const TEAM_CARD_ID = "contract-team";

/** What the envelope chip says, one sentence per status (DES-036). Each
 * one names the envelope rather than only its state, so the chip reads
 * on its own beside a status pill that may say something similar and
 * mean the contract instead. */
const ENVELOPE_CHIP_LABEL = {
  sent: defineMessage({ id: "contracts.record.envelope.sent", defaultMessage: "Envelope sent" }),
  signed: defineMessage({
    id: "contracts.record.envelope.signed",
    defaultMessage: "Envelope signed",
  }),
  declined: defineMessage({
    id: "contracts.record.envelope.declined",
    defaultMessage: "Envelope declined",
  }),
  voided: defineMessage({
    id: "contracts.record.envelope.voided",
    defaultMessage: "Envelope voided",
  }),
} as const satisfies Record<ContractEnvelope["status"], { id: string; defaultMessage: string }>;

/**
 * Where the record's paper stands with its signers (grill row E.5).
 *
 * Conditional by design: a contract that has never been sent through a
 * connector draws nothing at all, because CTR-013's manual hand-off is
 * the whole path on an install with no connector and a chip saying so
 * would be chrome about an absence.
 *
 * It takes the same DES-005 family the envelope row's pill takes, and
 * carries a glyph, so two pills side by side in the sub-bar are not
 * read as one: the left one names the contract's status, and this one
 * names its envelope.
 */
function EnvelopeChip({ envelope }: Readonly<{ envelope: ContractEnvelope | null }>) {
  if (!envelope) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium ${ENVELOPE_PILL[envelope.status]}`}
    >
      {/* 12px, not DES-008's 16: the glyph sits inside a 12px pill
          beside 12px text, which is the carve-out DES-034 records for
          the stage pipeline's own interior glyphs. A 16px glyph here
          would read as the larger of the two. */}
      <PenLine size={12} aria-hidden="true" />
      <FormattedMessage {...ENVELOPE_CHIP_LABEL[envelope.status]} />
    </span>
  );
}

/** SET-001's deep link to the contract configuration behind this
 * record — a slot that navigates rather than opening the panel. */
const SETTINGS_APPLET: Applet = {
  id: "settings",
  icon: Settings,
  label: defineMessage({ id: "contracts.applet.settings", defaultMessage: "Contract settings" }),
  group: "below-divider",
  href: "/settings/contracts",
};

/**
 * Every piece of state below seeds from the loaded contract, so moving
 * from one record to another must start a fresh component — otherwise
 * the new record would render the previous one's saved row and drafts.
 * The key on the reference does that.
 */
export function ContractRecordPage() {
  const { contractNumber } = useParams();
  return <ContractRecord key={contractNumber} />;
}

function ContractRecord() {
  // Which section is on screen (DES-032). The loader has already sent
  // an unknown segment to the Overview, so anything that survives to
  // here is one of the four.
  const tab = (useParams().tab ?? "overview") as RecordTabName;
  const {
    user,
    canEdit,
    contract,
    documents: contractDocuments,
    folders: contractFolders,
    approvals: contractApprovals,
    signing: contractSigning,
    deadlines: contractDeadlines,
    tasks: contractTasks,
    taskDoneCount: contractTaskDoneCount,
    taskTotalCount: contractTaskTotalCount,
    renewals: contractRenewals,
    documentsCursor,
    fields,
    customFieldRefs,
    team,
    counterparties,
    contractTypes,
    contractStatuses,
    users,
    approverGroups,
    entities,
    relations,
  } = useLoaderData<typeof contractRecordLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  /** The saved record — the server's truth after the last commit. */
  const [saved, setSaved] = useState<ContractRow>(contract);

  /** The conversation about this record (CMT-004), keyed by the
   * entity reference the panel takes — it never learns it is a
   * contract. Every viewer who reaches the page reaches the thread; the
   * API decides which tiers they hear.
   *
   * The flag rides along so the panel can wear DES-009's Tier 1 micro
   * marker and say its Tier 3 notice. It is read from the saved row and
   * not the loader's copy, so flagging the record on this page moves
   * the panel with it, exactly as it moves the banner. */
  const chatApplet = useCommentApplet({
    entityType: "contract",
    entityId: contract.id,
    role: user.role,
    viewerId: user.id,
    confidential: saved.isConfidential,
  });
  /** The fields the contract's type attaches, in attachment order. They
   * are state rather than loader data because a re-type replaces them,
   * and the PATCH that re-types answers with the new set. */
  const [attached, setAttached] = useState<AttachedField[]>(fields);
  /** The people and Entities the stored values name — merged into the
   * pickers so an archived one still renders as itself. */
  const [refs, setRefs] = useState<CustomFieldRefs>(customFieldRefs);
  const [retypeTo, setRetypeTo] = useState<ContractTypeOption | null>(null);
  /** The status the soft gate stopped on its way in, or none (CTR-012).
   * Set by the seam's refusal and cleared by the confirm or the
   * dismiss; while it is set, nothing has committed. */
  const [gateTo, setGateTo] = useState<ContractStatusOption | null>(null);
  const [roster, setRoster] = useState<ContractTeamMember[]>(team);
  /** The record's paper (M11/2, M11/3). State rather than loader data
   * because an upload, an appended version, and a metadata edit each
   * change it without a page re-read. */
  const [paper, setPaper] = useState<ContractDocument[]>(contractDocuments);
  /** Where the next page of paper starts, or null at the end of it. The
   * section pages itself; the record holds the position, because the
   * record holds the list (CTR-024). */
  const [paperCursor, setPaperCursor] = useState<string | null>(documentsCursor);
  /**
   * The paper the Documents section is holding inside folders (M13/3).
   *
   * The list above is the record root, because a folder's documents are
   * read when the folder is opened — so this is the rest of what is on
   * screen, and the doc panel below resolves against both. Without it a
   * filed document's name would open nothing.
   */
  const [filed, setFiled] = useState<ContractDocument[]>([]);
  /** How the record's paper is filed (M13/2). State rather than loader
   * data because every folder write answers the whole set, and the
   * section replaces what it holds without a page re-read. */
  const [tree, setTree] = useState<ContractFolder[]>(contractFolders);
  /** Who has been asked to sign the record off (M14/3). State rather
   * than loader data because every approval write answers the whole
   * roster — an ask adds rows, a cancellation takes one away — and the
   * section replaces what it holds without a page re-read. */
  const [approvals, setApprovals] = useState<ContractApproval[]>(contractApprovals);
  /** What paper the record has sent out for signature (M15/2). State
   * rather than loader data because a send answers the record's whole
   * signing state — the new envelope, and the send control going with
   * it — and the section replaces what it holds without a page
   * re-read. */
  const [signing, setSigning] = useState<SigningState>(contractSigning);
  /**
   * Every confirmed roll on the record, most recent first (M16/4,
   * CTR-006). State rather than loader data because confirming a roll
   * answers the whole history, and the card replaces what it holds
   * without a page re-read.
   *
   * Two surfaces read it and neither derives anything from it: the
   * card draws the rows, and the Contract card's "Last renewal" fact
   * reads the first one. Nothing stores a renewal, so this is the
   * activity log read back (grill row G.R5) and there is no second
   * copy of it anywhere.
   */
  const [renewals, setRenewals] = useState<ConfirmedRenewal[]>(contractRenewals);
  /** Whether the Renew dialog is open. It lives here rather than in the
   * card that holds the renewal rows, because the pending banner raises
   * the same dialog from the page's chrome — where every section can
   * reach it — which is `SoftGateDialog`'s reason for living here too. */
  const [renewing, setRenewing] = useState(false);
  const [renewalStatus, setRenewalStatus] = useState<FieldStatus>("idle");
  /**
   * Which routed renewal vehicle the create dialog is open for, or none
   * (M16/5, CTR-007, DES-044).
   *
   * The dialog is the Contracts list's own, opened here so a renewal is
   * routed from the record it is a renewal of. It lives beside the
   * Renew dialog for the same reason that one lives here: the act is
   * raised from the page's chrome, which is on screen in every section.
   */
  const [routingTo, setRoutingTo] = useState<"child" | "successor" | null>(null);
  /**
   * Whether the Documents section should open its version composer on
   * the primary chain, ready to file an amendment (CTR-007's second
   * vehicle).
   *
   * A flag rather than a document id: which document is the instrument
   * is the record's own answer (CTR-014), and a second copy of it here
   * would be the copy that drifts when the pin moves. The section
   * clears it as soon as it has opened the composer, so navigating back
   * to Documents later does not re-open it.
   */
  const [amending, setAmending] = useState(false);
  /** The section's answer that it has taken the request up. Stable
   * across renders, because the effect that opens the composer watches
   * it: a new function every render would re-run the effect and re-open
   * a composer the person had just closed. */
  const stopAmending = useCallback(() => setAmending(false), []);
  /** Every date on the record, as the CTR-009 union (M16/3). State
   * rather than loader data because every key-date write answers the
   * whole union — adding, moving, or removing one date can change which
   * date the list calls next — and the section replaces what it holds
   * without a page re-read. */
  const [deadlines, setDeadlines] = useState<ContractDeadline[]>(contractDeadlines);
  /** Which re-read of the union above is the newest one in flight. Two
   * term commits in a row race, and only the last answer may land. */
  const deadlinesRead = useRef(0);
  /** The record's task checklist (M17/1, CTR-017). State rather than
   * loader data because every task write answers the whole checklist,
   * and the section replaces what it holds without a page re-read. */
  const [tasks, setTasks] = useState<ContractTask[]>(contractTasks);
  const [taskDoneCount, setTaskDoneCount] = useState(contractTaskDoneCount);
  const [taskTotalCount, setTaskTotalCount] = useState(contractTaskTotalCount);
  /**
   * Which version the doc panel is reading, or none (M12/2).
   *
   * The record holds it rather than the Documents section, because the
   * panel is not part of that section: DES-016 puts it in a wider
   * sibling layer beside the applet panel, and only the record's applet
   * region can hold a column.
   *
   * It names the version rather than the document, because any round in
   * the chain opens — reading round three of a negotiation is not a
   * different feature from reading round five.
   *
   * Two ids, and nothing else: what the panel draws is resolved from
   * the paper on screen on every render, so renaming a document while it
   * is open changes the panel's own header, and a document that leaves
   * the listing takes the panel with it.
   */
  const [reading, setReading] = useState<{ documentId: string; versionId: string } | null>(null);
  /** What opened the panel, so closing it puts focus back there —
   * DES-010's restore-to-trigger rule, wired by hand because the panel
   * is a plain aside. */
  const readingTrigger = useRef<HTMLElement | null>(null);
  /** The other side (CTR-011), primary first as the API orders it. */
  const [parties, setParties] = useState<ContractCounterparty[]>(counterparties);
  const [drafts, setDrafts] = useState<Record<TextFieldKey, string>>(() => textDrafts(contract));
  /** The term's four typed fields, held as text while they are being
   * edited: a half-typed date and an empty count are both states an
   * input passes through, and neither is a value to commit (CTR-006). */
  const [termFields, setTermFields] = useState<Record<TermDraftKey, string>>(() =>
    termDrafts(contract),
  );
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<FieldKey, FieldStatus>>>({});
  const [fieldError, setFieldError] = useState<Partial<Record<FieldKey, string | undefined>>>({});
  const [archiveStatus, setArchiveStatus] = useState<FieldStatus>("idle");
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined);

  /**
   * What happened to this record (DD-017), keyed by the same entity
   * reference the chat applet takes.
   *
   * Two catalogs ride along, because the log has neither. A
   * `field.<slug>` change key is a slug and not a name, and the type's
   * attached fields are what turn one into the other. Two of those
   * fields store an id rather than a value (CTR-016's `user` and
   * `entity`), and the names for those ids are already on this page —
   * the pickers loaded them. Everything the maps do not cover falls
   * back to what the log stored.
   */
  const historyApplet = useActivityApplet({
    entityType: "contract",
    entityId: contract.id,
    confidential: saved.isConfidential,
    fields: attached,
    referenceNames: useMemo(
      () =>
        Object.fromEntries([
          ...users.map((person) => [person.id, person.displayName] as const),
          ...refs.users.map((person) => [person.id, person.displayName] as const),
          ...entities.map((entity) => [entity.id, entity.legalName] as const),
          ...refs.entities.map((entity) => [entity.id, entity.legalName] as const),
        ]),
      [users, entities, refs],
    ),
  });

  const archived = saved.archivedAt !== null;
  /**
   * True when every control on the page is inert. Two states reach it
   * and they render the same way (CTR-021): an archived record, which
   * is facts until it is restored, and a Contributor's record, which is
   * facts because a Contributor reads. What differs is what the sub-bar
   * offers and what the note above the cards says.
   */
  const frozen = archived || !canEdit;
  /**
   * Whether this viewer may decide who sees the record (DD-014,
   * CTR-022). The three actors are an Administrator, the person who
   * made it — the `creator` team row, which nothing adds or drops — and
   * its Owner.
   *
   * It says exactly what `confidentialityWrite` says on the server, out
   * of the two facts the record read already answers: the roster and
   * the Owner. Reach is not asked again, because reaching the page is
   * what proves it. The API refuses anyone else with a plain 403; this
   * is only what keeps a control from offering a dead end.
   *
   * It reads the live roster and the saved row rather than the loader's
   * copies, so taking the Owner off the record takes the control with
   * them on the same page.
   */
  const canFlag =
    user.role === "administrator" ||
    saved.manager?.id === user.id ||
    roster.some((member) => member.id === user.id && member.role === "creator");

  /**
   * What the doc panel is drawing, resolved from the list rather than
   * held beside it (M12/2).
   *
   * Resolved on every render, so the panel says what the record says: a
   * rename changes its header, and a document archived out of the view
   * or erased simply stops resolving, which closes the panel rather
   * than leaving it drawing a file the record no longer has.
   */
  const open = (() => {
    if (!reading) return null;
    // The record root and the folders on screen, because a document
    // opens the same way wherever it is filed (M13/3).
    const document = [...paper, ...filed].find((row) => row.id === reading.documentId);
    const version = document?.versions.find((row) => row.id === reading.versionId);
    return document && version ? { document, version } : null;
  })();

  // A document that stopped resolving is one that left the list —
  // archived out of the live view, or erased. The panel is already
  // gone; this drops what is left of the reference so a later restore
  // does not reopen a panel nobody asked for.
  useEffect(() => {
    if (reading && !open) {
      setReading(null);
      readingTrigger.current = null;
    }
  }, [reading, open]);

  /** Closes the panel and puts focus back on the control that opened
   * it — DES-010's restore-to-trigger rule, wired by hand because the
   * panel is a plain aside. */
  function closeReading() {
    setReading(null);
    // Before the panel unmounts the element focus is sitting in.
    readingTrigger.current?.focus();
    readingTrigger.current = null;
  }

  function textDrafts(row: ContractRow): Record<TextFieldKey, string> {
    return { title: row.title, description: row.description ?? "" };
  }

  /** The saved term, as the four inputs hold it: an unrecorded date and
   * an unrecorded count are both an empty box. */
  function termDrafts(row: ContractRow): Record<TermDraftKey, string> {
    return {
      effectiveDate: row.effectiveDate ?? "",
      expiryDate: row.expiryDate ?? "",
      renewalPeriodMonths: row.renewalPeriodMonths === null ? "" : String(row.renewalPeriodMonths),
      noticePeriodDays: row.noticePeriodDays === null ? "" : String(row.noticePeriodDays),
    };
  }

  /**
   * Re-reads the record's deadline union (M16/3, CTR-009).
   *
   * Two of the three dates the Key dates section draws **are** the term,
   * so a term edit moves that section as surely as it moves the timeline
   * card. The union is re-read rather than patched here: its order, its
   * day counts, and which date it calls next are the seam's answer
   * (DES-040 clause 4), and a second copy of that rule on this page is
   * the copy that drifts.
   *
   * Two term fields committed in quick succession put two reads in
   * flight, and nothing makes them land in the order they were sent —
   * so each read takes a ticket and only the newest one is allowed to
   * write. Without it the older answer can arrive last and put the
   * section back to the term before the second edit.
   *
   * A read that fails leaves the union as it was and says nothing. The
   * commit itself has already landed and its own micro-state has already
   * said so; a second failure note about a background read would report
   * a change that did in fact happen as one that did not, and the
   * section is on another tab from the field that raised it.
   */
  function refreshDeadlines(number: number) {
    const ticket = ++deadlinesRead.current;
    void readContractKeyDates(number).then((outcome) => {
      if (outcome.ok && ticket === deadlinesRead.current) setDeadlines(outcome.deadlines);
    });
  }

  function note(key: FieldKey, status: FieldStatus, detail?: string) {
    setFieldStatus((current) => ({ ...current, [key]: status }));
    setFieldError((current) => ({ ...current, [key]: detail }));
  }

  /** One PATCH per committed field (DES-017): success adopts the
   * server's row as saved truth but resets only the committed field's
   * draft — another field's in-progress edit is not this commit's to
   * discard. The attached fields ride back on every answer because a
   * re-type replaces them, and a card still drawing the old type's
   * fields over the new type's values would be lying.
   *
   * It answers with the outcome as well as noting it. The field's own
   * micro-state is where a refusal normally reads, but a dialog sitting
   * over the record covers that spot — so the refusal is returned too,
   * and whoever asked for the commit decides where to show it. */
  async function commit(key: FieldKey, body: Record<string, unknown>): Promise<CommitOutcome> {
    note(key, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/contracts/{number}", {
        params: { path: { number: saved.number } },
        body,
      })
      .catch(() => ({ data: undefined, error: undefined }));
    if (!data) {
      const detail = problemDetail(error);
      note(key, "error", detail);
      return { ok: false, detail, type: problemType(error) };
    }
    const row = data.contract;
    setSaved(row);
    setAttached(data.fields);
    setRefs(data.customFieldRefs);
    if (key === "title" || key === "description") {
      setDrafts((current) => ({ ...current, [key]: textDrafts(row)[key] }));
    }
    // A term-type commit re-seeds all four term inputs: it clears the
    // fields the new type cannot hold (CTR-006), so its answer carries
    // more empty boxes than the request did. A typed term field's own
    // commit re-seeds only its own box — the rule above holds among the
    // term fields too: another box's in-progress edit is not this
    // commit's to discard.
    if (key === "termType") {
      setTermFields(termDrafts(row));
    } else if (key in termFields) {
      setTermFields((current) => ({ ...current, [key]: termDrafts(row)[key as TermDraftKey] }));
    }
    if (key === "termType" || key === "expiryDate" || key === "noticePeriodDays") {
      refreshDeadlines(row.number);
    }
    note(key, "saved");
    return { ok: true };
  }

  /**
   * Confirms the roll (M16/4, CTR-007's first vehicle).
   *
   * The `fromExpiry` it sends is the **saved** expiry and never a draft
   * from the Contract card: it is the precondition the seam compares
   * under the row's lock, and sending a half-typed box would either
   * refuse a good roll or confirm one against a date nobody committed.
   *
   * The answer carries the record and the whole history, so both are
   * replaced: the roll moved the expiry, which cleared the pending
   * banner and moved the deadline union under it.
   *
   * A refusal is printed once, in the dialog the act was raised from
   * (DES-035 clause 12), so it is returned rather than noted anywhere.
   * One refusal is also acted on: a lost race — refused by
   * `RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE`'s name — means the record moved
   * under the dialog, so the record is read again and the fresh row
   * adopted. Without that read, every re-press would carry the same
   * stale precondition and lose the same race against a record that has
   * already stopped moving.
   */
  async function confirmRoll(toExpiry: string): Promise<string | null> {
    const failed = () =>
      intl.formatMessage({
        id: "renewal.confirmFailed",
        defaultMessage: "The renewal could not be confirmed. Try again.",
      });
    // Both triggers and the dialog's own mount are drawn behind this,
    // so it is unreachable in practice. It answers a refusal rather
    // than silence because a guard that reported success would close
    // the dialog on a roll that never happened.
    if (saved.expiryDate === null) return failed();
    setRenewalStatus("saving");
    const outcome = await confirmContractRenewal(saved.number, saved.expiryDate, toExpiry);
    if (!outcome.ok) {
      setRenewalStatus("idle");
      // The one refusal a client acts on rather than prints: the expiry
      // moved under the dialog — somebody else confirmed the roll or
      // edited the date — so the record is read again and its fresh row
      // adopted, the same set a field commit adopts. The dialog then
      // names the expiry the record now holds, and a re-press carries
      // it as the precondition rather than looping on the stale one.
      if (outcome.type === RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE) {
        const { data } = await api
          .GET("/api/v1/contracts/{number}", { params: { path: { number: saved.number } } })
          .catch(() => ({ data: undefined }));
        if (data) {
          setSaved(data.contract);
          setRenewals(data.renewals);
          setAttached(data.fields);
          setRefs(data.customFieldRefs);
          setTermFields(termDrafts(data.contract));
          refreshDeadlines(data.contract.number);
        }
      }
      // Falsy rather than nullish, the two other dialogs on this page
      // already do: a refusal that carried an empty `detail` would put
      // an empty alert in the dialog, which reads as a write that
      // failed silently.
      return outcome.detail || failed();
    }
    setSaved(outcome.contract);
    setRenewals(outcome.renewals);
    // The expiry moved, so the derived notice deadline moved with it and
    // the CTR-009 union has to be read again — the same refresh a term
    // commit already asks for.
    setTermFields(termDrafts(outcome.contract));
    refreshDeadlines(outcome.contract.number);
    setRenewalStatus("saved");
    return null;
  }

  /**
   * One of the term's four typed fields, committed on blur or Enter
   * (DES-017). An empty box is `null` — nothing recorded.
   *
   * A count that is not a whole number is not a commit and not a
   * revert: it says so under the field and keeps what was typed, which
   * is the answer a custom number field already gives, and the only one
   * that leaves the person able to fix their own typo.
   */
  function commitTerm(key: TermDraftKey) {
    // Enter already committed this draft and the PATCH is in flight —
    // the blur that follows must not send a duplicate.
    if (fieldStatus[key] === "saving") return;
    const draft = termFields[key].trim();
    if (draft === termDrafts(saved)[key]) {
      revertTerm(key);
      return;
    }
    const isCount = key === "renewalPeriodMonths" || key === "noticePeriodDays";
    if (draft === "") {
      void commit(key, { [key]: null });
      return;
    }
    if (!isCount) {
      void commit(key, { [key]: draft });
      return;
    }
    const count = Number(draft);
    if (!Number.isInteger(count)) {
      note(
        key,
        "error",
        intl.formatMessage({
          id: "contracts.field.numberInvalid",
          defaultMessage: "Enter this as a number.",
        }),
      );
      return;
    }
    void commit(key, { [key]: count });
  }

  /** Puts the box back to what the record holds, and drops any refusal
   * the abandoned draft left standing — the note was about text that is
   * now gone, and under a saved value it would read as a lie. */
  function revertTerm(key: TermDraftKey) {
    setTermFields((current) => ({ ...current, [key]: termDrafts(saved)[key] }));
    note(key, "idle");
  }

  /**
   * The status, committed like any other select — until CTR-012's soft
   * gate stops it.
   *
   * The gate is the seam's, and it stays the seam's: this does not
   * work out whether the move crosses the approval stage, and it does
   * not read the roster to decide whether to warn. It sends the commit,
   * and a refusal carrying the gate's own problem type is what raises
   * the dialog. One rule, in one place — a second copy here would drift
   * the first time a stage moved.
   *
   * The refusal's micro-state under the select is cleared as the dialog
   * opens: the dialog is the refusal, and printing it twice reads as
   * two failures (DES-035 clause 12).
   */
  async function changeStatus(statusId: string, override = false) {
    const outcome = await commit(
      "statusId",
      override ? { statusId, overrideSoftGate: true } : { statusId },
    );
    if (outcome.ok) {
      setGateTo(null);
      return undefined;
    }
    if (outcome.type === SOFT_GATE_PROBLEM_TYPE) {
      const target = statusOptions.find((option) => option.id === statusId);
      if (target) {
        note("statusId", "idle");
        setGateTo(target);
        return undefined;
      }
    }
    return outcome.detail ?? "";
  }

  /** One custom field, committed by slug (CTR-016). `null` clears it. */
  function commitCustomField(slug: string, value: CustomFieldValue | null) {
    return commit(`field:${slug}`, { customFields: { [slug]: value } });
  }

  /**
   * Re-typing (CTR-002/MTR-014). When the new type demands nothing the
   * record does not already answer, it commits like any other select.
   * When it demands something, the record has nowhere to fill it — the
   * gaps belong to a type the contract does not hold yet — so the
   * dialog collects them and commits the type and the values together.
   */
  function pickType(contractTypeId: string) {
    const target = contractTypes.find((option: ContractTypeOption) => option.id === contractTypeId);
    if (!target || target.id === saved.contractTypeId) return;
    if (unansweredRequired(target.fields, saved.customFields).length === 0) {
      void commit("contractTypeId", { contractTypeId });
      return;
    }
    setRetypeTo(target);
  }

  function commitText(key: TextFieldKey) {
    // Enter already committed this draft and the PATCH is in flight —
    // the blur that follows must not send a duplicate.
    if (fieldStatus[key] === "saving") return;
    const draft = drafts[key].trim();
    const savedValue = key === "title" ? saved.title : (saved.description ?? "");
    if (draft === savedValue || (key === "title" && draft === "")) {
      // Nothing to save (or nothing valid): revert per DES-017.
      setDrafts((current) => ({ ...current, [key]: savedValue }));
      return;
    }
    void commit(key, { [key]: key === "title" ? draft : draft || null });
  }

  function revertText(key: TextFieldKey) {
    setDrafts((current) => ({
      ...current,
      [key]: key === "title" ? saved.title : (saved.description ?? ""),
    }));
  }

  async function archiveOrRestore() {
    setArchiveStatus("saving");
    setArchiveError(undefined);
    const path = { params: { path: { number: saved.number } } };
    const { data, error } = await (
      archived
        ? api.POST("/api/v1/contracts/{number}/restore", path)
        : api.POST("/api/v1/contracts/{number}/archive", path)
    ).catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      // A record-level action: the card re-reads as saved truth, so
      // every draft resets — an in-progress edit on a record being
      // archived is deliberately discarded, and a restore starts clean.
      const row = data.contract;
      setSaved(row);
      setDrafts(textDrafts(row));
      setTermFields(termDrafts(row));
      setArchiveStatus("idle");
    } else {
      setArchiveStatus("error");
      setArchiveError(problemDetail(error));
    }
  }

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  const reference = contractReference(intl, saved.number);
  const notRecorded = intl.formatMessage(NOT_RECORDED);
  /** The Owner runs the contract, and contract surfaces are Member+
   * (DD-013) — so only Member+ people are offered. The API's refusal is
   * the real guard; this keeps the picker from offering a dead end. */
  const ownerOptions = users.filter((person: UserOption) => isMemberPlus(person.role));
  const entityOptions = signingEntityOptions(entities, saved.entity);
  /** What a `user` custom field offers: everyone the pickers offer,
   * plus anyone a stored value already names. A custom person field is
   * not the Owner, so it is not held to the Member+ floor (CTR-004). */
  const peopleReferences = mergeReferences(
    users.map((person: UserOption) => ({
      id: person.id,
      label: person.displayName,
      archived: person.archived,
    })),
    refs.users.map((person) => ({
      id: person.id,
      label: person.displayName,
      archived: person.archived,
    })),
  );
  /** What an `entity` custom field offers: the live registry, plus any
   * Entity a stored value already names. */
  const entityReferences = mergeReferences(
    entityOptions.map((entity) => ({ id: entity.id, label: entity.legalName })),
    refs.entities.map((entity) => ({ id: entity.id, label: entity.legalName })),
  );
  /** The saved type may have been archived since, and so be absent from
   * the picker read — keep it selectable as itself rather than let the
   * select lie about what the record holds. */
  const typeOptions: ContractTypeOption[] = contractTypes.some(
    (option: ContractTypeOption) => option.id === saved.contractTypeId,
  )
    ? contractTypes
    : [
        {
          id: saved.contractTypeId,
          slug: saved.contractTypeId,
          displayName: saved.contractTypeName,
          fields: attached,
        },
        ...contractTypes,
      ];
  /** The saved status may have been archived since, and so be absent
   * from the picker read — keep it selectable as itself rather than let
   * the select lie about what the record holds. */
  const statusOptions: ContractStatusOption[] = contractStatuses.some(
    (option: ContractStatusOption) => option.id === saved.statusId,
  )
    ? contractStatuses
    : [
        {
          id: saved.statusId,
          slug: saved.statusId,
          displayName: saved.statusName,
          stage: saved.stage,
        },
        ...contractStatuses,
      ];

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      flush
      // DES-009 Tier 2, where the C8 mock stacks it: under the nav,
      // above the sub-bar. Every viewer who reaches a confidential
      // record sees it — reaching the page is what makes them an
      // included viewer — and only the three actors are pointed at the
      // Team card, which is where the audience is changed.
      banner={
        saved.isConfidential || saved.renewalPendingConfirmation ? (
          <>
            {saved.isConfidential && (
              <ConfidentialBanner manageTeamHref={canFlag ? `#${TEAM_CARD_ID}` : undefined} />
            )}
            {/* CTR-006's pending state, drawn where the C9 mock stacks
                it — the same strip DES-009 uses, under the
                confidentiality statement when a record carries both.
                Confidentiality leads because it governs who may read
                the page at all, and this one is about one date on it.
                It is a reading of the record's own expiry, so it goes
                the moment the roll is confirmed, and only a Member+
                viewer who may write is offered the way in. */}
            {saved.renewalPendingConfirmation && (
              <RenewalBanner onReview={canEdit ? () => setRenewing(true) : undefined} />
            )}
          </>
        ) : undefined
      }
      subbar={
        <>
          <section
            aria-labelledby="page-title"
            // Three groups on one 64px row, as the C2 mock draws them:
            // the breadcrumb, the stage pipeline, and the record
            // actions (DES-034). Under a 1024px shell they no longer
            // fit — the title truncates to nothing and the pipeline
            // slides over the status pill — so the row wraps and the
            // bar grows by one line. The pipeline is not allowed a
            // strip of its own (DES-032 closed that door), and it does
            // not need one: it shares the second line with the record
            // actions, and on a phone the top nav is hidden anyway, so
            // the chrome stays shorter than the desktop stack DES-032
            // already accepted.
            className={cn(
              "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2",
              "bg-canvas px-page-x py-2",
              "@5xl/shell:h-(--height-subbar) @5xl/shell:flex-nowrap @5xl/shell:py-0",
            )}
          >
            <div className="flex w-full min-w-0 items-center gap-2 @5xl/shell:w-auto">
              <Link
                to="/contracts"
                className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
              >
                <FormattedMessage id="contracts.title" defaultMessage="Contracts" />
              </Link>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
              {/* Parent chain breadcrumb segments (M17/2, CTR-015): each
                  reachable parent as a link, each restricted one as a
                  muted placeholder. The chain is root-first, so the
                  topmost ancestor comes right after "Contracts". */}
              {relations?.parentChain.map((entry, i) => (
                <span
                  key={entry.restricted ? `restricted-${i}` : entry.number}
                  className="flex shrink-0 items-center gap-2"
                >
                  {entry.restricted ? (
                    <span className="text-base text-muted">
                      <span aria-hidden="true">&hellip;</span>
                      <span className="sr-only">
                        <FormattedMessage
                          id="contracts.relations.restricted"
                          defaultMessage="Restricted contract"
                        />
                      </span>
                    </span>
                  ) : (
                    <Link
                      to={`/contracts/${entry.number}`}
                      className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                    >
                      {contractReference(intl, entry.number)}
                    </Link>
                  )}
                  <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
                </span>
              ))}
              <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="shrink-0 text-base font-medium text-muted">{reference}</span>
              <h1 id="page-title" className="truncate text-lg font-semibold">
                {saved.title}
              </h1>
              <span
                className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[saved.stage]}`}
              >
                {saved.statusName}
              </span>
              {archived && (
                <span className="inline-flex shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                  <FormattedMessage id="contracts.archivedPill" defaultMessage="Archived" />
                </span>
              )}
              {/* The envelope chip (grill row E.5, DES-036): drawn when
                  this record has sent paper out, and absent otherwise,
                  so a contract signed by hand carries no chrome about a
                  feature it never used. It says the newest round, which
                  is the one anybody asking is asking about. */}
              <EnvelopeChip envelope={signing.envelopes[0] ?? null} />
            </div>
            {/* CTR-001's six-stage backbone, beside the pill that names
                the status behind it (grill-plan D.8). It reads on an
                archived record and for a Contributor exactly as it
                reads for anyone else: where the contract sits is a fact
                about it, not an affordance. */}
            <StagePipeline stage={saved.stage} />
            {/* Archive and restore are mutations, so a read-only viewer
              is offered neither — absent, not disabled, the same
              convention the nav and the settings rail follow. */}
            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <StatusNote status={archiveStatus} detail={archiveError} />
                <Button
                  variant="secondary"
                  disabled={archiveStatus === "saving"}
                  onClick={() => void archiveOrRestore()}
                >
                  {archived ? (
                    <>
                      <ArchiveRestore size={16} aria-hidden="true" />
                      <FormattedMessage id="contracts.record.restore" defaultMessage="Restore" />
                    </>
                  ) : (
                    <>
                      <Archive size={16} aria-hidden="true" />
                      <FormattedMessage id="contracts.record.archive" defaultMessage="Archive" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </section>
          {/* DES-032's section strip, under the breadcrumb and inside
              the chrome: a tab strip that scrolled away with the record
              would be no tab strip at all. It carries the sub-bar's own
              bottom border, so the two read as one chrome slab. */}
          <RecordTabs
            label={intl.formatMessage({
              id: "contracts.record.sections",
              defaultMessage: "Contract sections",
            })}
            tabs={[
              {
                to: `/contracts/${saved.number}`,
                end: true,
                label: (
                  <FormattedMessage id="contracts.record.tab.overview" defaultMessage="Overview" />
                ),
              },
              {
                to: `/contracts/${saved.number}/fields`,
                label: (
                  <FormattedMessage id="contracts.record.tab.fields" defaultMessage="Fields" />
                ),
              },
              {
                to: `/contracts/${saved.number}/documents`,
                label: (
                  <FormattedMessage
                    id="contracts.record.tab.documents"
                    defaultMessage="Documents"
                  />
                ),
              },
              {
                to: `/contracts/${saved.number}/approvals`,
                label: (
                  <FormattedMessage
                    id="contracts.record.tab.approvals"
                    defaultMessage="Approvals"
                  />
                ),
              },
              {
                to: `/contracts/${saved.number}/key-dates`,
                label: (
                  <FormattedMessage id="contracts.record.tab.keyDates" defaultMessage="Key dates" />
                ),
              },
              {
                to: `/contracts/${saved.number}/tasks`,
                label: <FormattedMessage id="contracts.record.tab.tasks" defaultMessage="Tasks" />,
              },
            ]}
          />
        </>
      }
    >
      {/* Reference then title, composed as one message — the separator
          is locale copy, not code (DES-013). */}
      <PageTitle
        title={intl.formatMessage(
          { id: "contracts.record.documentTitle", defaultMessage: "{reference} {title}" },
          { reference, title: saved.title },
        )}
      />
      {/* The settings slot is absent for anyone the settings routes
          would bounce (SET-002): every contract-settings loader sends a
          non-Administrator to their profile, and a door that opens on a
          redirect is worse than no door. */}
      <RecordApplets
        applets={
          user.role === "administrator"
            ? [chatApplet, historyApplet, SETTINGS_APPLET]
            : [chatApplet, historyApplet]
        }
        // DES-016's wider sibling layer (M12/2): the document being
        // read, beside the record rather than instead of it.
        layer={
          open && (
            <DocPanel
              documentId={open.document.id}
              title={open.document.title}
              version={open.version}
              onClose={closeReading}
            />
          )
        }
      >
        <div className="flex flex-col gap-4 overflow-y-auto px-page-x py-page-y">
          {archived && (
            <p className="rounded-card bg-status-warning-bg px-3 py-2 text-md text-status-warning-fg">
              <FormattedMessage
                id="contracts.record.archivedNote"
                defaultMessage="This contract is archived — it is out of the contract list. Restore it to edit."
              />
            </p>
          )}
          {/* A read-only viewer is told why, once, above the cards.
              A note is not an affordance: it explains the inert
              controls rather than offering a way around them. */}
          {!canEdit && !archived && (
            <p className="rounded-card bg-status-neutral-bg px-3 py-2 text-md text-status-neutral-fg">
              <FormattedMessage
                id="contracts.record.readOnlyNote"
                defaultMessage="This record is read-only. Ask a Legal Team Member to make a change."
              />
            </p>
          )}
          {/* The C2 body: the record's own fields, with the people
              column beside them. Below the container threshold the two
              stack, so the roster follows the record (DES-012).

              The section tab decides what the main column holds; the
              Team column is not one of the sections and stands beside
              all four. Who is on a contract is context for reading any
              part of it, and the DES-028 banner's "Manage team" link is
              a fragment to that card — a link that only resolved on one
              tab would be a link that sometimes goes nowhere. */}
          <div className="flex flex-col items-start gap-4 @4xl/page:flex-row">
            <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
              {tab === "overview" && (
                <>
                  <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
                    <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
                      <h2 className="text-base font-semibold">
                        <FormattedMessage id="contracts.record.section" defaultMessage="Contract" />
                      </h2>
                    </header>
                    <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-2">
                      <div className="@2xl/page:col-span-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="contract-title">
                            <FormattedMessage
                              id="contracts.form.titleField"
                              defaultMessage="Title"
                            />
                          </Label>
                          <div className="flex items-center gap-2">
                            <Input
                              id="contract-title"
                              value={drafts.title}
                              disabled={frozen}
                              onChange={(event) =>
                                setDrafts((current) => ({ ...current, title: event.target.value }))
                              }
                              onBlur={() => commitText("title")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") commitText("title");
                                if (event.key === "Escape") revertText("title");
                              }}
                            />
                            <StatusNote
                              status={fieldStatus.title ?? "idle"}
                              detail={fieldError.title}
                            />
                          </div>
                        </div>
                      </div>
                      <ReadOnlyField
                        label={
                          <FormattedMessage
                            id="contracts.column.reference"
                            defaultMessage="Reference"
                          />
                        }
                        value={reference}
                      />
                      {/* The type is a field like any other on the surface,
                      and not like any other underneath: picking one
                      re-checks what that type demands (MTR-014), so a
                      pick with gaps opens a dialog instead of
                      committing. The C2 mock draws the type in a hero
                      meta strip that edits through the page-level Edit
                      toggle DES-017 removed, so it lands here with the
                      other scalars — the same move the Owner, our
                      entity, and the value already made. */}
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-type">
                          <FormattedMessage
                            id="contracts.form.type"
                            defaultMessage="Contract type"
                          />
                        </Label>
                        <div className="flex items-center gap-2">
                          <select
                            id="contract-type"
                            value={saved.contractTypeId}
                            className={CONTROL_CLASS}
                            disabled={frozen}
                            onChange={(event) => pickType(event.target.value)}
                          >
                            {typeOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.displayName}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.contractTypeId ?? "idle"}
                            detail={fieldError.contractTypeId}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-owner">
                          <FormattedMessage id="contracts.form.owner" defaultMessage="Owner" />
                        </Label>
                        <div className="flex items-center gap-2">
                          <select
                            id="contract-owner"
                            value={saved.manager?.id ?? ""}
                            className={CONTROL_CLASS}
                            disabled={frozen}
                            onChange={(event) =>
                              void commit("managerId", { managerId: event.target.value || null })
                            }
                          >
                            {/* Empty is a real answer: an unassigned contract
                        sits in triage until someone takes it (CTR-004). */}
                            <option value="">
                              {intl.formatMessage({
                                id: "contracts.ownerUnassigned",
                                defaultMessage: "Unassigned",
                              })}
                            </option>
                            {/* The saved Owner may have been archived since, and
                        so be absent from the picker read — keep them
                        selectable as themselves rather than let the
                        select lie about what the record holds. */}
                            {(saved.manager &&
                            !ownerOptions.some((person) => person.id === saved.manager!.id)
                              ? [saved.manager, ...ownerOptions]
                              : ownerOptions
                            ).map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.displayName}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.managerId ?? "idle"}
                            detail={fieldError.managerId}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-entity">
                          {/* "Our entity" as the C2 mock labels it: the Entity
                        is ours, the Counterparty is theirs, and the
                        record must never blur the two (CONTEXT.md). */}
                          <FormattedMessage
                            id="contracts.form.entity"
                            defaultMessage="Our entity"
                          />
                        </Label>
                        <div className="flex items-center gap-2">
                          <select
                            id="contract-entity"
                            value={saved.entity?.id ?? ""}
                            className={CONTROL_CLASS}
                            disabled={frozen}
                            onChange={(event) =>
                              void commit("entityId", { entityId: event.target.value || null })
                            }
                          >
                            {/* Empty is a real answer: a contract is often
                        recorded before anyone decides which of ours
                        signs it (CTR-011). */}
                            <option value="">
                              {intl.formatMessage({
                                id: "contracts.entityUnknown",
                                defaultMessage: "Not known yet",
                              })}
                            </option>
                            {entityOptions.map((entity) => (
                              <option key={entity.id} value={entity.id}>
                                {entity.legalName}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.entityId ?? "idle"}
                            detail={fieldError.entityId}
                          />
                        </div>
                      </div>
                      {/* Their side, next to ours: the two never blur
                    (CONTEXT.md), and the record reads them together. */}
                      <CounterpartiesField
                        contractNumber={saved.number}
                        parties={parties}
                        frozen={frozen}
                        status={fieldStatus.counterparties ?? "idle"}
                        error={fieldError.counterparties}
                        onStatus={(next, detail) => note("counterparties", next, detail)}
                        onChange={(row, next) => {
                          // The primary decides what the list column and the
                          // record hero show, so the row moves with the party.
                          setSaved(row);
                          setParties(next);
                        }}
                      />
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-status">
                          <FormattedMessage id="contracts.form.status" defaultMessage="Status" />
                        </Label>
                        <div className="flex items-center gap-2">
                          {/* Inert while a status commit is in flight, the
                          way the Confidential flag's own control is. The
                          soft gate is why it matters here: a second pick
                          landing behind the first would raise a dialog
                          about a status nobody is moving to any more. */}
                          <select
                            id="contract-status"
                            value={saved.statusId}
                            className={CONTROL_CLASS}
                            disabled={frozen || fieldStatus.statusId === "saving"}
                            onChange={(event) => void changeStatus(event.target.value)}
                          >
                            {statusOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.displayName}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.statusId ?? "idle"}
                            detail={fieldError.statusId}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-priority">
                          <FormattedMessage
                            id="contracts.form.priority"
                            defaultMessage="Priority"
                          />
                        </Label>
                        <div className="flex items-center gap-2">
                          <select
                            id="contract-priority"
                            value={saved.priority}
                            className={CONTROL_CLASS}
                            disabled={frozen}
                            onChange={(event) =>
                              void commit("priority", {
                                priority: event.target.value as SeverityLevel,
                              })
                            }
                          >
                            {SEVERITY_LEVELS.map((level) => (
                              <option key={level} value={level}>
                                {severityLabel(intl, level)}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.priority ?? "idle"}
                            detail={fieldError.priority}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-risk">
                          <FormattedMessage id="contracts.form.risk" defaultMessage="Risk" />
                        </Label>
                        <div className="flex items-center gap-2">
                          <select
                            id="contract-risk"
                            value={saved.risk ?? ""}
                            className={CONTROL_CLASS}
                            disabled={frozen}
                            onChange={(event) =>
                              void commit("risk", {
                                risk:
                                  event.target.value === ""
                                    ? null
                                    : (event.target.value as SeverityLevel),
                              })
                            }
                          >
                            {/* Empty is a real answer, not a placeholder: risk
                        stays unset until legal assesses it (CTR-005). */}
                            <option value="">{riskLabel(intl, null)}</option>
                            {SEVERITY_LEVELS.map((level) => (
                              <option key={level} value={level}>
                                {severityLabel(intl, level)}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.risk ?? "idle"}
                            detail={fieldError.risk}
                          />
                        </div>
                      </div>
                      {/* CTR-010's value: three controls, one field. It sits
                    with the other scalars the record holds, because the
                    C2 hero meta strip it is drawn in edits through the
                    page-level Edit toggle DES-017 removed — the same
                    move the Owner, our entity, and the counterparties
                    already made. */}
                      <ValueField
                        value={saved.value}
                        frozen={frozen}
                        status={fieldStatus.value ?? "idle"}
                        error={fieldError.value}
                        onStatus={(next, detail) => note("value", next, detail)}
                        onCommit={(next) => void commit("value", { value: next })}
                      />
                      {/* CTR-006's term: five fields, and one rule
                          running between them. Each commits on its own
                          (DES-017, no carve-out), and the type is what
                          decides which of the other four this record
                          may hold at all — so the two the type forbids
                          are drawn as facts with an em dash rather than
                          as boxes the seam would refuse everything
                          typed into. The blank is honest either way: it
                          says the record holds nothing there, which is
                          exactly true. */}
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="contract-term-type">
                          <FormattedMessage
                            id="contracts.form.termType"
                            defaultMessage="Term type"
                          />
                        </Label>
                        <div className="flex items-center gap-2">
                          <select
                            id="contract-term-type"
                            value={saved.termType}
                            className={CONTROL_CLASS}
                            disabled={frozen}
                            onChange={(event) =>
                              void commit("termType", {
                                termType: event.target.value as TermType,
                              })
                            }
                          >
                            {TERM_TYPES.map((option) => (
                              <option key={option} value={option}>
                                {termTypeLabel(intl, option)}
                              </option>
                            ))}
                          </select>
                          <StatusNote
                            status={fieldStatus.termType ?? "idle"}
                            detail={fieldError.termType}
                          />
                        </div>
                      </div>
                      <TermField
                        id="contract-effective-date"
                        type="date"
                        label={
                          <FormattedMessage
                            id="contracts.form.effectiveDate"
                            defaultMessage="Effective date"
                          />
                        }
                        draft={termFields.effectiveDate}
                        frozen={frozen}
                        status={fieldStatus.effectiveDate ?? "idle"}
                        error={fieldError.effectiveDate}
                        onDraft={(next) =>
                          setTermFields((current) => ({ ...current, effectiveDate: next }))
                        }
                        onCommit={() => commitTerm("effectiveDate")}
                        onRevert={() => revertTerm("effectiveDate")}
                      />
                      {/* An evergreen contract has no end, so the record
                          does not offer to invent one for it. */}
                      {saved.termType === "evergreen" ? (
                        <ReadOnlyField
                          label={
                            <FormattedMessage
                              id="contracts.form.expiryDate"
                              defaultMessage="Expiry date"
                            />
                          }
                          value={notRecorded}
                        />
                      ) : (
                        <TermField
                          id="contract-expiry-date"
                          type="date"
                          label={
                            <FormattedMessage
                              id="contracts.form.expiryDate"
                              defaultMessage="Expiry date"
                            />
                          }
                          draft={termFields.expiryDate}
                          frozen={frozen}
                          status={fieldStatus.expiryDate ?? "idle"}
                          error={fieldError.expiryDate}
                          onDraft={(next) =>
                            setTermFields((current) => ({ ...current, expiryDate: next }))
                          }
                          onCommit={() => commitTerm("expiryDate")}
                          onRevert={() => revertTerm("expiryDate")}
                        />
                      )}
                      {/* Nothing rolls but an auto-renewing contract, so
                          nothing else is asked how far a roll goes. */}
                      {saved.termType === "auto_renew" ? (
                        <TermField
                          id="contract-renewal-period"
                          type="number"
                          // A roll of zero months would advance an
                          // expiry to itself, so the stepper cannot
                          // reach it — the same floor the seam holds.
                          min={1}
                          label={
                            <FormattedMessage
                              id="contracts.form.renewalPeriod"
                              defaultMessage="Renewal period (months)"
                            />
                          }
                          draft={termFields.renewalPeriodMonths}
                          frozen={frozen}
                          status={fieldStatus.renewalPeriodMonths ?? "idle"}
                          error={fieldError.renewalPeriodMonths}
                          onDraft={(next) =>
                            setTermFields((current) => ({ ...current, renewalPeriodMonths: next }))
                          }
                          onCommit={() => commitTerm("renewalPeriodMonths")}
                          onRevert={() => revertTerm("renewalPeriodMonths")}
                        />
                      ) : (
                        <ReadOnlyField
                          label={
                            <FormattedMessage
                              id="contracts.form.renewalPeriod"
                              defaultMessage="Renewal period (months)"
                            />
                          }
                          value={notRecorded}
                        />
                      )}
                      {/* A notice obligation sits on any kind of term,
                          so this box is drawn whatever the type says.
                          The deadline it feeds derives only when there
                          is an expiry to subtract it from. */}
                      <TermField
                        id="contract-notice-period"
                        type="number"
                        // Zero days' notice is a real term: some
                        // contracts end on the date and no earlier.
                        min={0}
                        label={
                          <FormattedMessage
                            id="contracts.form.noticePeriod"
                            defaultMessage="Notice period (days)"
                          />
                        }
                        draft={termFields.noticePeriodDays}
                        frozen={frozen}
                        status={fieldStatus.noticePeriodDays ?? "idle"}
                        error={fieldError.noticePeriodDays}
                        onDraft={(next) =>
                          setTermFields((current) => ({ ...current, noticePeriodDays: next }))
                        }
                        onCommit={() => commitTerm("noticePeriodDays")}
                        onRevert={() => revertTerm("noticePeriodDays")}
                      />
                      {/* Derived from the expiry and never stored, so it
                          is a fact of the record rather than a field of
                          it — and blank for an evergreen contract,
                          which has no end to count down to. */}
                      <ReadOnlyField
                        label={
                          <FormattedMessage
                            id="contracts.form.daysRemaining"
                            defaultMessage="Days remaining"
                          />
                        }
                        value={daysRemainingLabel(intl, saved.daysRemaining) ?? notRecorded}
                      />
                      {/* When the term last rolled (grill row G.R5).
                          Read from the record's renewal history rather
                          than from a column, because nothing stores a
                          renewal: the confirmed-roll entries are what
                          says one happened, and the newest of them is
                          the first the seam answers. A record where no
                          roll has been confirmed prints the same em
                          dash every other absence on this card prints
                          (X.6, DES-040 clause 5) — most contracts have
                          never renewed, and that is a fact rather than
                          a gap. */}
                      <ReadOnlyField
                        label={
                          <FormattedMessage
                            id="contracts.form.lastRenewal"
                            defaultMessage="Last renewal"
                          />
                        }
                        value={
                          renewals[0]
                            ? formatShortDate(renewals[0].confirmedAt, { locale: intl.locale })
                            : notRecorded
                        }
                      />
                      {/* Who may see the record at all (DD-014). It closes
                      the card because it is the record's audience
                      rather than one of its business facts, and it is
                      the one field here that most of the people
                      reading it may not touch.

                      It commits on the switch's own change: a switch
                      has no blur to wait for, and DES-017 commits when
                      the person is done deciding — which for a
                      two-state control is the moment they flip it, the
                      same rule the record's selects already follow. */}
                      <div className="@2xl/page:col-span-2">
                        <ConfidentialToggle
                          id="contract-confidential"
                          confidential={saved.isConfidential}
                          // Archived refuses the flag edit like every other
                          // edit, and only the three actors may ask for
                          // one. Everyone else reads it inert — a fact
                          // about the record, not a control they must not
                          // press.
                          disabled={frozen || !canFlag || fieldStatus.isConfidential === "saving"}
                          status={
                            <StatusNote
                              status={fieldStatus.isConfidential ?? "idle"}
                              detail={fieldError.isConfidential}
                            />
                          }
                          onChange={(next) =>
                            void commit("isConfidential", { isConfidential: next })
                          }
                        />
                      </div>
                    </div>
                  </section>
                  {/* The C2 mock gives the description a card of its own,
                  and it earns one: it is the only free-form field on
                  the record, and a textarea the width of the card reads
                  as prose rather than as one more entry in a field
                  grid. It follows the Contract card because the facts
                  come before the account of them — the mock's own order,
                  where the hero the Contract card replaces leads.

                  The heading names the textarea rather than the card:
                  one accessible name each, carried by the control that
                  answers to it, as the Contract card above does. */}
                  <section className="w-full overflow-hidden rounded-card border border-border-default bg-raised">
                    <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
                      <h2 id="contract-description-heading" className="text-base font-semibold">
                        <FormattedMessage
                          id="contracts.form.description"
                          defaultMessage="Description"
                        />
                      </h2>
                    </header>
                    <div className="flex items-start gap-2 p-4">
                      <textarea
                        id="contract-description"
                        // The card's own heading names the field: a second
                        // label above a full-width textarea would repeat it.
                        aria-labelledby="contract-description-heading"
                        value={drafts.description}
                        className={TEXTAREA_CLASS}
                        disabled={frozen}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, description: event.target.value }))
                        }
                        onBlur={() => commitText("description")}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") revertText("description");
                        }}
                      />
                      <StatusNote
                        status={fieldStatus.description ?? "idle"}
                        detail={fieldError.description}
                      />
                    </div>
                  </section>
                  {/* CTR-006's term as a picture (M16/2). It closes the
                      Overview because it draws facts the two cards
                      above already state — the mock's own order, where
                      the Timeframe card is the section's last — and it
                      holds nothing of its own: every mark on it is one
                      of the record's dates. */}
                  <TermTimelineCard contract={saved} />
                  {/* The contract's relation surface (M17/2, CTR-015): the
                      parent chain, the children, and the typed links this
                      contract carries. Absent when the read failed — an
                      empty state is a fact about the record, not a
                      fallback for a read that did not happen. */}
                  {relations !== null && (
                    <RelatedContractsCard
                      contractNumber={saved.number}
                      contractIsConfidential={saved.isConfidential}
                      relations={relations}
                      editable={canEdit && !archived}
                    />
                  )}
                </>
              )}
              {/* CTR-016's fields, in the card the C2 mock draws for
                  them and in the order the type's attachment join
                  gives. They are the Fields section (DES-032): what
                  this contract's type asks for on top of the record's
                  own columns, and — once CTR-008 lands — where the
                  extraction writes its answers. */}
              {tab === "fields" && (
                <FieldsCard
                  fields={attached}
                  values={saved.customFields}
                  people={peopleReferences}
                  entities={entityReferences}
                  frozen={frozen}
                  status={fieldStatus}
                  error={fieldError}
                  onStatus={note}
                  onCommit={commitCustomField}
                />
              )}
              {/* The record's paper (M11/2, M11/3), in the section the
                  C4 mock draws — and behind the tab the mock puts it
                  behind (DES-032). The full document panel DES-016
                  places in a wider sibling layer opens from here. */}
              {tab === "documents" && (
                <DocumentsCard
                  contractNumber={saved.number}
                  documents={paper}
                  folders={tree}
                  nextCursor={paperCursor}
                  frozen={frozen}
                  // DOC-010's erasure is the Administrator's alone, and it
                  // is the one control on this section a role decides.
                  role={user.role}
                  // DD-014's per-document flag has an actor set of three
                  // (CTR-022), and two of them are people rather than a
                  // role: the person who uploaded the document, which the
                  // row states, and the record's Owner, which only the
                  // record holds. The saved row rather than the loader's
                  // copy, so taking the Owner off takes the control with
                  // them on the same page.
                  viewerId={user.id}
                  ownerId={saved.manager?.id ?? null}
                  // Opening a version in the doc panel (M12/2). The
                  // trigger comes with it so closing puts focus back on
                  // the row control that opened it.
                  reading={reading?.versionId ?? null}
                  // CTR-007's amendment vehicle, routed here from the
                  // Renew dialog (M16/5). The section opens its
                  // composer on the record's instrument; the file and
                  // the write are the M11 upload path, unchanged.
                  amending={amending ? (signing.primaryDocument?.id ?? null) : null}
                  onAmendmentOpened={stopAmending}
                  onRead={(document, version, trigger) => {
                    readingTrigger.current = trigger;
                    setReading({ documentId: document.id, versionId: version.id });
                  }}
                  onDocuments={(rows, cursor) => {
                    setPaper(rows);
                    // `undefined` means the write changed rows without
                    // moving the position: a metadata edit is not a page.
                    if (cursor !== undefined) setPaperCursor(cursor);
                  }}
                  // The setter itself rather than a lambda around it:
                  // the section's report watches its own listings and
                  // nothing else, so what it calls has to stay the same
                  // function across a render.
                  onFiled={setFiled}
                  onFolders={setTree}
                />
              )}
              {/* Who has been asked to sign the record off (M14/3,
                  CTR-012) and what paper it has sent out (M15/2,
                  CTR-013), in the section the C5 mock draws it in. Both
                  kinds of row are auto-derived: nothing here authors an
                  event, and the request and send affordances are the
                  only writes. */}
              {/* Every date on the record, in the section the C6 mock
                  draws it in (M16/3, CTR-009): the key dates the team
                  adds, the contract's expiry, and the notice deadline
                  the record derives — one list, ordered, with the next
                  one named. */}
              {tab === "key-dates" && (
                <KeyDatesCard
                  contractNumber={saved.number}
                  deadlines={deadlines}
                  // The saved row, not the loader's copy: editing the
                  // notice period on the Overview changes what the
                  // derived row's own sentence says about itself.
                  noticePeriodDays={saved.noticePeriodDays}
                  frozen={frozen}
                  onDeadlines={setDeadlines}
                />
              )}
              {/* The record's task checklist (M17/1, CTR-017):
                  lightweight items with a done flag, an optional
                  assignee, and an optional due date. */}
              {tab === "tasks" && (
                <TasksCard
                  contractNumber={saved.number}
                  tasks={tasks}
                  doneCount={taskDoneCount}
                  totalCount={taskTotalCount}
                  frozen={frozen}
                  onTasksChange={(outcome) => {
                    setTasks(outcome.tasks);
                    setTaskDoneCount(outcome.doneCount);
                    setTaskTotalCount(outcome.totalCount);
                  }}
                />
              )}
              {tab === "approvals" && (
                <ApprovalsSigningCard
                  contractNumber={saved.number}
                  approvals={approvals}
                  signing={signing}
                  renewals={renewals}
                  // A record rolls when it auto-renews and records an
                  // expiry to advance — the seam's own two conditions,
                  // mirrored here so the head draws no control the
                  // seam would refuse. Whether the term has lapsed is
                  // deliberately not one of them: confirming a roll
                  // before the notice deadline is a normal act, and the
                  // banner is the reminder, not the gate.
                  canRenew={!frozen && saved.termType === "auto_renew" && saved.expiryDate !== null}
                  onRenew={() => setRenewing(true)}
                  users={users}
                  approverGroups={approverGroups}
                  // The live roster and the saved row, not the loader's
                  // copies: putting somebody on the team widens a
                  // confidential record's audience on the same page,
                  // and taking the Owner off takes their cancel with
                  // them.
                  team={roster}
                  viewerId={user.id}
                  viewerRole={user.role}
                  ownerId={saved.manager?.id ?? null}
                  isConfidential={saved.isConfidential}
                  frozen={frozen}
                  onApprovals={setApprovals}
                  onSigning={setSigning}
                />
              )}
            </div>
            <TeamCard
              contractNumber={saved.number}
              owner={saved.manager}
              roster={roster}
              users={users}
              frozen={frozen}
              // On a walled record the roster is the audience, and the
              // audience is the three actors' to decide (CTR-023). The
              // same `canFlag` twin the switch above uses, so the banner
              // cannot hide "Manage team" from somebody the card below
              // would then let manage it.
              audienceLocked={saved.isConfidential && !canFlag}
              onRoster={setRoster}
            />
          </div>
        </div>
      </RecordApplets>
      {retypeTo && (
        <RetypeDialog
          target={retypeTo}
          values={saved.customFields}
          people={peopleReferences}
          entities={entityReferences}
          onOpenChange={(open) => {
            if (!open) setRetypeTo(null);
          }}
          onConfirm={async (customFields) => {
            const outcome = await commit("contractTypeId", {
              contractTypeId: retypeTo.id,
              customFields,
            });
            if (outcome.ok) {
              setRetypeTo(null);
              return undefined;
            }
            // The seam's own refusal, handed back to the dialog: the
            // field's micro-state carries it too, but the dialog is
            // covering the field it would read on.
            return outcome.detail ?? "";
          }}
        />
      )}
      {gateTo && (
        <SoftGateDialog
          target={gateTo}
          unresolved={approvals.filter(isUnresolved)}
          onOpenChange={(open) => {
            if (!open) setGateTo(null);
          }}
          onConfirm={() => changeStatus(gateTo.id, true)}
        />
      )}
      {/* The Renew dialog (M16/4, CTR-007). It lives on the record
          rather than in the card that holds the renewal rows, because
          the pending banner raises it from the page's chrome and the
          chrome is on screen in every section — `SoftGateDialog`'s own
          reason for sitting here. The expiry guard is the same one the
          two triggers are drawn behind, said once more where the write
          is made: a record with no expiry has no term to roll. */}
      {renewing && saved.expiryDate !== null && (
        <ConfirmRenewalDialog
          reference={contractReference(intl, saved.number)}
          fromExpiry={saved.expiryDate}
          proposedExpiry={saved.proposedRenewalExpiry}
          renewalPeriodMonths={saved.renewalPeriodMonths}
          // A chain to append to, or no amendment option at all: the
          // record's own primary-document designation is the answer
          // (CTR-014), and a control for an act that does not exist is
          // not drawn (DES-035 clause 9). Read from the record's own
          // answer rather than from the paper on screen, because that
          // list is paged (CTR-024) and the instrument may not be on
          // the page the reader is holding.
          canAmend={signing.primaryDocument !== null}
          busy={renewalStatus === "saving"}
          onClose={() => setRenewing(false)}
          onConfirm={async (toExpiry) => {
            const refusal = await confirmRoll(toExpiry);
            if (refusal === null) setRenewing(false);
            return refusal;
          }}
          onRoute={(vehicle) => {
            setRenewing(false);
            if (vehicle === "amendment") {
              // The act happens on the record's own paper, so the
              // person is taken to the section that holds it and the
              // composer opens there.
              setAmending(true);
              void navigate(`/contracts/${saved.number}/documents`);
              return;
            }
            // One tick, on purpose. Two modal layers swapped inside a
            // single commit leave the page inert: the outgoing dialog
            // tears its layer down *after* the incoming one has decided
            // whether it has to opt itself back in to pointer events, so
            // the create dialog would mount unclickable. Letting the
            // Renew dialog finish leaving first is the whole of the
            // fix, and it costs a frame nobody sees.
            setTimeout(() => setRoutingTo(vehicle), 0);
          }}
        />
      )}
      {/* CTR-007's third and fourth vehicles (M16/5). The Contracts
          list's own create dialog, opened from the record so the seam
          knows which contract the renewal is a renewal of — and seeded
          with the two fields it draws, both still editable. Only a
          Member+ viewer reaches this: the pickers it needs are loaded
          for `canEdit` alone, and the Renew control that raises it is
          drawn behind the same test. */}
      {routingTo !== null && canEdit && (
        <CreateContractDialog
          // The record's own pickers, unchanged: the create dialog
          // grows the picked type's required fields, and a `user` or
          // `entity` field among them offers exactly what it offers on
          // the record itself.
          contractTypes={typeOptions}
          people={peopleReferences}
          entities={entityReferences}
          renewalOf={{
            number: saved.number,
            vehicle: routingTo,
            title: saved.title,
            contractTypeId: saved.contractTypeId,
          }}
          onOpenChange={(open) => {
            if (!open) setRoutingTo(null);
          }}
          onCreated={(row) => {
            setRoutingTo(null);
            // Straight to the record that was just born: it is where
            // the person finishes the renewal, and the dates the
            // prefill brought across are the first thing they will
            // want to move.
            void navigate(`/contracts/${row.number}`);
          }}
        />
      )}
    </AppShell>
  );
}

/** The rows a `user` or `entity` control offers: the live list first,
 * then anything a stored value names that the live list left out. */
function mergeReferences(
  live: readonly FieldReference[],
  held: readonly FieldReference[],
): FieldReference[] {
  const offered = new Set(live.map((row) => row.id));
  return [...live, ...held.filter((row) => !offered.has(row.id))];
}

/**
 * The record's people, as the C2 mock draws them: the Owner at the top
 * of the roster, then one row per `contract_team` role. The Owner row is
 * a statement here — the Owner select in the Contract card is where it
 * changes — because a roster's job is to answer "who is on this" in one
 * read.
 */
function TeamCard({
  contractNumber,
  owner,
  roster,
  users,
  frozen,
  audienceLocked,
  onRoster,
}: Readonly<{
  /** CTR-003's reference — the address every contract route takes. */
  contractNumber: number;
  owner: ContractRow["manager"];
  roster: readonly ContractTeamMember[];
  users: readonly UserOption[];
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  /** The record is confidential and this viewer is none of CTR-022's
   * three actors, so the roster is not theirs to change (CTR-023).
   *
   * Inert, not absent — the same treatment DES-028 gives the flag
   * control on the card above, for the same reason: the roster is a
   * statement of fact, and who is on the contract is not the part being
   * withheld. Only the deciding is. */
  audienceLocked: boolean;
  onRoster: (team: ContractTeamMember[]) => void;
}>) {
  const intl = useIntl();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A removal unmounts the row that held focus, so focus has to be put
   * somewhere deliberate — the card's own add control (DES-010's
   * return-focus rule, applied to a destructive row action). */
  const addControl = useRef<HTMLButtonElement>(null);
  /** One write at a time. This is a ref, not state: two clicks in one
   * tick both read the same pre-render state value and both pass, so a
   * state flag refuses nothing. */
  const inFlight = useRef(false);

  async function remove(member: ContractTeamMember) {
    if (inFlight.current) return;
    setError(null);
    inFlight.current = true;
    const { data, error: problem } = await api
      .DELETE("/api/v1/contracts/{number}/team/{userId}/{role}", {
        params: { path: { number: contractNumber, userId: member.id, role: member.role } },
      })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => {
        inFlight.current = false;
      });
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.team.removeError",
            defaultMessage: "That person could not be taken off the team.",
          }),
      );
      return;
    }
    onRoster(data.team);
    addControl.current?.focus();
  }

  return (
    <section
      // The banner's "Manage team" lands here: the audience is the
      // roster, so the one step from the reminder is the card that
      // holds it (DD-014's story 18).
      id={TEAM_CARD_ID}
      aria-labelledby="contract-team-heading"
      // The jump lands the card's own top edge against the top of the
      // scrolling body, which reads as clipped. The margin is breathing
      // room, not a clearance: the shell's strips are outside this
      // container and nothing can be scrolled under them (DES-030).
      className="w-full shrink-0 scroll-mt-4 overflow-hidden rounded-card border border-border-default bg-raised @4xl/page:w-80"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id="contract-team-heading" className="text-base font-semibold">
          <FormattedMessage id="contracts.team.section" defaultMessage="Team" />
        </h2>
        <Button
          ref={addControl}
          variant="ghost"
          size="icon"
          disabled={frozen || audienceLocked}
          aria-label={intl.formatMessage({
            id: "contracts.team.add",
            defaultMessage: "Add team member",
          })}
          onClick={() => setAddOpen(true)}
        >
          <Plus size={16} aria-hidden="true" />
        </Button>
      </header>
      <div className="flex flex-col py-1">
        {owner && (
          <PersonRow
            name={owner.displayName}
            image={owner.image}
            archived={owner.archived}
            role={intl.formatMessage({ id: "contracts.form.owner", defaultMessage: "Owner" })}
          />
        )}
        {roster.map((member) => (
          <PersonRow
            key={`${member.id}:${member.role}`}
            name={member.displayName}
            image={member.image}
            archived={member.archived}
            role={teamRoleLabel(intl, member.role)}
            // The creator is provenance — who made the record survives
            // every owner change, so it has no remove control.
            // A second click while the first is in flight is refused by
            // `remove` itself, so the control stays enabled and keeps
            // the focus its owner put on it.
            onRemove={frozen || member.role === "creator" ? undefined : () => void remove(member)}
            // Drawn and inert rather than gone: the row is a fact, and
            // only the deciding is withheld (CTR-023).
            removeDisabled={audienceLocked}
            // The role is selected inside the message, not pasted in as
            // a translated fragment — a locale that inflects the role
            // after "as" needs the raw value to work with (DES-013).
            removeLabel={intl.formatMessage(
              {
                id: "contracts.team.remove",
                defaultMessage:
                  "Take {name} off the team as {role, select, member {Member} " +
                  "watcher {Watcher} creator {Creator} contributor {Contributor} " +
                  "other {Unknown}}",
              },
              { name: member.displayName, role: member.role },
            )}
          />
        ))}
        {!owner && roster.length === 0 && (
          <p className="px-4 py-2 text-base text-muted">
            <FormattedMessage
              id="contracts.team.empty"
              defaultMessage="Nobody is on this contract yet."
            />
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-status-danger-fg">
          {error}
        </p>
      )}
      {addOpen && (
        <AddTeamMemberDialog
          contractNumber={contractNumber}
          users={users}
          onOpenChange={setAddOpen}
          onAdded={onRoster}
        />
      )}
    </section>
  );
}

/** One roster row: the face, the name, and what they are on this
 * contract. One avatar treatment everywhere (DES-018). */
function PersonRow({
  name,
  image,
  archived,
  role,
  onRemove,
  removeLabel,
  removeDisabled = false,
}: Readonly<{
  name: string;
  image: string | null;
  archived: boolean;
  role: string;
  onRemove?: () => void;
  removeLabel?: string;
  /** The control is offered but refused. Absent and inert say different
   * things: absent is "this row has no remove", inert is "this remove is
   * not yours". */
  removeDisabled?: boolean;
}>) {
  return (
    <div className={`flex h-10 items-center gap-2.5 px-4 ${archived ? "opacity-50" : ""}`}>
      <Avatar name={name} image={image} className="size-6" />
      <div className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-base font-medium">{name}</span>
        <span className="text-xs text-muted">{role}</span>
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="ms-auto"
          disabled={removeDisabled}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** Adding a person names two things at once — who, and in which role —
 * so it is the compound edit DES-017 carves out for a dialog. */
function AddTeamMemberDialog({
  contractNumber,
  users,
  onOpenChange,
  onAdded,
}: Readonly<{
  contractNumber: number;
  users: readonly UserOption[];
  onOpenChange: (open: boolean) => void;
  onAdded: (team: ContractTeamMember[]) => void;
}>) {
  const intl = useIntl();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ContractTeamRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    if (userId === "") {
      setError(
        intl.formatMessage({
          id: "contracts.team.personMissing",
          defaultMessage: "Pick a person.",
        }),
      );
      return;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/contracts/{number}/team", {
        params: { path: { number: contractNumber } },
        body: { userId, role },
      })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => setBusy(false));
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "contracts.team.addError",
            defaultMessage: "That person could not be added.",
          }),
      );
      return;
    }
    onAdded(data.team);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="contracts.team.add" defaultMessage="Add team member" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-person">
              <FormattedMessage id="contracts.team.person" defaultMessage="Person" />
            </Label>
            <select
              id="team-person"
              value={userId}
              className={CONTROL_CLASS}
              onChange={(event) => {
                setUserId(event.target.value);
                if (event.target.value !== "") setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({
                  id: "contracts.team.personPlaceholder",
                  defaultMessage: "Person…",
                })}
              </option>
              {users.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-role">
              <FormattedMessage id="contracts.team.role" defaultMessage="Role" />
            </Label>
            <select
              id="team-role"
              value={role}
              className={CONTROL_CLASS}
              onChange={(event) => setRole(event.target.value as ContractTeamRole)}
            >
              {ADDABLE_TEAM_ROLES.map((option) => (
                <option key={option} value={option}>
                  {teamRoleLabel(intl, option)}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="contracts.team.submit" defaultMessage="Add" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The other side of the contract (CTR-011), as one field of the record:
 * the parties it names, primary first, and the shared typeahead that
 * adds another. Only the primary reaches the contracts list, so the
 * record is where a tripartite deal is recorded honestly instead of
 * living in the description.
 *
 * Every write here answers with the contract row as well as the party
 * list, because moving the primary changes what the row says — the
 * caller adopts both or the two drift apart.
 */
function CounterpartiesField({
  contractNumber,
  parties,
  frozen,
  status,
  error,
  onStatus,
  onChange,
}: Readonly<{
  /** CTR-003's reference — the address every contract route takes. */
  contractNumber: number;
  parties: readonly ContractCounterparty[];
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  status: FieldStatus;
  error: string | undefined;
  onStatus: (status: FieldStatus, detail?: string) => void;
  onChange: (contract: ContractRow, parties: ContractCounterparty[]) => void;
}>) {
  const intl = useIntl();
  /**
   * One write at a time: a second, launched mid-flight, would race the
   * first, and the loser's party list would overwrite the winner's.
   * The gate is a ref, not the state below, because two clicks in one
   * tick read the same state and would both pass — the ref is written
   * before the request goes out. The state exists only to render the
   * row controls as standing down.
   */
  const inFlight = useRef(false);
  const hadRefusal = useRef(false);
  const [busy, setBusy] = useState(false);
  /** A removal unmounts the row that held focus, so focus has to be put
   * somewhere deliberate — the picker, which is where the next thing a
   * Legal Team Member does starts (DES-010's return-focus rule). */
  const picker = useRef<HTMLInputElement>(null);

  /** One counterparty write, whichever it was: they all answer with the
   * contract row and the party list, and they all report through the
   * same field micro-state (DES-017). */
  async function write(
    call: Promise<{
      data?: { contract: ContractRow; counterparties: ContractCounterparty[] };
      error?: unknown;
    }>,
  ) {
    if (inFlight.current) {
      // A refused pick has to say so. Dropping it in silence would look
      // exactly like a pick that landed and then vanished.
      hadRefusal.current = true;
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.counterparty.busy",
          defaultMessage: "One change at a time. Wait for the last one to save.",
        }),
      );
      return;
    }
    inFlight.current = true;
    hadRefusal.current = false;
    setBusy(true);
    onStatus("saving");
    const { data, error: problem } = await call
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
    if (!data) {
      hadRefusal.current = true;
      onStatus("error", problemDetail(problem));
      return;
    }
    onChange(data.contract, data.counterparties);
    // Only set "saved" if no refusal occurred.
    if (!hadRefusal.current) {
      onStatus("saved");
    }
  }

  function add(pick: CounterpartyPick) {
    void write(
      api.POST("/api/v1/contracts/{number}/counterparties", {
        params: { path: { number: contractNumber } },
        body: pick,
      }),
    );
  }

  async function remove(party: ContractCounterparty) {
    await write(
      api.DELETE("/api/v1/contracts/{number}/counterparties/{counterpartyId}", {
        params: { path: { number: contractNumber, counterpartyId: party.id } },
      }),
    );
    picker.current?.focus();
  }

  function makePrimary(party: ContractCounterparty) {
    void write(
      api.POST("/api/v1/contracts/{number}/counterparties/{counterpartyId}/primary", {
        params: { path: { number: contractNumber, counterpartyId: party.id } },
      }),
    );
  }

  return (
    <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="contract-counterparty">
          <FormattedMessage id="contracts.form.counterparties" defaultMessage="Counterparties" />
        </Label>
        <StatusNote status={status} detail={error} />
      </div>
      {parties.length > 0 && (
        <ul
          aria-label={intl.formatMessage({
            id: "contracts.counterparties.list",
            defaultMessage: "Counterparties",
          })}
          className="flex flex-col rounded-button border border-border-default"
        >
          {parties.map((party) => (
            <li
              key={party.id}
              className="flex h-9 items-center gap-2 border-b border-border-default px-2.5 last:border-b-0"
            >
              <span className="truncate text-base">{party.name}</span>
              {/* The disambiguator: two organizations do share a name. */}
              {party.jurisdiction && (
                <span className="shrink-0 text-xs text-muted">{party.jurisdiction}</span>
              )}
              {party.isPrimary && (
                <span className="inline-flex shrink-0 rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
                  <FormattedMessage id="contracts.counterparty.primary" defaultMessage="Primary" />
                </span>
              )}
              <span className="ms-auto flex shrink-0 items-center gap-1">
                {/* There is no control to un-name a primary: the flag
                    moves to another party or it stays (CTR-011). */}
                {!party.isPrimary && !frozen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => makePrimary(party)}
                  >
                    <FormattedMessage
                      id="contracts.counterparty.makePrimary"
                      defaultMessage="Make primary"
                    />
                  </Button>
                )}
                {!frozen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={intl.formatMessage(
                      {
                        id: "contracts.counterparty.remove",
                        defaultMessage: "Take {name} off the contract",
                      },
                      { name: party.name },
                    )}
                    onClick={() => void remove(party)}
                  >
                    <X size={16} aria-hidden="true" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {parties.length === 0 && (
        <p className="text-base text-muted">
          <FormattedMessage
            id="contracts.counterparty.empty"
            defaultMessage="Nobody is recorded on the other side yet."
          />
        </p>
      )}
      {/* Only a frozen record freezes the picker — archived, or read by
          someone who does not edit it. A write in flight must not take
          the focus and the half-typed name with it; `write` refuses a
          second one on its own. */}
      <CounterpartyPicker
        id="contract-counterparty"
        ref={picker}
        disabled={frozen}
        exclude={parties.map((party) => party.id)}
        onPick={add}
      />
      {/* The C10 mock's own line, put in the imperative DES-015 asks
          for and kept where the affordance now lives. */}
      <p className="text-xs text-muted">
        <FormattedMessage
          id="contracts.counterparty.hint"
          defaultMessage="Type an unknown name to create it. Add its details later."
        />
      </p>
    </div>
  );
}

/**
 * The currency picker's rows, composed once per locale and kept. There
 * are some three hundred ISO 4217 codes, and each row's label is an
 * ICU message — composing them per render, or even per mount, is three
 * hundred formats for a list that cannot change while the page is
 * open. The cache is keyed on the locale, which is what the labels
 * depend on.
 */
const currencyRowCache = new Map<string, readonly { code: string; label: string }[]>();

function currencyRows(intl: IntlShape): readonly { code: string; label: string }[] {
  let rows = currencyRowCache.get(intl.locale);
  if (!rows) {
    rows = currencyOptions({ locale: intl.locale }).map((currency) => ({
      code: currency.code,
      // The code leads: it is what a contract quotes, and it is what
      // tells two "dollar" currencies apart.
      label: intl.formatMessage(
        { id: "contracts.value.currencyOption", defaultMessage: "{code} — {name}" },
        { code: currency.code, name: currency.displayName },
      ),
    }));
    currencyRowCache.set(intl.locale, rows);
  }
  return rows;
}

/**
 * The rows as the picker's options. Memoized away from the field that
 * hosts them, so a keystroke in the amount box reconciles three
 * controls rather than three hundred options that cannot have changed.
 */
const CurrencyOptions = memo(function CurrencyOptions() {
  const intl = useIntl();
  return (
    <>
      {currencyRows(intl).map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.label}
        </option>
      ))}
    </>
  );
});

/** What the three controls hold between commits. The amount is a
 * string, in major units, because that is what a person types and an
 * empty box is a state a number cannot hold. */
interface ValueDraft {
  amount: string;
  currency: string;
  cadence: ValueCadence;
}

/** The saved value as the controls show it, and as a string that
 * changes only when the value itself does — the seed the draft is reset
 * from when a commit lands. */
function valueDraft(value: ContractValue | null, locale: string): ValueDraft {
  return value === null
    ? { amount: "", currency: "", cadence: "one_time" }
    : {
        amount: String(toMajorUnits(value.amount, value.currency, { locale })),
        currency: value.currency,
        cadence: value.cadence,
      };
}

function valueSeed(value: ContractValue | null): string {
  return value === null ? "" : `${value.amount}:${value.currency}:${value.cadence}`;
}

/**
 * CTR-010's value: an amount, the ISO 4217 currency it is counted in,
 * and what it is per — three controls that are one field.
 *
 * DES-017 governs it, read as a group rather than as three scalars.
 * Moving between the three controls is moving inside one field, so it
 * commits when focus leaves the group, not when it leaves a control;
 * Enter commits from any of the three; Escape reverts all three, since
 * a half-reverted value would be a value nobody chose. Emptying the
 * amount clears the whole field — no value recorded is the state every
 * contract starts in, and an NDA stays in.
 *
 * The amount is typed in major units and stored in the currency's
 * smallest unit, so the currency decides the conversion; changing it
 * re-scales what is typed at commit time rather than rewriting the box
 * under the person filling it in.
 */
function ValueField({
  value,
  frozen,
  status,
  error,
  onStatus,
  onCommit,
}: Readonly<{
  value: ContractValue | null;
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  status: FieldStatus;
  error: string | undefined;
  onStatus: (status: FieldStatus, detail?: string) => void;
  onCommit: (value: ContractValue | null) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<ValueDraft>(() => valueDraft(value, intl.locale));
  /** The value the draft was last seeded from. Comparing the content
   * rather than the object is what lets another field's commit answer
   * with a fresh row without discarding a half-typed amount here. */
  const [seed, setSeed] = useState(() => valueSeed(value));
  const seeded = valueSeed(value);
  if (seed !== seeded) {
    setSeed(seeded);
    setDraft(valueDraft(value, intl.locale));
  }

  /** A step of one smallest unit: cents for USD, whole yen for JPY. The
   * box refuses a precision the currency cannot hold. */
  const step =
    draft.currency === ""
      ? 0.01
      : 10 **
        -currencyFractionDigits(draft.currency, {
          locale: intl.locale,
        });

  function revert() {
    setDraft(valueDraft(value, intl.locale));
    onStatus("idle");
  }

  function commit() {
    // Enter already committed this draft and the PATCH is in flight —
    // the blur that follows must not send a duplicate.
    if (status === "saving") return;
    const typed = draft.amount.trim();

    if (typed === "") {
      // An empty amount is how the whole field is cleared. With nothing
      // recorded there is nothing to clear, so the group reverts —
      // a currency picked and then abandoned is not a value.
      if (value === null) {
        revert();
        return;
      }
      onCommit(null);
      return;
    }

    const major = Number(typed);
    if (!Number.isFinite(major) || major < 0) {
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.value.amountInvalid",
          defaultMessage: "Enter the amount as a number.",
        }),
      );
      return;
    }
    if (draft.currency === "") {
      // The seam refuses this too, and the database refuses it again.
      // Saying so here keeps a round trip out of a mistake the form can
      // see for itself — the same guard an empty title already gets.
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.value.currencyMissing",
          defaultMessage: "Pick a currency for the amount.",
        }),
      );
      return;
    }

    const next: ContractValue = {
      amount: toMinorUnits(major, draft.currency, { locale: intl.locale }),
      currency: draft.currency,
      cadence: draft.cadence,
    };
    if (
      value &&
      next.amount === value.amount &&
      next.currency === value.currency &&
      next.cadence === value.cadence
    ) {
      // Nothing changed: commit nothing (DES-017), and drop any
      // refusal the last attempt left standing.
      onStatus("idle");
      return;
    }
    onCommit(next);
  }

  return (
    <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
      <div className="flex items-center gap-2">
        <span id="contract-value-label" className="text-sm font-medium text-primary">
          <FormattedMessage id="contracts.form.value" defaultMessage="Value" />
        </span>
        <StatusNote status={status} detail={error} />
      </div>
      <div
        role="group"
        aria-labelledby="contract-value-label"
        className="flex flex-wrap items-center gap-2"
        // Focus moving between the three controls stays inside one
        // field, so only focus leaving the group commits it.
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // The record page is not a form; Enter here means commit.
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") revert();
        }}
      >
        <Input
          id="contract-value-amount"
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          className="w-40"
          disabled={frozen}
          aria-label={intl.formatMessage({
            id: "contracts.value.amount",
            defaultMessage: "Amount",
          })}
          value={draft.amount}
          onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
        />
        <select
          id="contract-value-currency"
          className={cn(CONTROL_CLASS, "w-56")}
          disabled={frozen}
          aria-label={intl.formatMessage({
            id: "contracts.value.currency",
            defaultMessage: "Currency",
          })}
          value={draft.currency}
          onChange={(event) =>
            setDraft((current) => ({ ...current, currency: event.target.value }))
          }
        >
          <option value="">
            {intl.formatMessage({
              id: "contracts.value.currencyPlaceholder",
              defaultMessage: "Currency…",
            })}
          </option>
          <CurrencyOptions />
        </select>
        <select
          id="contract-value-cadence"
          className={cn(CONTROL_CLASS, "w-40")}
          disabled={frozen}
          aria-label={intl.formatMessage({
            id: "contracts.value.cadence",
            defaultMessage: "Cadence",
          })}
          value={draft.cadence}
          onChange={(event) =>
            setDraft((current) => ({ ...current, cadence: event.target.value as ValueCadence }))
          }
        >
          {/* No empty option: an amount always says what it is per, and
              a one-off is a cadence, not the absence of one (CTR-010). */}
          {VALUE_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {cadenceLabel(intl, cadence)}
            </option>
          ))}
        </select>
      </div>
      {value ? (
        <>
          {/* What the record says it is worth, read back as DES-014
              renders it — the three controls hold the parts, this is
              the field. */}
          <p className="text-md">{formatContractValue(intl, value)}</p>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="contracts.value.hint"
              defaultMessage="Empty the amount to take the value off."
            />
          </p>
        </>
      ) : (
        <p className="text-base text-muted">
          <FormattedMessage
            id="contracts.value.empty"
            defaultMessage="No value is recorded. Many contracts have none."
          />
        </p>
      )}
    </div>
  );
}

/**
 * CTR-016's fields, as the C2 mock's Fields card draws them: one row per
 * attached field, the label on the left and the value on the right. The
 * mock draws each value as read-only text under a page-level Edit
 * toggle DES-017 removed, so the value cell holds the field's own
 * control instead — the same substitution the Contract card above makes.
 *
 * The order is the type's attachment order, given by the API. Nothing
 * here sorts, filters, or hides: a field the type attaches renders, and
 * a value under a slug it does not attach is held by the record and
 * drawn by nobody.
 */
function FieldsCard({
  fields,
  values,
  people,
  entities,
  frozen,
  status,
  error,
  onStatus,
  onCommit,
}: Readonly<{
  fields: readonly AttachedField[];
  values: CustomFieldValues;
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  status: Partial<Record<FieldKey, FieldStatus>>;
  error: Partial<Record<FieldKey, string | undefined>>;
  onStatus: (key: FieldKey, status: FieldStatus, detail?: string) => void;
  /** Fire and forget: the row reads the outcome from its own
   * micro-state, which `onStatus` has already been handed. */
  onCommit: (slug: string, value: CustomFieldValue | null) => void;
}>) {
  return (
    <section
      aria-labelledby="contract-fields-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id="contract-fields-heading" className="text-base font-semibold">
          <FormattedMessage id="contracts.fields.section" defaultMessage="Fields" />
        </h2>
      </header>
      {fields.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="contracts.fields.empty"
            defaultMessage="This contract type attaches no fields. Add them in contract settings."
          />
        </p>
      ) : (
        <div className="flex flex-col py-1">
          {fields.map((field) => (
            <CustomFieldRow
              // Keyed by slug, so re-typing to a type that attaches the
              // same field keeps that row's draft rather than reviving
              // the previous type's row in its place.
              key={field.slug}
              field={field}
              value={values[field.slug]}
              people={people}
              entities={entities}
              frozen={frozen}
              status={status[`field:${field.slug}`] ?? "idle"}
              error={error[`field:${field.slug}`]}
              onStatus={(next, detail) => onStatus(`field:${field.slug}`, next, detail)}
              onCommit={(value) => onCommit(field.slug, value)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One custom field, committed on its own (DES-017). Which gesture
 * commits it follows the split the record already draws: a pick is a
 * decision, so a toggle, a select, and a checkbox group commit the
 * moment they change; typing is a draft, so a text, number, or date box
 * commits on blur and on Enter, and Escape puts back what was saved.
 */
function CustomFieldRow({
  field,
  value,
  people,
  entities,
  frozen,
  status,
  error,
  onStatus,
  onCommit,
}: Readonly<{
  field: AttachedField;
  value: CustomFieldValue | undefined;
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  frozen: boolean;
  status: FieldStatus;
  error: string | undefined;
  onStatus: (status: FieldStatus, detail?: string) => void;
  onCommit: (value: CustomFieldValue | null) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<CustomFieldDraft>(() => toDraft(field, value));
  /** The value the draft was last seeded from, compared by content
   * rather than by object — that is what lets another field's commit
   * answer with a fresh row without discarding a half-typed entry here. */
  const [seed, setSeed] = useState(() => JSON.stringify(value ?? null));
  const seeded = JSON.stringify(value ?? null);
  if (seed !== seeded) {
    setSeed(seeded);
    setDraft(toDraft(field, value));
  }

  const controlId = `contract-field-${field.slug}`;
  const helpId = field.description ? `${controlId}-help` : undefined;
  const immediate = commitsOnChange(field);

  function revert() {
    setDraft(toDraft(field, value));
    onStatus("idle");
  }

  function commitDraft(next: CustomFieldDraft) {
    // Enter already committed this draft and the PATCH is in flight —
    // the blur that follows must not send a duplicate.
    if (status === "saving") return;
    if (sameDraft(next, toDraft(field, value))) {
      // Nothing changed: commit nothing (DES-017), and drop any refusal
      // the last attempt left standing.
      onStatus("idle");
      return;
    }
    const parsed = toValue(field, next);
    if ("error" in parsed) {
      onStatus(
        "error",
        intl.formatMessage({
          id: "contracts.field.numberInvalid",
          defaultMessage: "Enter this as a number.",
        }),
      );
      return;
    }
    onCommit(parsed.value);
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border-muted px-4 py-2.5 last:border-b-0 @2xl/page:flex-row @2xl/page:items-center @2xl/page:gap-4">
      <div className="flex shrink-0 flex-col gap-0.5 @2xl/page:w-55">
        {/* The id is what a checkbox group points at: `for` names one
            control, and a multi-select is several. */}
        <Label id={`${controlId}-label`} htmlFor={controlId}>
          {field.displayName}
          {field.isRequired && (
            <>
              {/* The C10 mock's required marker. The glyph is
                  decoration; the word beside it is what a reader who
                  cannot see the color gets. */}
              <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                *
              </span>
              <span className="sr-only">
                <FormattedMessage id="contracts.field.requiredMark" defaultMessage="(required)" />
              </span>
            </>
          )}
        </Label>
        {field.description && (
          <span id={helpId} className="text-xs text-muted">
            {field.description}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0 flex-1">
          <CustomFieldControl
            id={controlId}
            field={field}
            draft={draft}
            disabled={frozen}
            people={people}
            entities={entities}
            describedBy={helpId}
            onDraft={(next) => {
              setDraft(next);
              if (immediate) commitDraft(next);
            }}
            onBlur={immediate ? undefined : () => commitDraft(draft)}
            onKeyDown={(event) => {
              if (event.key === "Escape") revert();
              // A textarea's Enter is a newline, and the record page is
              // not a form, so only the single-line boxes take it as a
              // commit.
              if (event.key === "Enter" && !immediate && field.fieldType !== "long_text") {
                event.preventDefault();
                commitDraft(draft);
              }
            }}
          />
        </div>
        <StatusNote status={status} detail={error} />
      </div>
    </div>
  );
}

/**
 * CTR-012's soft gate, raised by the seam's refusal (#235).
 *
 * The record is on its way past the approval stage while somebody's
 * sign-off is still open. That is allowed — CTR-001 restricts no
 * transition and CTR-012 chose a warning over a lock, because in a
 * 2–10 person team the person holding the policy and the person
 * overriding it are often the same human. So this costs one deliberate
 * press, and the press is what the activity feed records.
 *
 * **It names the people, and says what each of them said.** "Approvals
 * are open" is not something anybody can act on; "Sarah Chen is
 * pending, Marcus Webb rejected" is. The state rides in the same
 * DES-005 pill the Approvals roster draws it in, so the dialog and the
 * section behind it say the same thing in the same colour.
 *
 * **It states nothing the seam did not say.** Whether the move crosses
 * the line, and whether anything is unresolved, is the seam's decision
 * and its refusal is what opened this — the same one-rule-one-place
 * shape the apply dialog takes (DES-035 clause 16). What is drawn here
 * is the record's own roster, filtered to the asks an approval has not
 * answered.
 */
function SoftGateDialog({
  target,
  unresolved,
  onOpenChange,
  onConfirm,
}: Readonly<{
  target: ContractStatusOption;
  unresolved: readonly ContractApproval[];
  onOpenChange: (open: boolean) => void;
  /** Answers `undefined` when the override landed, and the seam's own
   * refusal — or an empty string when it gave none — when it did not. */
  onConfirm: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const refusal = await onConfirm().finally(() => setBusy(false));
    if (refusal !== undefined) {
      setError(
        refusal ||
          intl.formatMessage({
            id: "contracts.softGate.error",
            defaultMessage: "The status could not be changed.",
          }),
      );
    }
  }

  /** A dismissal is ignored while the override is in flight: the
   * commit either lands or is refused, and a dialog that vanished
   * mid-write would leave the reader with neither answer. */
  function close(open: boolean) {
    if (!open && busy) return;
    onOpenChange(open);
  }

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent aria-describedby="contract-soft-gate-note">
        <DialogTitle>
          <FormattedMessage id="contracts.softGate.title" defaultMessage="Move past approval" />
        </DialogTitle>
        <p id="contract-soft-gate-note" className="mt-2 text-base text-muted">
          <FormattedMessage
            id="contracts.softGate.note"
            defaultMessage="{count, plural, one {# approval on this contract is unresolved.} other {# approvals on this contract are unresolved.}} Moving to {status} goes past sign-off."
            values={{ count: unresolved.length, status: target.displayName }}
          />
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {unresolved.map((approval) => (
            <li key={approval.id} className="flex items-center gap-2">
              <Avatar
                name={approval.approver.displayName}
                image={approval.approver.image}
                className="size-6"
              />
              <span className="text-base text-primary">{approval.approver.displayName}</span>
              <span
                className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${APPROVAL_PILL[approval.status]}`}
              >
                {approval.status === "rejected" ? (
                  <FormattedMessage id="approvals.status.rejected" defaultMessage="Rejected" />
                ) : (
                  <FormattedMessage id="approvals.status.pending" defaultMessage="Pending" />
                )}
              </span>
            </li>
          ))}
        </ul>
        {/* The C5 mock's soft-gate note row, said where the act is taken
        rather than under the roster (DES-035 clauses 17 and 18). */}
        <p className="mt-4 text-xs text-muted">
          <FormattedMessage
            id="contracts.softGate.override"
            defaultMessage="This is allowed. It is recorded on the record's activity as an override."
          />
        </p>
        {error && (
          <p role="alert" className="mt-4 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => close(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            <FormattedMessage id="contracts.softGate.submit" defaultMessage="Move anyway" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Re-typing onto a type that demands something the record does not
 * answer (MTR-014). The record cannot fill those fields inline — they
 * belong to a type it does not hold yet — so this collects them and
 * commits the type and the values as one write. It is the compound edit
 * DES-017 carves out of the inline rule, with its own explicit confirm.
 */
function RetypeDialog({
  target,
  values,
  people,
  entities,
  onOpenChange,
  onConfirm,
}: Readonly<{
  target: ContractTypeOption;
  values: CustomFieldValues;
  people: readonly FieldReference[];
  entities: readonly FieldReference[];
  onOpenChange: (open: boolean) => void;
  /** Answers `undefined` when the re-type landed, and the seam's own
   * refusal — or an empty string when it gave none — when it did not. */
  onConfirm: (customFields: Record<string, CustomFieldValue | null>) => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const gaps = unansweredRequired(target.fields, values);
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>(() =>
    Object.fromEntries(gaps.map((field) => [field.slug, toDraft(field, values[field.slug])])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    const collected: Record<string, CustomFieldValue | null> = {};
    for (const field of gaps) {
      const parsed = toValue(field, drafts[field.slug] ?? "");
      if ("error" in parsed) {
        setError(
          intl.formatMessage({
            id: "contracts.field.numberInvalid",
            defaultMessage: "Enter this as a number.",
          }),
        );
        return;
      }
      if (parsed.value === null) {
        setError(
          intl.formatMessage(
            {
              id: "contracts.retype.missing",
              defaultMessage: "Fill {field} — the new type requires it.",
            },
            { field: field.displayName },
          ),
        );
        return;
      }
      collected[field.slug] = parsed.value;
    }
    setBusy(true);
    const refusal = await onConfirm(collected).finally(() => setBusy(false));
    if (refusal !== undefined) {
      setError(
        refusal ||
          intl.formatMessage({
            id: "contracts.retype.error",
            defaultMessage: "The contract type could not be changed.",
          }),
      );
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="contract-retype-note">
        <DialogTitle>
          <FormattedMessage id="contracts.retype.title" defaultMessage="Change contract type" />
        </DialogTitle>
        <p id="contract-retype-note" className="mt-2 text-base text-muted">
          <FormattedMessage
            id="contracts.retype.note"
            defaultMessage="{type} requires these fields. Fill them to change the type."
            values={{ type: target.displayName }}
          />
        </p>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {gaps.map((field) => (
            <div key={field.slug} className="flex flex-col gap-1.5">
              <Label
                id={`contract-retype-${field.slug}-label`}
                htmlFor={`contract-retype-${field.slug}`}
              >
                {field.displayName}
              </Label>
              <CustomFieldControl
                id={`contract-retype-${field.slug}`}
                field={field}
                draft={drafts[field.slug] ?? ""}
                people={people}
                entities={entities}
                describedBy={field.description ? `contract-retype-${field.slug}-help` : undefined}
                onDraft={(next) => setDrafts((current) => ({ ...current, [field.slug]: next }))}
              />
              {field.description && (
                <p id={`contract-retype-${field.slug}-help`} className="text-xs text-muted">
                  {field.description}
                </p>
              )}
            </div>
          ))}
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="contracts.retype.submit" defaultMessage="Change type" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A stated fact rather than an editable field: the reference is
 * immutable (CTR-003), so it is the one thing on the record no control
 * answers for. */
/**
 * One of the term's four typed fields (CTR-006): a calendar date or a
 * count of months or days.
 *
 * It is an ordinary inline field and nothing more — DES-017's rule with
 * no carve-out. Blur and Enter commit, Escape reverts, and the field's
 * own micro-state sits beside the box. The rule *between* the term
 * fields is the card's to apply, not this one's: what this draws is
 * whatever it was handed, and the card decides whether the contract's
 * type lets it be drawn at all.
 */
function TermField({
  id,
  type,
  min,
  label,
  draft,
  frozen,
  status,
  error,
  onDraft,
  onCommit,
  onRevert,
}: Readonly<{
  id: string;
  type: "date" | "number";
  /** The floor a count may not go under, as the seam bounds it: a roll
   * is at least one month, a notice period at least zero days. Unused
   * on a date. */
  min?: number;
  label: React.ReactNode;
  draft: string;
  frozen: boolean;
  status: FieldStatus;
  error: string | undefined;
  onDraft: (next: string) => void;
  onCommit: () => void;
  onRevert: () => void;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type={type}
          // A count of months or days is a whole number, and the
          // keypad a phone offers should say so.
          {...(type === "number" ? { inputMode: "numeric" as const, min, step: 1 } : {})}
          value={draft}
          disabled={frozen}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit();
            if (event.key === "Escape") onRevert();
          }}
        />
        <StatusNote status={status} detail={error} />
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: Readonly<{ label: React.ReactNode; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-secondary">{label}</span>
      <p className="flex h-8 items-center text-md">{value}</p>
    </div>
  );
}
