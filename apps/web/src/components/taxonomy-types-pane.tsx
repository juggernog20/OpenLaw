// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The taxonomy Types pane (#85: one machinery, every type table), from
 * the ST6 frame of settings.pen: a configurable type list with the
 * `other` row locked, drag or arrow-key reorder, an inline draft row
 * for add, and the SET-003 archive-guard modal (ST8) with its
 * reassignment select. Every mutation applies immediately on save. The
 * shared anatomy lives in the ListEditor component (DES-020); this
 * component owns the behavior, and each module's pane mounts it with
 * its own vocabulary and API adapter — the Contracts pane (CTR-002)
 * and the Matters pane (MTR-001) are configuration, not copies.
 */

import { useRef, useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { History, Pencil, TriangleAlert } from "lucide-react";
import type { ApiResult } from "../lib/api-result";
import { field } from "../lib/forms";
import { ListEditor } from "./list-editor";
import { PageTitle } from "./page-title";
import { StatusNote, type FieldStatus } from "./status-note";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** One row of the taxonomy list, as every module's client sees it. */
export interface TaxonomyPaneRow {
  id: string;
  slug: string;
  displayName: string;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

/** The API seam each module's pane implements over its own routes. */
export interface TaxonomyPaneApi {
  create(displayName: string): Promise<ApiResult<TaxonomyPaneRow>>;
  rename(id: string, displayName: string): Promise<ApiResult<TaxonomyPaneRow>>;
  reorder(ids: string[]): Promise<ApiResult<TaxonomyPaneRow[]>>;
  archive(id: string, reassignToId?: string): Promise<ApiResult<TaxonomyPaneRow>>;
  restore(id: string): Promise<ApiResult<TaxonomyPaneRow>>;
}

/**
 * The pane's vocabulary, defined per module with `defineMessages` so
 * extraction sees every string. Values ride at format time: `{name}`,
 * `{count}`, `{position}`, `{total}` per the reference pane's copy.
 */
export interface TaxonomyPaneMessages {
  pageTitle: MessageDescriptor;
  title: MessageDescriptor;
  count: MessageDescriptor;
  add: MessageDescriptor;
  addName: MessageDescriptor;
  help: MessageDescriptor;
  renameLabel: MessageDescriptor;
  inUse: MessageDescriptor;
  edit: MessageDescriptor;
  locked: MessageDescriptor;
  archive: MessageDescriptor;
  restore: MessageDescriptor;
  reorder: MessageDescriptor;
  moved: MessageDescriptor;
  archiveTitle: MessageDescriptor;
  archiveWarning: MessageDescriptor;
  reassignLabel: MessageDescriptor;
  reassignNone: MessageDescriptor;
  /** Why archive is blocked when in-use rows have no live type to
   * take them — the last live type cannot leave. */
  noCandidates: MessageDescriptor;
  auditNote: MessageDescriptor;
  archiveError: MessageDescriptor;
  archiveSubmit: MessageDescriptor;
}

const byDisplayOrder = (a: TaxonomyPaneRow, b: TaxonomyPaneRow) => a.displayOrder - b.displayOrder;

function ArchiveTypeDialog({
  target,
  liveTypes,
  api,
  messages,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: TaxonomyPaneRow;
  /** Reassignment candidates: every live type but the target. */
  liveTypes: TaxonomyPaneRow[];
  api: TaxonomyPaneApi;
  messages: TaxonomyPaneMessages;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: TaxonomyPaneRow) => void;
  /** Where focus lands after a successful archive — the row's archive
   * button unmounts with the row, so the default restore has no home. */
  onArchivedCloseFocus: () => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = useRef(false);
  const candidates = liveTypes.filter((row) => row.id !== target.id);
  // In-use rows need a reassignment target; with no other live type the
  // form can never pass, so say why instead of letting native
  // validation refuse a select whose only option is empty.
  const blocked = target.inUseCount > 0 && candidates.length === 0;

  async function submit(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const reassignToId = field(new FormData(event.currentTarget), "reassignToId");
    setBusy(true);
    setError(null);
    try {
      const { data, detail } = await api.archive(target.id, reassignToId || undefined);
      if (data) {
        archived.current = true;
        onArchived(data);
        onOpenChange(false);
      } else {
        // The API's own refusal (the protected row, a stale target) is
        // more actionable than any generic line.
        setError(detail ?? intl.formatMessage(messages.archiveError));
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(intl.formatMessage(messages.archiveError));
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
          <FormattedMessage {...messages.archiveTitle} values={{ name: target.displayName }} />
        </DialogTitle>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p>
              <FormattedMessage
                {...messages.archiveWarning}
                values={{ name: target.displayName, count: target.inUseCount }}
              />
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reassignToId">
              <FormattedMessage {...messages.reassignLabel} values={{ count: target.inUseCount }} />
            </Label>
            {/* The affordance is always drawn (ST8); with nothing to
                move it waits disabled, and the SET-003 requirement arms
                once records exist (the record milestone). */}
            <select
              id="reassignToId"
              name="reassignToId"
              defaultValue=""
              disabled={target.inUseCount === 0 || blocked}
              required={target.inUseCount > 0 && !blocked}
              className="h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50"
            >
              <option value="">{intl.formatMessage(messages.reassignNone)}</option>
              {candidates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.displayName}
                </option>
              ))}
            </select>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage {...messages.auditNote} />
          </p>
          {blocked && (
            <p className="text-xs text-status-danger-fg">
              <FormattedMessage {...messages.noCandidates} />
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" variant="danger" disabled={busy || blocked}>
              <FormattedMessage {...messages.archiveSubmit} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaxonomyTypesPane({
  initialRows,
  tabs,
  editPath,
  api,
  messages,
}: Readonly<{
  initialRows: TaxonomyPaneRow[];
  /** The module's section head (title + tab strip). */
  tabs: ReactNode;
  /** Each row's editor screen URL. */
  editPath: (row: TaxonomyPaneRow) => string;
  api: TaxonomyPaneApi;
  messages: TaxonomyPaneMessages;
}>) {
  const intl = useIntl();
  const navigate = useNavigate();

  const [rows, setRows] = useState<TaxonomyPaneRow[]>(initialRows);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<TaxonomyPaneRow | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const createInFlight = useRef(false);

  const live = rows.filter((row) => !row.archivedAt).sort(byDisplayOrder);
  const archived = rows.filter((row) => row.archivedAt).sort(byDisplayOrder);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: TaxonomyPaneRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: TaxonomyPaneRow, displayName: string) {
    noteRow(row.id, "saving");
    const { data, detail } = await api
      .rename(row.id, displayName)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      replaceRow(data);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", detail);
    }
  }

  async function create(draft: string) {
    // Enter commits and the input then blurs — a ref, set synchronously,
    // keeps the pair from posting the same draft twice.
    if (createInFlight.current) return;
    const displayName = draft.trim();
    if (displayName === "") {
      setAdding(false);
      return;
    }
    createInFlight.current = true;
    setAddStatus("saving");
    setAddError(undefined);
    try {
      const { data, detail } = await api
        .create(displayName)
        .catch(() => ({ data: undefined, detail: undefined }));
      if (data) {
        setRows((current) => [...current, data]);
        setAdding(false);
        setAddStatus("saved");
      } else {
        // Keep the draft row open so the name is not lost to a refusal.
        setAddStatus("error");
        setAddError(detail);
      }
    } finally {
      createInFlight.current = false;
    }
  }

  /** Commits a full permutation of the live rows (SET-003: immediately). */
  async function commitOrder(orderedIds: string[]) {
    setOrderStatus("saving");
    setOrderError(undefined);
    const { data, detail } = await api
      .reorder(orderedIds)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      const reordered = data;
      setRows((current) => [
        ...reordered,
        ...current.filter((row) => !reordered.some((moved) => moved.id === row.id)),
      ]);
      setOrderStatus("saved");
      return true;
    }
    setOrderStatus("error");
    setOrderError(detail);
    return false;
  }

  /** One validated move from the grip (arrow key or drop) — commit the
   * permutation and announce the landing position (DES-020). */
  async function move(fromIndex: number, toIndex: number) {
    const row = live[fromIndex]!;
    const ids = live.map(({ id }) => id);
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, row.id);
    if (await commitOrder(ids)) {
      setAnnouncement(
        intl.formatMessage(messages.moved, {
          name: row.displayName,
          position: toIndex + 1,
          total: live.length,
        }),
      );
    }
  }

  async function restore(row: TaxonomyPaneRow) {
    noteRow(row.id, "saving");
    const { data, detail } = await api
      .restore(row.id)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      replaceRow(data);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", detail);
    }
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.pageTitle)} />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        {tabs}
        <ListEditor
          rows={live}
          archivedRows={archived}
          title={<FormattedMessage {...messages.title} />}
          count={<FormattedMessage {...messages.count} values={{ count: live.length }} />}
          addLabel={<FormattedMessage {...messages.add} />}
          onAdd={() => {
            setAdding(true);
            setAddStatus("idle");
            setAddError(undefined);
          }}
          help={<FormattedMessage {...messages.help} />}
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) => intl.formatMessage(messages.renameLabel, { name: row.displayName })}
          onRename={(row, displayName) => void rename(row, displayName)}
          rowMeta={(row) => (
            <FormattedMessage {...messages.inUse} values={{ count: row.inUseCount }} />
          )}
          rowActions={(row) => (
            // Each row's own editor screen — fields attach there, and
            // the description lives there, not in the list.
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5"
              aria-label={intl.formatMessage(messages.edit, { name: row.displayName })}
              onClick={() => void navigate(editPath(row))}
            >
              <Pencil size={16} aria-hidden="true" className="text-muted" />
            </Button>
          )}
          protectedLabel={(row) =>
            row.slug === "other"
              ? intl.formatMessage(messages.locked, { name: row.displayName })
              : null
          }
          archiveLabel={(row) => intl.formatMessage(messages.archive, { name: row.displayName })}
          onArchive={setArchiveTarget}
          restoreLabel={(row) => intl.formatMessage(messages.restore, { name: row.displayName })}
          onRestore={(row) => void restore(row)}
          reorder={{
            status: orderStatus,
            detail: orderError,
            gripLabel: (row, position, total) =>
              intl.formatMessage(messages.reorder, { name: row.displayName, position, total }),
            onMove: (fromIndex, toIndex) => void move(fromIndex, toIndex),
          }}
          adding={adding}
          addRow={
            <>
              <Input
                autoFocus
                aria-label={intl.formatMessage(messages.addName)}
                className="h-7 w-64 max-w-full"
                onBlur={(event) => void create(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create(event.currentTarget.value);
                  if (event.key === "Escape") setAdding(false);
                }}
              />
              <span className="ps-1">
                <StatusNote status={addStatus} detail={addError} />
              </span>
            </>
          }
          announcement={announcement}
          listRef={listRef}
        />
      </div>
      {archiveTarget && (
        <ArchiveTypeDialog
          target={archiveTarget}
          liveTypes={live}
          api={api}
          messages={messages}
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
