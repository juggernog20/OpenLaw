// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record page (M8/1), at the CTR-003 number-based address
 * `/contracts/42`: the breadcrumb sub-bar carrying the reference, the
 * title, and the status pill, then the Contract card with the fields
 * the record core holds. Every field edits in place and commits
 * individually per DES-017 — no page edit mode, no dirty state, no
 * Save chrome — with the status, priority, and risk as selects. The
 * type is shown but not edited here: re-typing re-checks the type's
 * required fields, which lands with the custom-field work.
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

import { useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import { Archive, ArchiveRestore, ChevronRight, FileText, Settings } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  contractReference,
  riskLabel,
  severityLabel,
  SEVERITY_LEVELS,
  STAGE_PILL,
  type ContractRow,
  type ContractStatusOption,
  type SeverityLevel,
} from "../lib/contracts";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problemDetail } from "../lib/messages";
import { isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { RecordApplets } from "../components/shell/record-applets";
import type { Applet } from "../components/shell/applets";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
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
    contractStatuses: options.data.contractStatuses,
  };
}

/** The fields that commit as free text (DES-017); the status, priority,
 * and risk have their own selects. */
type TextFieldKey = "title" | "description";
type FieldKey = TextFieldKey | "statusId" | "priority" | "risk";

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
  const { user, contract, contractStatuses } = useLoaderData<typeof contractRecordLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  /** The saved record — the server's truth after the last commit. */
  const [saved, setSaved] = useState<ContractRow>(contract);
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
          <section className="overflow-hidden rounded-card border border-border-default bg-raised">
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
                label={<FormattedMessage id="contracts.form.type" defaultMessage="Contract type" />}
                value={saved.contractTypeName}
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
                    disabled={archived}
                    onChange={(event) => void commit("statusId", { statusId: event.target.value })}
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
                          event.target.value === "" ? null : (event.target.value as SeverityLevel),
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
                  <FormattedMessage id="contracts.form.description" defaultMessage="Description" />
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
        </div>
      </RecordApplets>
    </AppShell>
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
