// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The entity record page (ENT-001/ENT-004, #99), per the EN5 frame of
 * entities.pen reduced to the M7 registry subset: the breadcrumb
 * sub-bar with the legal name and status pill, and the Registry card
 * carrying the full identity card. Every field edits in place and
 * commits individually per DES-017 — no page edit mode, so EN5's Edit
 * chrome is not built — with the status and type as selects over the
 * fixed enum and the ENT-008 picker read. Archive (soft delete — a
 * data mistake, distinct from the dissolved status, which is corporate
 * reality) and restore live in the sub-bar; an archived record reads
 * as facts until restored. The M27 surfaces the mock also draws (tabs,
 * officers, registrations, the rail) are not built. The loader is the
 * client half of ENT-004's gate — Member+ only; the API's 403 is the
 * real refusal.
 */

import { useState, type ReactNode } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Archive, ArchiveRestore, Building2, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  ENTITY_STATUSES,
  STATUS_PILL,
  statusLabel,
  type EntityRow,
  type EntityStatus,
  type EntityTypeOption,
} from "../lib/entities";
import { problemDetail } from "../lib/messages";
import { isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function entityRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // ENT-004: Contributors and Business Users get nothing — not a
  // disabled surface, no surface. The API's 403 stands behind this.
  if (!isMemberPlus(user.role)) return redirect("/");
  const id = params.entityId!;
  const [record, types] = await Promise.all([
    api.GET("/api/v1/entities/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/entities/types"),
  ]);
  if (!record.data || !types.data) throw new Error("The entity could not be read.");
  return { user, entity: record.data.entity, entityTypes: types.data.entityTypes };
}

/** The identity-card fields that commit as free text (DES-017); the
 * type, status, and formed-on date have their own controls. */
type TextFieldKey =
  | "legalName"
  | "jurisdiction"
  | "registrationNumber"
  | "taxId"
  | "registeredAgent"
  | "registeredAddress";

type FieldKey = TextFieldKey | "entityTypeId" | "status" | "formedOn";

/** The shared form-control look (ST8 normalization, C10 field spec). */
const CONTROL_CLASS =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-button border border-border-default bg-raised p-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function EntityRecordPage() {
  const { user, entity, entityTypes } = useLoaderData<typeof entityRecordLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  /** The saved record — the server's truth after the last commit. */
  const [saved, setSaved] = useState<EntityRow>(entity as EntityRow);
  const [drafts, setDrafts] = useState<Record<TextFieldKey, string>>(() => textDrafts(entity as EntityRow));
  const [formedOnDraft, setFormedOnDraft] = useState((entity as EntityRow).formedOn ?? "");
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<FieldKey, FieldStatus>>>({});
  const [fieldError, setFieldError] = useState<Partial<Record<FieldKey, string | undefined>>>({});
  const [archiveStatus, setArchiveStatus] = useState<FieldStatus>("idle");
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined);

  const archived = saved.archivedAt !== null;

  function textDrafts(row: EntityRow): Record<TextFieldKey, string> {
    return {
      legalName: row.legalName,
      jurisdiction: row.jurisdiction ?? "",
      registrationNumber: row.registrationNumber ?? "",
      taxId: row.taxId ?? "",
      registeredAgent: row.registeredAgent ?? "",
      registeredAddress: row.registeredAddress ?? "",
    };
  }

  function note(key: FieldKey, status: FieldStatus, detail?: string) {
    setFieldStatus((current) => ({ ...current, [key]: status }));
    setFieldError((current) => ({ ...current, [key]: detail }));
  }

  /** One PATCH per committed field (DES-017): success adopts the
   * server's row wholesale, so every draft resets to saved truth. */
  async function commit(key: FieldKey, body: Record<string, unknown>) {
    note(key, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/entities/{id}", { params: { path: { id: saved.id } }, body })
      .catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      const row = data.entity as EntityRow;
      setSaved(row);
      setDrafts(textDrafts(row));
      setFormedOnDraft(row.formedOn ?? "");
      note(key, "saved");
    } else {
      note(key, "error", problemDetail(error));
    }
  }

  function commitText(key: TextFieldKey) {
    const draft = drafts[key].trim();
    const savedValue = key === "legalName" ? saved.legalName : (saved[key] ?? "");
    if (draft === savedValue || (key === "legalName" && draft === "")) {
      // Nothing to save (or nothing valid): revert per DES-017.
      setDrafts((current) => ({ ...current, [key]: savedValue }));
      return;
    }
    void commit(key, { [key]: key === "legalName" ? draft : draft || null });
  }

  function revertText(key: TextFieldKey) {
    setDrafts((current) => ({
      ...current,
      [key]: key === "legalName" ? saved.legalName : (saved[key] ?? ""),
    }));
  }

  function commitFormedOn() {
    const draft = formedOnDraft;
    if (draft === (saved.formedOn ?? "")) return;
    void commit("formedOn", { formedOn: draft || null });
  }

  async function archiveOrRestore() {
    setArchiveStatus("saving");
    setArchiveError(undefined);
    const { data, error } = await (archived
      ? api.POST("/api/v1/entities/{id}/restore", { params: { path: { id: saved.id } } })
      : api.POST("/api/v1/entities/{id}/archive", { params: { path: { id: saved.id } } })
    ).catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      const row = data.entity as EntityRow;
      setSaved(row);
      setDrafts(textDrafts(row));
      setFormedOnDraft(row.formedOn ?? "");
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

  const textField = (key: TextFieldKey, controlId: string, label: ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={controlId}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={controlId}
          value={drafts[key]}
          disabled={archived}
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [key]: event.target.value }))
          }
          onBlur={() => commitText(key)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitText(key);
            if (event.key === "Escape") revertText(key);
          }}
        />
        <StatusNote status={fieldStatus[key] ?? "idle"} detail={fieldError[key]} />
      </div>
    </div>
  );

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={
        <section
          aria-labelledby="page-title"
          className="flex h-(--height-subbar) shrink-0 items-center justify-between gap-4 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/entities"
              className="shrink-0 rounded-chip text-base text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
            >
              <FormattedMessage id="entities.title" defaultMessage="Entities" />
            </Link>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-subtle" />
            <Building2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <h1 id="page-title" className="truncate text-lg font-semibold">
              {saved.legalName}
            </h1>
            <span
              className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_PILL[saved.status]}`}
            >
              {statusLabel(intl, saved.status)}
            </span>
            {archived && (
              <span className="inline-flex shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                <FormattedMessage id="entities.archivedPill" defaultMessage="Archived" />
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
                  <FormattedMessage id="entities.record.restore" defaultMessage="Restore" />
                </>
              ) : (
                <>
                  <Archive size={16} aria-hidden="true" />
                  <FormattedMessage id="entities.record.archive" defaultMessage="Archive" />
                </>
              )}
            </Button>
          </div>
        </section>
      }
    >
      <PageTitle title={saved.legalName} />
      <div className="flex max-w-4xl flex-col gap-4">
        {archived && (
          <p className="rounded-card bg-status-warning-bg px-3 py-2 text-md text-status-warning-fg">
            <FormattedMessage
              id="entities.record.archivedNote"
              defaultMessage="This entity is archived — it is out of the registry list. Restore it to edit."
            />
          </p>
        )}
        {/* EN5's RegCard on the shared card chrome (ST1/ST4 header strip). */}
        <section className="overflow-hidden rounded-card border border-border-default bg-raised">
          <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
            <h2 className="text-base font-semibold">
              <FormattedMessage id="entities.record.registry" defaultMessage="Registry" />
            </h2>
          </header>
          <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-2">
            <div className="@2xl/page:col-span-2">
              {textField(
                "legalName",
                "entity-legal-name",
                <FormattedMessage id="entities.form.legalName" defaultMessage="Legal name" />,
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entity-type">
                <FormattedMessage id="entities.form.type" defaultMessage="Entity type" />
              </Label>
              <div className="flex items-center gap-2">
                <select
                  id="entity-type"
                  value={saved.entityTypeId}
                  className={CONTROL_CLASS}
                  disabled={archived}
                  onChange={(event) => void commit("entityTypeId", { entityTypeId: event.target.value })}
                >
                  {/* The saved type may be archived and so absent from the
                      picker read (ENT-008) — keep it selectable as itself. */}
                  {!entityTypes.some((option: EntityTypeOption) => option.id === saved.entityTypeId) && (
                    <option value={saved.entityTypeId}>{saved.entityTypeName}</option>
                  )}
                  {entityTypes.map((option: EntityTypeOption) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </select>
                <StatusNote status={fieldStatus.entityTypeId ?? "idle"} detail={fieldError.entityTypeId} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entity-status">
                <FormattedMessage id="entities.form.status" defaultMessage="Status" />
              </Label>
              <div className="flex items-center gap-2">
                <select
                  id="entity-status"
                  value={saved.status}
                  className={CONTROL_CLASS}
                  disabled={archived}
                  onChange={(event) => void commit("status", { status: event.target.value as EntityStatus })}
                >
                  {ENTITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(intl, status)}
                    </option>
                  ))}
                </select>
                <StatusNote status={fieldStatus.status ?? "idle"} detail={fieldError.status} />
              </div>
            </div>
            {textField(
              "jurisdiction",
              "entity-jurisdiction",
              <FormattedMessage
                id="entities.form.jurisdiction"
                defaultMessage="Formation jurisdiction"
              />,
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entity-formed-on">
                <FormattedMessage id="entities.form.formedOn" defaultMessage="Formed on" />
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="entity-formed-on"
                  type="date"
                  value={formedOnDraft}
                  disabled={archived}
                  onChange={(event) => setFormedOnDraft(event.target.value)}
                  onBlur={commitFormedOn}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitFormedOn();
                    if (event.key === "Escape") setFormedOnDraft(saved.formedOn ?? "");
                  }}
                />
                <StatusNote status={fieldStatus.formedOn ?? "idle"} detail={fieldError.formedOn} />
              </div>
            </div>
            {textField(
              "registrationNumber",
              "entity-registration-number",
              <FormattedMessage
                id="entities.form.registrationNumber"
                defaultMessage="Registration no."
              />,
            )}
            {textField(
              "taxId",
              "entity-tax-id",
              <FormattedMessage id="entities.form.taxId" defaultMessage="Tax ID" />,
            )}
            {textField(
              "registeredAgent",
              "entity-registered-agent",
              <FormattedMessage
                id="entities.form.registeredAgent"
                defaultMessage="Registered agent"
              />,
            )}
            <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
              <Label htmlFor="entity-registered-address">
                <FormattedMessage
                  id="entities.form.registeredAddress"
                  defaultMessage="Registered address"
                />
              </Label>
              <div className="flex items-start gap-2">
                <textarea
                  id="entity-registered-address"
                  value={drafts.registeredAddress}
                  className={TEXTAREA_CLASS}
                  disabled={archived}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, registeredAddress: event.target.value }))
                  }
                  onBlur={() => commitText("registeredAddress")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") revertText("registeredAddress");
                  }}
                />
                <StatusNote
                  status={fieldStatus.registeredAddress ?? "idle"}
                  detail={fieldError.registeredAddress}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
