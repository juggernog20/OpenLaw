// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Fields (#83), the shared CTR-016 field catalog. It serves
 * contract, matter and Entity fields, one module scope per
 * page, per the ST11 frame of settings.pen: the
 * ListEditor in its DES-021 table variant — column header, no reorder
 * (the catalog is unordered; per-type attachment orders rendering), the
 * type column, and the sparkle marking fields
 * with an AI extraction prompt (CTR-008). Creation has seven dimensions
 * (two of them immutable), so add and edit go through the field-editor
 * dialog rather than an inline row; the name still renames in place
 * (DES-017). Archive is guarded but never blocked and never reassigns —
 * stored values are retained by rule (MTR-014), which the guard says
 * out loud. The loader is the client half of SET-002's gate; the API's
 * 403 is the real refusal.
 */

import { FieldEditorDialog } from "../components/field-editor-dialog";
import {
  isFieldRow,
  type ModuleScope,
  fieldRow,
  typeLabel,
  type FieldRow,
} from "../lib/field-catalog";

import { useRef, useState, type ReactNode } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { History, Pencil, Sparkles, TriangleAlert } from "lucide-react";
import { isReferenceFieldType } from "@openlaw/shared";
import { api } from "../lib/api";
import { problem as readProblem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { EntitiesSettingsTabs } from "../components/entities-settings-tabs";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { DefaultFields } from "../components/default-fields";
import { ListEditor } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";

async function settingsFieldsLoader(module: ModuleScope) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/fields", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The fields could not be read.");
  return {
    fields: data.fields.filter((field) => isFieldRow(field, module)),
  };
}

export function settingsContractFieldsLoader() {
  return settingsFieldsLoader("contract");
}

export function settingsMatterFieldsLoader() {
  return settingsFieldsLoader("matter");
}

export function settingsEntityFieldsLoader() {
  return settingsFieldsLoader("entity");
}

function ArchiveFieldDialog({
  target,
  module,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: FieldRow;
  module: ModuleScope;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: FieldRow) => void;
  /** Where focus lands after a successful archive — the row's archive
   * button unmounts with the row, so the default restore has no home. */
  onArchivedCloseFocus: () => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = useRef(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/fields/{id}/archive", {
        params: { path: { id: target.id } },
      });
      const { data } = result;
      if (data) {
        archived.current = true;
        onArchived(fieldRow(data.field, module));
        onOpenChange(false);
      } else {
        // The API's own refusal (already archived, a stale list) is
        // more actionable than any generic line.
        setError(
          (await readProblem(result)).detail ??
            intl.formatMessage({
              id: "settings.contractFields.archiveError",
              defaultMessage: "The field could not be archived.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.contractFields.archiveError",
          defaultMessage: "The field could not be archived.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!archived.current) return;
          event.preventDefault();
          onArchivedCloseFocus();
        }}
      >
        <DialogTitle>
          <FormattedMessage
            id="settings.contractFields.archiveTitle"
            defaultMessage="Archive {name}"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {/* Fields never reassign and never block: everything is
                retained by rule (MTR-014), which is the whole message.
                M8 and M22 added record values to this same count; the
                copy deliberately calls every source "uses". */}
            <p>
              <FormattedMessage
                id="settings.contractFields.archiveWarning"
                defaultMessage={
                  "{count, plural, =0 {{name} is not attached to any type. The definition " +
                  "is kept and the field can be restored.} one {{name} is attached to " +
                  "# type — the attachment is kept, hidden until the field is restored.} " +
                  "other {{name} is attached to # types — the attachments are kept, " +
                  "hidden until the field is restored.}}"
                }
                values={{ name: target.displayName, count: target.inUseCount }}
              />
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage
              id="settings.contractFields.auditNote"
              defaultMessage="The change applies immediately and is recorded in the audit log."
            />
          </p>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void submit()}>
              <FormattedMessage
                id="settings.contractFields.archiveSubmit"
                defaultMessage="Archive field"
              />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsFieldsPage({
  initialFields,
  module,
  tabs,
}: Readonly<{ initialFields: FieldRow[]; module: ModuleScope; tabs: ReactNode }>) {
  const intl = useIntl();

  const [rows, setRows] = useState<FieldRow[]>(initialFields);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  /** The editor dialog: closed, create mode, or an edit target. */
  const [editor, setEditor] = useState<{ target: FieldRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FieldRow | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The catalog is unordered (no display order — attachment order rules
  // rendering once types attach fields); the list keeps creation order.
  const live = rows.filter((row) => !row.archivedAt);
  const archived = rows.filter((row) => row.archivedAt);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: FieldRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: FieldRow, displayName: string) {
    noteRow(row.id, "saving");
    const result = await api
      .PATCH("/api/v1/fields/{id}", {
        params: { path: { id: row.id } },
        body: { displayName },
      })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (data) {
      replaceRow(fieldRow(data.field, module));
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", (await readProblem(result)).detail);
    }
  }

  async function restore(row: FieldRow) {
    noteRow(row.id, "saving");
    const result = await api
      .POST("/api/v1/fields/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (data) {
      replaceRow(fieldRow(data.field, module));
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", (await readProblem(result)).detail);
    }
  }

  /** The table cells after the name: type and extraction prompt. */
  function rowDetails(row: FieldRow) {
    return (
      <>
        <span className="w-24 shrink-0 text-sm whitespace-nowrap text-muted">
          <span className="sr-only">
            <FormattedMessage id="settings.contractFields.typePrefix" defaultMessage="Type:" />{" "}
          </span>
          {typeLabel(intl, row.fieldType)}
        </span>
        <span className="flex w-16 shrink-0 items-center">
          {row.aiPrompt && !isReferenceFieldType(row.fieldType) ? (
            <Sparkles
              size={16}
              role="img"
              aria-label={intl.formatMessage(
                {
                  id: "settings.contractFields.hasPrompt",
                  defaultMessage: "{name} has an AI extraction prompt",
                },
                { name: row.displayName },
              )}
              className="text-status-info-fg"
            />
          ) : (
            <>
              <span aria-hidden="true" className="text-sm text-muted">
                —
              </span>
              <span className="sr-only">
                <FormattedMessage
                  id="settings.contractFields.noPrompt"
                  defaultMessage="No AI prompt"
                />
              </span>
            </>
          )}
        </span>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.contractFields.pageTitle",
          defaultMessage: "Fields",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        {tabs}
        {module !== "entity" && <DefaultFields module={module} />}
        <ListEditor
          region
          collapsible={module !== "entity"}
          rows={live}
          archivedRows={archived}
          title={
            module === "entity" ? (
              <FormattedMessage id="settings.contractFields.title" defaultMessage="Fields" />
            ) : (
              <FormattedMessage id="settings.fields.custom" defaultMessage="Custom Fields" />
            )
          }
          count={
            <FormattedMessage
              id="settings.contractFields.count"
              defaultMessage="{count, plural, one {# field} other {# fields}}"
              values={{ count: live.length }}
            />
          }
          addLabel={
            <FormattedMessage id="settings.contractFields.add" defaultMessage="Add field" />
          }
          onAdd={() => setEditor({ target: null })}
          columnsHeader={
            <div className="flex h-8 items-center border-b border-border-default pe-3 text-xs font-semibold text-muted">
              <span className="flex min-w-0 flex-1 items-center gap-2 ps-4">
                <span className="min-w-0 flex-1">
                  <FormattedMessage
                    id="settings.contractFields.fieldColumn"
                    defaultMessage="Field"
                  />
                </span>
                <span className="w-24 shrink-0">
                  <FormattedMessage id="settings.contractFields.typeColumn" defaultMessage="Type" />
                </span>
                <span className="w-16 shrink-0">
                  <FormattedMessage
                    id="settings.contractFields.promptColumn"
                    defaultMessage="AI prompt"
                  />
                </span>
              </span>
              {/* The trailing-action column has no header (ST11). */}
              <span className="w-15" aria-hidden="true" />
            </div>
          }
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractFields.renameLabel", defaultMessage: "Rename {name}" },
              { name: row.displayName },
            )
          }
          onRename={(row, displayName) => void rename(row, displayName)}
          rowDetails={rowDetails}
          nameSlotClassName="min-w-0 flex-1"
          // The lock the taxonomy panes draw on their fallback row: a
          // default Field is skeleton Start blank keeps (SET-004), and
          // the API refuses its archive regardless. Rename and the
          // editor stay open, as they do for the seeds' AI prompts.
          protectedLabel={(row) =>
            row.isSystemDefault
              ? intl.formatMessage(
                  {
                    id: "settings.contractFields.locked",
                    defaultMessage: "{name} is a default Field and can't be archived",
                  },
                  { name: row.displayName },
                )
              : null
          }
          rowActions={(row) =>
            row.archivedAt ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="px-1.5"
                disabled={rowStatus[row.id] === "saving"}
                aria-label={intl.formatMessage(
                  { id: "settings.contractFields.edit", defaultMessage: "Edit {name}" },
                  { name: row.displayName },
                )}
                onClick={() => setEditor({ target: row })}
              >
                <Pencil size={16} aria-hidden="true" className="text-muted" />
              </Button>
            )
          }
          archiveLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractFields.archive", defaultMessage: "Archive {name}" },
              { name: row.displayName },
            )
          }
          onArchive={setArchiveTarget}
          restoreLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractFields.restore", defaultMessage: "Restore {name}" },
              { name: row.displayName },
            )
          }
          onRestore={(row) => void restore(row)}
          listRef={listRef}
        />
      </div>
      {editor && (
        <FieldEditorDialog
          target={editor.target}
          module={module}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onRowChanged={replaceRow}
          onCreated={(row) => setRows((current) => [...current, row])}
        />
      )}
      {archiveTarget && (
        <ArchiveFieldDialog
          target={archiveTarget}
          module={module}
          onOpenChange={(open) => {
            if (!open) setArchiveTarget(null);
          }}
          onArchived={replaceRow}
          onArchivedCloseFocus={() => listRef.current?.focus()}
        />
      )}
    </>
  );
}

export function SettingsContractFieldsPage() {
  const { fields } = useLoaderData<typeof settingsContractFieldsLoader>();
  return (
    <SettingsFieldsPage initialFields={fields} module="contract" tabs={<ContractsSettingsTabs />} />
  );
}

export function SettingsMatterFieldsPage() {
  const { fields } = useLoaderData<typeof settingsMatterFieldsLoader>();
  return (
    <SettingsFieldsPage initialFields={fields} module="matter" tabs={<MattersSettingsTabs />} />
  );
}

export function SettingsEntityFieldsPage() {
  const { fields } = useLoaderData<typeof settingsEntityFieldsLoader>();
  return (
    <SettingsFieldsPage initialFields={fields} module="entity" tabs={<EntitiesSettingsTabs />} />
  );
}
