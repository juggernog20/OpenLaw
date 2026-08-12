// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record page (M8), at the CTR-003 number-based address
 * `/contracts/42`: the breadcrumb sub-bar carrying the reference, the
 * title, and the status pill, then the Contract card with the fields
 * the record holds and, beside it, the Team card the C2 mock draws in
 * the record's side column. Every field edits in place and commits
 * individually per DES-017 — no page edit mode, no dirty state, no
 * Save chrome — with the Owner, status, priority, and risk as selects.
 * The type is shown but not edited here: re-typing re-checks the type's
 * required fields, which lands with the custom-field work.
 *
 * The people are CTR-004's: one Owner (`manager_id`, labelled "Owner",
 * name only) who may be left unassigned, and the working group in the
 * Team card. Adding a person names two things at once — who and in
 * which role — so it takes a dialog, which is the compound-edit case
 * DES-017 carves out of the inline rule.
 *
 * This is the first production mount of the DES-016 record activity
 * bar. Its applet set is limited to what exists before M9: chat
 * (CMT-004) and history (DD-017) have no panels yet, so only the
 * settings deep-link slot is offered.
 *
 * Archive (soft delete — for mistakes and imports, not for ending a
 * contract) and restore live in the sub-bar; an archived record reads
 * as facts until restored. The loader is the client half of the Member+
 * gate; the API's 403 is the real refusal.
 */

import { useRef, useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { Archive, ArchiveRestore, ChevronRight, FileText, Plus, Settings, X } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  ADDABLE_TEAM_ROLES,
  contractReference,
  riskLabel,
  severityLabel,
  SEVERITY_LEVELS,
  STAGE_PILL,
  teamRoleLabel,
  type ContractRow,
  type ContractStatusOption,
  type ContractTeamMember,
  type ContractTeamRole,
  type SeverityLevel,
  type UserOption,
} from "../lib/contracts";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problemDetail } from "../lib/messages";
import { isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { RecordApplets } from "../components/shell/record-applets";
import type { Applet } from "../components/shell/applets";
import { Avatar } from "../components/avatar";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function contractRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // Member+ only: Contributors and Business Users get no surface at
  // all. The API's 403 stands behind this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const number = Number(params.contractNumber);
  if (!Number.isInteger(number) || number < 1) throw new Error("That is not a contract reference.");
  const [record, options] = await Promise.all([
    api.GET("/api/v1/contracts/{number}", { params: { path: { number } } }),
    api.GET("/api/v1/contracts/options"),
  ]);
  if (!record.data || !options.data) throw new Error("The contract could not be read.");
  return {
    user,
    contract: record.data.contract,
    team: record.data.team,
    contractStatuses: options.data.contractStatuses,
    users: options.data.users,
  };
}

/** The fields that commit as free text (DES-017); the Owner, status,
 * priority, and risk have their own selects. */
type TextFieldKey = "title" | "description";
type FieldKey = TextFieldKey | "managerId" | "statusId" | "priority" | "risk";

/** The one applet the record offers before M9 — SET-001's deep link to
 * the contract configuration behind this record. */
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
  const { user, contract, team, contractStatuses, users } =
    useLoaderData<typeof contractRecordLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  /** The saved record — the server's truth after the last commit. */
  const [saved, setSaved] = useState<ContractRow>(contract);
  const [roster, setRoster] = useState<ContractTeamMember[]>(team);
  const [drafts, setDrafts] = useState<Record<TextFieldKey, string>>(() => textDrafts(contract));
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<FieldKey, FieldStatus>>>({});
  const [fieldError, setFieldError] = useState<Partial<Record<FieldKey, string | undefined>>>({});
  const [archiveStatus, setArchiveStatus] = useState<FieldStatus>("idle");
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined);

  const archived = saved.archivedAt !== null;

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
   * discard. */
  async function commit(key: FieldKey, body: Record<string, unknown>) {
    note(key, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/contracts/{number}", {
        params: { path: { number: saved.number } },
        body,
      })
      .catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      const row = data.contract;
      setSaved(row);
      if (key === "title" || key === "description") {
        setDrafts((current) => ({ ...current, [key]: textDrafts(row)[key] }));
      }
      note(key, "saved");
    } else {
      note(key, "error", problemDetail(error));
    }
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
      <RecordApplets applets={[SETTINGS_APPLET]}>
        <div className="flex flex-col gap-4 overflow-y-auto px-page-x py-page-y">
          {archived && (
            <p className="rounded-card bg-status-warning-bg px-3 py-2 text-md text-status-warning-fg">
              <FormattedMessage
                id="contracts.record.archivedNote"
                defaultMessage="This contract is archived — it is out of the contract list. Restore it to edit."
              />
            </p>
          )}
          {/* The C2 body: the record's own fields, with the people
              column beside them. Below the container threshold the two
              stack, so the roster follows the record (DES-012). */}
          <div className="flex flex-col items-start gap-4 @4xl/page:flex-row">
            <section className="w-full min-w-0 flex-1 overflow-hidden rounded-card border border-border-default bg-raised">
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
                        disabled={archived}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, title: event.target.value }))
                        }
                        onBlur={() => commitText("title")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitText("title");
                          if (event.key === "Escape") revertText("title");
                        }}
                      />
                      <StatusNote status={fieldStatus.title ?? "idle"} detail={fieldError.title} />
                    </div>
                  </div>
                </div>
                <ReadOnlyField
                  label={
                    <FormattedMessage id="contracts.column.reference" defaultMessage="Reference" />
                  }
                  value={reference}
                />
                <ReadOnlyField
                  label={
                    <FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />
                  }
                  value={saved.contractTypeName}
                />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contract-owner">
                    <FormattedMessage id="contracts.form.owner" defaultMessage="Owner" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <select
                      id="contract-owner"
                      value={saved.manager?.id ?? ""}
                      className={CONTROL_CLASS}
                      disabled={archived}
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
                  <Label htmlFor="contract-status">
                    <FormattedMessage id="contracts.form.status" defaultMessage="Status" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <select
                      id="contract-status"
                      value={saved.statusId}
                      className={CONTROL_CLASS}
                      disabled={archived}
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
                      disabled={archived}
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
                      disabled={archived}
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
                <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
                  <Label htmlFor="contract-description">
                    <FormattedMessage
                      id="contracts.form.description"
                      defaultMessage="Description"
                    />
                  </Label>
                  <div className="flex items-start gap-2">
                    <textarea
                      id="contract-description"
                      value={drafts.description}
                      className={TEXTAREA_CLASS}
                      disabled={archived}
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
                </div>
              </div>
            </section>
            <TeamCard
              contractNumber={saved.number}
              owner={saved.manager}
              roster={roster}
              users={users}
              frozen={archived}
              onRoster={setRoster}
            />
          </div>
        </div>
      </RecordApplets>
    </AppShell>
  );
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
  /** The record is archived: it reads as facts until it is restored. */
  frozen: boolean;
  onRoster: (team: ContractTeamMember[]) => void;
}>) {
  const intl = useIntl();
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A removal unmounts the row that held focus, so focus has to be put
   * somewhere deliberate — the card's own add control (DES-010's
   * return-focus rule, applied to a destructive row action). */
  const addControl = useRef<HTMLButtonElement>(null);

  async function remove(member: ContractTeamMember) {
    if (busy) return;
    setError(null);
    setBusy(true);
    const { data, error: problem } = await api
      .DELETE("/api/v1/contracts/{number}/team/{userId}/{role}", {
        params: { path: { number: contractNumber, userId: member.id, role: member.role } },
      })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => setBusy(false));
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
      aria-labelledby="contract-team-heading"
      className="w-full shrink-0 overflow-hidden rounded-card border border-border-default bg-raised @4xl/page:w-80"
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

/** A stated fact rather than an editable field: the reference is
 * immutable (CTR-003), and the type moves with the custom-field work. */
function ReadOnlyField({ label, value }: Readonly<{ label: React.ReactNode; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-secondary">{label}</span>
      <p className="flex h-8 items-center text-md">{value}</p>
    </div>
  );
}
