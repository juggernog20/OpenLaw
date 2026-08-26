// SPDX-License-Identifier: AGPL-3.0-only

/** Matters Settings → Templates: the MTR-013 per-type template pane. */

import { useMemo, useRef, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Pencil } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { ListEditor, type ListEditorRow } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsMatterTemplatesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [types, templates] = await Promise.all([
    api.GET("/api/v1/matter-types", {}),
    api.GET("/api/v1/matter-templates", {
      params: { query: { includeArchived: "true" } },
    }),
  ]);
  if (!types.data || !templates.data) throw new Error("The Matter templates could not be read.");
  return {
    matterTypes: types.data.matterTypes.filter((type) => !type.archivedAt),
    matterTemplates: templates.data.matterTemplates,
  };
}

type ApiTemplate =
  paths["/api/v1/matter-templates"]["get"]["responses"]["200"]["content"]["application/json"]["matterTemplates"][number];

interface TemplateRow extends ListEditorRow {
  matterTypeId: string;
  matterTypeName: string;
  description: string | null;
  taskCount: number;
  keyDateCount: number;
  customFieldCount: number;
}

function toRow(template: ApiTemplate): TemplateRow {
  return { ...template, displayName: template.name };
}

function CreateTemplateDialog({
  matterTypeId,
  onOpenChange,
  onCreated,
}: Readonly<{
  matterTypeId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (row: TemplateRow) => void;
}>) {
  const intl = useIntl();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (name.trim() === "") {
      setError(
        intl.formatMessage({
          id: "settings.matterTemplates.nameMissing",
          defaultMessage: "Name the template.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api
      .POST("/api/v1/matter-templates", {
        body: {
          matterTypeId,
          name: name.trim(),
          description: description.trim() || undefined,
        },
      })
      .catch(() => ({ data: null, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.matterTemplates.createError",
            defaultMessage: "The Matter template could not be created.",
          }),
      );
      return;
    }
    onCreated(toRow(data.matterTemplate));
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="settings.matterTemplates.createTitle"
            defaultMessage="Add Matter template"
          />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-template-name">
              <FormattedMessage id="settings.matterTemplates.name" defaultMessage="Name" />
            </Label>
            <Input
              id="matter-template-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-template-description">
              <FormattedMessage
                id="settings.matterTemplates.description"
                defaultMessage="Description"
              />
            </Label>
            <Input
              id="matter-template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
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
              <FormattedMessage
                id="settings.matterTemplates.createSubmit"
                defaultMessage="Add template"
              />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveTemplateDialog({
  target,
  onOpenChange,
  onArchived,
}: Readonly<{
  target: TemplateRow;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: TemplateRow) => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/matter-templates/{id}/archive", {
        params: { path: { id: target.id } },
      })
      .catch(() => ({ data: null, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.matterTemplates.archiveError",
            defaultMessage: "The Matter template could not be archived.",
          }),
      );
      return;
    }
    onArchived(toRow(data.matterTemplate));
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="settings.matterTemplates.archiveTitle"
            defaultMessage="Archive {name}?"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <p className="mt-3 text-base text-muted">
          <FormattedMessage
            id="settings.matterTemplates.archiveHelp"
            defaultMessage="The template leaves new Matter creation. Existing Matters are unchanged, and restoring the template brings its full definition back."
          />
        </p>
        {error && (
          <p role="alert" className="mt-3 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void archive()}>
            <FormattedMessage
              id="settings.matterTemplates.archiveSubmit"
              defaultMessage="Archive template"
            />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsMatterTemplatesPage() {
  const { matterTypes, matterTemplates } = useLoaderData<typeof settingsMatterTemplatesLoader>();
  const intl = useIntl();
  const [rows, setRows] = useState<TemplateRow[]>(() => matterTemplates.map(toRow));
  const [selectedTypeId, setSelectedTypeId] = useState(matterTypes[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<TemplateRow | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const listRef = useRef<HTMLUListElement>(null);

  const selectedType = matterTypes.find((type) => type.id === selectedTypeId);
  const selectedRows = useMemo(
    () => rows.filter((row) => row.matterTypeId === selectedTypeId),
    [rows, selectedTypeId],
  );
  const live = selectedRows.filter((row) => !row.archivedAt);
  const archived = selectedRows.filter((row) => row.archivedAt);

  function replaceRow(row: TemplateRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: TemplateRow, name: string) {
    setRowStatus((current) => ({ ...current, [row.id]: "saving" }));
    const { data, error } = await api
      .PATCH("/api/v1/matter-templates/{id}", {
        params: { path: { id: row.id } },
        body: { name },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(toRow(data.matterTemplate));
      setRowStatus((current) => ({ ...current, [row.id]: "saved" }));
    } else {
      setRowStatus((current) => ({ ...current, [row.id]: "error" }));
      setRowError((current) => ({ ...current, [row.id]: problemDetail(error) }));
    }
  }

  async function restore(row: TemplateRow) {
    setRowStatus((current) => ({ ...current, [row.id]: "saving" }));
    const { data, error } = await api
      .POST("/api/v1/matter-templates/{id}/restore", {
        params: { path: { id: row.id } },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(toRow(data.matterTemplate));
      setRowStatus((current) => ({ ...current, [row.id]: "saved" }));
    } else {
      setRowStatus((current) => ({ ...current, [row.id]: "error" }));
      setRowError((current) => ({ ...current, [row.id]: problemDetail(error) }));
    }
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.matterTemplates.pageTitle",
          defaultMessage: "Matter templates",
        })}
      />
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <MattersSettingsTabs />
        <div className="flex items-center gap-2">
          <Label htmlFor="matter-template-type">
            <FormattedMessage
              id="settings.matterTemplates.typeLabel"
              defaultMessage="Matter type"
            />
          </Label>
          <select
            id="matter-template-type"
            value={selectedTypeId}
            onChange={(event) => setSelectedTypeId(event.target.value)}
            className="h-8 min-w-56 rounded-button border border-border-default bg-raised px-2 text-base text-primary"
          >
            {matterTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.displayName}
              </option>
            ))}
          </select>
        </div>
        {selectedType ? (
          <ListEditor
            rows={live}
            archivedRows={archived}
            title={
              <FormattedMessage
                id="settings.matterTemplates.title"
                defaultMessage="Matter templates"
              />
            }
            count={
              <FormattedMessage
                id="settings.matterTemplates.count"
                defaultMessage="{count, plural, one {# template} other {# templates}}"
                values={{ count: live.length }}
              />
            }
            headerCaption={selectedType.displayName}
            addLabel={
              <FormattedMessage id="settings.matterTemplates.add" defaultMessage="Add template" />
            }
            onAdd={() => setCreating(true)}
            help={
              <FormattedMessage
                id="settings.matterTemplates.help"
                defaultMessage="Templates pre-fill a new Matter. Editing or archiving one never changes an existing Matter."
              />
            }
            rowStatus={rowStatus}
            rowError={rowError}
            renameLabel={(row) =>
              intl.formatMessage(
                {
                  id: "settings.matterTemplates.rename",
                  defaultMessage: "Rename {name}",
                },
                { name: row.displayName },
              )
            }
            onRename={(row, name) => void rename(row, name)}
            rowCaption={(row) => row.description ?? ""}
            rowDetails={(row) => (
              <div className="flex w-64 items-center justify-end gap-1.5 text-xs text-muted">
                <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-status-neutral-fg">
                  {intl.formatMessage(
                    {
                      id: "settings.matterTemplates.taskCount",
                      defaultMessage: "{count, plural, one {# task} other {# tasks}}",
                    },
                    { count: row.taskCount },
                  )}
                </span>
                <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-status-neutral-fg">
                  {intl.formatMessage(
                    {
                      id: "settings.matterTemplates.keyDateCount",
                      defaultMessage: "{count, plural, one {# date} other {# dates}}",
                    },
                    { count: row.keyDateCount },
                  )}
                </span>
                <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-status-neutral-fg">
                  {intl.formatMessage(
                    {
                      id: "settings.matterTemplates.fieldCount",
                      defaultMessage: "{count, plural, one {# field} other {# fields}}",
                    },
                    { count: row.customFieldCount },
                  )}
                </span>
              </div>
            )}
            rowActions={(row) =>
              row.archivedAt ? null : (
                <Button asChild variant="ghost" size="sm" className="px-1.5">
                  <Link
                    to={`/settings/matters/templates/${row.id}`}
                    aria-label={intl.formatMessage(
                      {
                        id: "settings.matterTemplates.edit",
                        defaultMessage: "Edit {name}",
                      },
                      { name: row.displayName },
                    )}
                  >
                    <Pencil size={16} aria-hidden="true" className="text-muted" />
                  </Link>
                </Button>
              )
            }
            archiveLabel={(row) =>
              intl.formatMessage(
                {
                  id: "settings.matterTemplates.archive",
                  defaultMessage: "Archive {name}",
                },
                { name: row.displayName },
              )
            }
            onArchive={setArchiveTarget}
            restoreLabel={(row) =>
              intl.formatMessage(
                {
                  id: "settings.matterTemplates.restore",
                  defaultMessage: "Restore {name}",
                },
                { name: row.displayName },
              )
            }
            onRestore={(row) => void restore(row)}
            listRef={listRef}
          />
        ) : (
          <p className="text-base text-muted">
            <FormattedMessage
              id="settings.matterTemplates.noTypes"
              defaultMessage="Add a Matter type before creating a template."
            />
          </p>
        )}
      </div>
      {creating && selectedTypeId && (
        <CreateTemplateDialog
          matterTypeId={selectedTypeId}
          onOpenChange={setCreating}
          onCreated={(row) => setRows((current) => [...current, row])}
        />
      )}
      {archiveTarget && (
        <ArchiveTemplateDialog
          target={archiveTarget}
          onOpenChange={(open) => {
            if (!open) setArchiveTarget(null);
          }}
          onArchived={replaceRow}
        />
      )}
    </>
  );
}
