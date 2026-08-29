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
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Archive, ArchiveRestore, Building2, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import {
  ENTITY_STATUSES,
  STATUS_PILL,
  statusLabel,
  type EntityRow,
  type EntityStatus,
  type EntityTypeOption,
} from "../lib/entities";
import { useFieldCommit, type FieldStatus, type TextField } from "../lib/field-commit";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { problem } from "../lib/problem";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { StatusNote } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function entityRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
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

export function EntityRecordPage() {
  const { user, entity, entityTypes } = useLoaderData<typeof entityRecordLoader>();
  const intl = useIntl();

  /** The saved record — the server's truth after the last commit. */
  const [saved, setSaved] = useState<EntityRow>(entity);
  const [drafts, setDrafts] = useState<Record<TextFieldKey, string>>(() => textDrafts(entity));
  const [formedOnDraft, setFormedOnDraft] = useState(entity.formedOn ?? "");
  const fields = useFieldCommit<FieldKey>();
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

  /** One PATCH per committed field (DES-017): success adopts the
   * server's row as saved truth but resets only the committed field's
   * draft. Another field's in-progress edit is not this commit's to
   * discard. The saving/saved/error note beside the field is the
   * hook's. */
  function commit(key: FieldKey, body: Record<string, unknown>) {
    return fields.commit(
      key,
      () => api.PATCH("/api/v1/entities/{id}", { params: { path: { id: saved.id } }, body }),
      (data) => {
        const row = data.entity;
        setSaved(row);
        if (key === "formedOn") {
          setFormedOnDraft(row.formedOn ?? "");
        } else if (key !== "entityTypeId" && key !== "status") {
          setDrafts((current) => ({ ...current, [key]: textDrafts(row)[key] }));
        }
      },
    );
  }

  /** The hook's view of one text box: its draft, the record's value,
   * how to write the box, and how to send the trimmed text. The legal
   * name is required. The other text fields clear to null. */
  function textField(key: TextFieldKey): TextField {
    return {
      draft: drafts[key],
      saved: key === "legalName" ? saved.legalName : (saved[key] ?? ""),
      required: key === "legalName",
      reset: (value) => setDrafts((current) => ({ ...current, [key]: value })),
      send: (value) => commit(key, { [key]: key === "legalName" ? value : value || null }),
    };
  }

  function commitFormedOn() {
    fields.commitText("formedOn", {
      draft: formedOnDraft,
      saved: saved.formedOn ?? "",
      reset: setFormedOnDraft,
      send: (value) => commit("formedOn", { formedOn: value || null }),
    });
  }

  async function archiveOrRestore() {
    setArchiveStatus("saving");
    setArchiveError(undefined);
    const result = await (
      archived
        ? api.POST("/api/v1/entities/{id}/restore", { params: { path: { id: saved.id } } })
        : api.POST("/api/v1/entities/{id}/archive", { params: { path: { id: saved.id } } })
    ).catch(() => undefined);
    if (result?.data) {
      // A record-level action: the card re-reads as saved truth, so
      // every draft resets — an in-progress edit on a record being
      // archived is deliberately discarded, and a restore starts clean.
      const row = result.data.entity;
      setSaved(row);
      setDrafts(textDrafts(row));
      setFormedOnDraft(row.formedOn ?? "");
      setArchiveStatus("idle");
    } else {
      setArchiveStatus("error");
      setArchiveError((await problem(result)).detail);
    }
  }

  const signOut = useSignOut("/auth/login");

  const textInput = (key: TextFieldKey, controlId: string, label: ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={controlId}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={controlId}
          value={drafts[key]}
          disabled={archived}
          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
          onBlur={() => fields.commitText(key, textField(key))}
          onKeyDown={(event) => {
            if (event.key === "Enter") fields.commitText(key, textField(key));
            if (event.key === "Escape") fields.revertText(key, textField(key));
          }}
        />
        <StatusNote status={fields.status[key] ?? "idle"} detail={fields.error[key]} />
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
            <h1 id="page-title" className="truncate text-md font-semibold">
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
              {textInput(
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
                  onChange={(event) =>
                    void commit("entityTypeId", { entityTypeId: event.target.value })
                  }
                >
                  {/* The saved type may be archived and so absent from the
                      picker read (ENT-008) — keep it selectable as itself. */}
                  {!entityTypes.some(
                    (option: EntityTypeOption) => option.id === saved.entityTypeId,
                  ) && <option value={saved.entityTypeId}>{saved.entityTypeName}</option>}
                  {entityTypes.map((option: EntityTypeOption) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </select>
                <StatusNote
                  status={fields.status.entityTypeId ?? "idle"}
                  detail={fields.error.entityTypeId}
                />
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
                  onChange={(event) =>
                    void commit("status", { status: event.target.value as EntityStatus })
                  }
                >
                  {ENTITY_STATUSES.map((status: EntityStatus) => (
                    <option key={status} value={status}>
                      {statusLabel(intl, status)}
                    </option>
                  ))}
                </select>
                <StatusNote status={fields.status.status ?? "idle"} detail={fields.error.status} />
              </div>
            </div>
            {textInput(
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
                <StatusNote
                  status={fields.status.formedOn ?? "idle"}
                  detail={fields.error.formedOn}
                />
              </div>
            </div>
            {textInput(
              "registrationNumber",
              "entity-registration-number",
              <FormattedMessage
                id="entities.form.registrationNumber"
                defaultMessage="Registration no."
              />,
            )}
            {textInput(
              "taxId",
              "entity-tax-id",
              <FormattedMessage id="entities.form.taxId" defaultMessage="Tax ID" />,
            )}
            {textInput(
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
                  onBlur={() =>
                    fields.commitText("registeredAddress", textField("registeredAddress"))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      fields.revertText("registeredAddress", textField("registeredAddress"));
                    }
                  }}
                />
                <StatusNote
                  status={fields.status.registeredAddress ?? "idle"}
                  detail={fields.error.registeredAddress}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
