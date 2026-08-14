// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record page (M8), at the CTR-003 number-based address
 * `/contracts/42`: the breadcrumb sub-bar carrying the reference, the
 * title, and the status pill, then the Contract card with the fields
 * the record holds, the Description card under it, and the Team card
 * the C2 mock draws in the record's side column. Every field edits in
 * place and commits individually per DES-017 — no page edit mode, no
 * dirty state, no Save chrome — with the Owner, the type, status,
 * priority, and risk as selects.
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

import { memo, useMemo, useRef, useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, defineMessage, useIntl, type IntlShape } from "react-intl";
import { Archive, ArchiveRestore, ChevronRight, FileText, Plus, Settings, X } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  ADDABLE_TEAM_ROLES,
  cadenceLabel,
  contractReference,
  type ContractCounterparty,
  type ContractValue,
  formatContractValue,
  riskLabel,
  severityLabel,
  SEVERITY_LEVELS,
  signingEntityOptions,
  STAGE_PILL,
  teamRoleLabel,
  VALUE_CADENCES,
  type ContractRow,
  type ContractStatusOption,
  type ContractTeamMember,
  type ContractTeamRole,
  type ContractTypeOption,
  type SeverityLevel,
  type ValueCadence,
  type UserOption,
} from "../lib/contracts";
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
import { currencyFractionDigits, currencyOptions, toMajorUnits, toMinorUnits } from "../lib/format";
import type { ContractDocument } from "../lib/documents";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problemDetail } from "../lib/messages";
import { cn } from "../lib/utils";
import { canReadContracts, isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { useActivityApplet } from "../components/activity/activity-applet";
import { useCommentApplet } from "../components/comments/comment-applet";
import { RecordApplets } from "../components/shell/record-applets";
import type { Applet } from "../components/shell/applets";
import { Avatar } from "../components/avatar";
import { ConfidentialBanner } from "../components/confidential-banner";
import { ConfidentialToggle } from "../components/confidential-toggle";
import { CounterpartyPicker, type CounterpartyPick } from "../components/counterparty-picker";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import { DocumentsCard } from "../components/documents/documents-card";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function contractRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // A Business User gets no surface at all. The API's 403 stands
  // behind this.
  if (!canReadContracts(user.role)) return redirect("/");
  const number = Number(params.contractNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error("That is not a contract reference.");
  // The pickers exist to commit from, so a read-only viewer reads
  // none of them. Both seams are Member+ and would refuse a
  // Contributor anyway; the record read alone carries every name the
  // page has to draw.
  const canEdit = isMemberPlus(user.role);
  const [record, documents, options, registry] = await Promise.all([
    api.GET("/api/v1/contracts/{number}", { params: { path: { number } } }),
    // The record's paper (M11/2). Read by every viewer who reaches the
    // page — a Contributor on the team reads and downloads it too
    // (DD-015) — and answered 404 for anyone the record itself is
    // hidden from, which is the same refusal the record read gives.
    api.GET("/api/v1/contracts/{number}/documents", { params: { path: { number } } }),
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
  if (!record.data || !documents.data || (canEdit && !(options?.data && registry?.data))) {
    throw new Error("The contract could not be read.");
  }
  return {
    user,
    canEdit,
    contract: record.data.contract,
    documents: documents.data.documents,
    fields: record.data.fields,
    customFieldRefs: record.data.customFieldRefs,
    team: record.data.team,
    counterparties: record.data.counterparties,
    contractTypes: options?.data?.contractTypes ?? [],
    contractStatuses: options?.data?.contractStatuses ?? [],
    users: options?.data?.users ?? [],
    entities: registry?.data?.entities ?? [],
  };
}

/** The fields that commit as free text (DES-017); the Owner, our
 * signing entity, the type, the status, priority, and risk have their
 * own selects, and the counterparties have their own routes. */
type TextFieldKey = "title" | "description";
/** One custom field's key, namespaced by slug so a catalog field named
 * "Title" and the record's own title are never one micro-state. */
type CustomFieldKey = `field:${string}`;
/** What one committed field answers with: nothing more when it landed,
 * and the seam's own refusal when it did not. */
type CommitOutcome = { ok: true } | { ok: false; detail?: string };
type FieldKey =
  | TextFieldKey
  | CustomFieldKey
  | "managerId"
  | "entityId"
  | "counterparties"
  | "contractTypeId"
  | "statusId"
  | "priority"
  | "risk"
  | "value"
  | "isConfidential";

/** The Team card's anchor. Two places name it: the card itself, and
 * the confidentiality banner's "Manage team" link, which is a fragment
 * to it — one constant, so the link cannot point at nothing. */
const TEAM_CARD_ID = "contract-team";

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
  const {
    user,
    canEdit,
    contract,
    documents: contractDocuments,
    fields,
    customFieldRefs,
    team,
    counterparties,
    contractTypes,
    contractStatuses,
    users,
    entities,
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
  const [roster, setRoster] = useState<ContractTeamMember[]>(team);
  /** The record's paper (M11/2, M11/3). State rather than loader data
   * because an upload, an appended version, and a metadata edit each
   * change it without a page re-read. */
  const [paper, setPaper] = useState<ContractDocument[]>(contractDocuments);
  /** The other side (CTR-011), primary first as the API orders it. */
  const [parties, setParties] = useState<ContractCounterparty[]>(counterparties);
  const [drafts, setDrafts] = useState<Record<TextFieldKey, string>>(() => textDrafts(contract));
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

  function textDrafts(row: ContractRow): Record<TextFieldKey, string> {
    return { title: row.title, description: row.description ?? "" };
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
      return { ok: false, detail };
    }
    const row = data.contract;
    setSaved(row);
    setAttached(data.fields);
    setRefs(data.customFieldRefs);
    if (key === "title" || key === "description") {
      setDrafts((current) => ({ ...current, [key]: textDrafts(row)[key] }));
    }
    note(key, "saved");
    return { ok: true };
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
        saved.isConfidential ? (
          <ConfidentialBanner manageTeamHref={canFlag ? `#${TEAM_CARD_ID}` : undefined} />
        ) : undefined
      }
      subbar={
        <section
          aria-labelledby="page-title"
          className="flex h-(--height-subbar) shrink-0 items-center justify-between gap-4 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/contracts"
              className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
            >
              <FormattedMessage id="contracts.title" defaultMessage="Contracts" />
            </Link>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
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
          </div>
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
              stack, so the roster follows the record (DES-012). */}
          <div className="flex flex-col items-start gap-4 @4xl/page:flex-row">
            <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
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
                        <FormattedMessage id="contracts.form.titleField" defaultMessage="Title" />
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
                      <FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />
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
                      <FormattedMessage id="contracts.form.entity" defaultMessage="Our entity" />
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
                      <select
                        id="contract-status"
                        value={saved.statusId}
                        className={CONTROL_CLASS}
                        disabled={frozen}
                        onChange={(event) =>
                          void commit("statusId", { statusId: event.target.value })
                        }
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
                      <FormattedMessage id="contracts.form.priority" defaultMessage="Priority" />
                    </Label>
                    <div className="flex items-center gap-2">
                      <select
                        id="contract-priority"
                        value={saved.priority}
                        className={CONTROL_CLASS}
                        disabled={frozen}
                        onChange={(event) =>
                          void commit("priority", { priority: event.target.value as SeverityLevel })
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
                      <StatusNote status={fieldStatus.risk ?? "idle"} detail={fieldError.risk} />
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
                      onChange={(next) => void commit("isConfidential", { isConfidential: next })}
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
              {/* CTR-016's fields, in the card the C2 mock draws for
                  them and in the order the type's attachment join
                  gives. It follows the Description card because the
                  mock puts it after — the record's own columns first,
                  then the account of them, then what this type asks
                  for on top. */}
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
              {/* The record's paper (M11/2, M11/3), in the section the C4 mock
                  draws. It follows the fields because the mock puts the
                  documents behind their own tab, after everything the
                  record itself states — and this page is one scroll,
                  not a tab strip. The full document panel DES-016
                  places in a wider sibling layer lands with M12's
                  rendering; this is the record-body section. */}
              <DocumentsCard
                contractNumber={saved.number}
                documents={paper}
                frozen={frozen}
                onDocuments={setPaper}
              />
            </div>
            <TeamCard
              contractNumber={saved.number}
              owner={saved.manager}
              roster={roster}
              users={users}
              frozen={frozen}
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
      // A fragment link scrolls the card under the sticky chrome
      // without this; the shell's own strips are what it clears.
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
          disabled={frozen}
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
}: Readonly<{
  name: string;
  image: string | null;
  archived: boolean;
  role: string;
  onRemove?: () => void;
  removeLabel?: string;
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
function ReadOnlyField({ label, value }: Readonly<{ label: React.ReactNode; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-secondary">{label}</span>
      <p className="flex h-8 items-center text-md">{value}</p>
    </div>
  );
}
