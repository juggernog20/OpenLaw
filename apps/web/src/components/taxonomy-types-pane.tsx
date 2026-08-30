// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The taxonomy Types pane (#85: one machinery, every type table), from
 * the ST6 frame of settings.pen: a configurable type list with the
 * mount's fallback row locked, drag or arrow-key reorder, an inline draft row
 * for add, and the SET-003 archive-guard modal (ST8) with its
 * reassignment select. Every mutation applies immediately on save. The
 * shared anatomy lives in the ListEditor component (DES-020); this
 * component owns the behavior, and each module's pane mounts it with
 * its own vocabulary and API adapter — the Contracts pane (CTR-002)
 * and the Matters pane (MTR-001) are configuration, not copies.
 *
 * **A mount's own columns (DES-020 amendment, ST12).** The three type
 * taxonomies have nothing to say about a row beyond its name and its
 * in-use count, so they draw ST6's one-line row and its right-aligned
 * caption. Request types have the target, so they declare `columns`:
 * the card grows a header strip, the mount's cells sit between the name
 * and the row's actions, and the row grows a second line for the
 * description a requester reads in the portal picker.
 */

import { useRef, useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { History, Pencil, TriangleAlert } from "lucide-react";
import { problem, type ProblemResult } from "../lib/problem";
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
  /** The row's own line, drawn under the name by a pane that asks for
   * it (`columns.description`) and edited on the type editor. */
  description: string | null;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

/**
 * The API seam each module's pane implements over its own routes.
 *
 * The row type is the mount's, not the machinery's: a mount that
 * projects columns of its own — request types project the target —
 * names them here, and its columns then read them without a cast. A
 * mount with nothing extra takes the default and is unchanged.
 */
export interface TaxonomyPaneApi<Row extends TaxonomyPaneRow = TaxonomyPaneRow> {
  create(displayName: string): Promise<ProblemResult<Row>>;
  rename(id: string, displayName: string): Promise<ProblemResult<Row>>;
  reorder(ids: string[]): Promise<ProblemResult<Row[]>>;
  archive(id: string, reassignToId?: string): Promise<ProblemResult<Row>>;
  restore(id: string): Promise<ProblemResult<Row>>;
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
  /** The right-aligned usage caption ("3 matters"). A mount whose
   * records do not exist yet, and which therefore has nothing but a
   * zero to print, omits it and draws no caption at all. */
  inUse?: MessageDescriptor;
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

/**
 * The per-row editor affordance: the screen URL and its "Edit {name}"
 * label travel together, so a mount either has a working edit action or
 * none — never a labelled button with nowhere to go. A module with no
 * per-row editor omits the pair.
 */
export interface TaxonomyPaneEditor<Row extends TaxonomyPaneRow = TaxonomyPaneRow> {
  path: (row: Row) => string;
  label: MessageDescriptor;
}

/**
 * The mount's system-protected row, mirroring the API's `protectedSlug`
 * (#351): the slug archive and delete refuse, and the lock's accessible
 * name. The three type taxonomies pass `other`, so a non-null fallback
 * type always exists.
 *
 * A mount with no fallback row omits the pair and locks nothing —
 * request types have none, because no record needs a non-null request
 * type once conversion is done. The slug and its label travel together
 * for the reason the editor pair does: a lock with no explanation is
 * an unreadable refusal.
 */
export interface TaxonomyPaneProtectedRow {
  slug: string;
  label: MessageDescriptor;
}

/** One of a mount's own columns, drawn between the name and the row's
 * actions. The header and the cell share the width class, so the strip
 * and the rows line up as one table (DES-021). */
export interface TaxonomyPaneColumn<Row extends TaxonomyPaneRow = TaxonomyPaneRow> {
  header: MessageDescriptor;
  /** The cell's sr-only prefix (DES-021's table variant): a row named
   * "Contract review" whose target reads "Contract" is two different
   * facts, and a reader needs the column named to tell them apart. */
  prefix: MessageDescriptor;
  /** The shared width, e.g. `w-40` — one class, two places. */
  width: string;
  cell: (row: Row) => ReactNode;
}

/**
 * A mount's own columns (DES-020 amendment, ST12).
 *
 * The three type taxonomies declare none: their rows are one line with
 * a right-aligned in-use caption, which is what ST6 draws. Request
 * types declare a Target column, and the caption they would draw says
 * "0 requests" on every row until M20 — so the columns take its place,
 * the card grows a header strip to name them, and each row grows a
 * second line for the description a requester reads in the portal.
 */
export interface TaxonomyPaneColumns<Row extends TaxonomyPaneRow = TaxonomyPaneRow> {
  /** The header over the name cell — "Request type". */
  name: MessageDescriptor;
  /** The mount's columns, in draw order. */
  meta: readonly TaxonomyPaneColumn<Row>[];
  /** Draw each row's description under its name (ST12's two-line row). */
  description?: boolean;
}

const byDisplayOrder = (a: TaxonomyPaneRow, b: TaxonomyPaneRow) => a.displayOrder - b.displayOrder;

function ArchiveTypeDialog<Row extends TaxonomyPaneRow>({
  target,
  liveTypes,
  api,
  messages,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: Row;
  /** Reassignment candidates: every live type but the target. */
  liveTypes: Row[];
  api: TaxonomyPaneApi<Row>;
  messages: TaxonomyPaneMessages;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: Row) => void;
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

export function TaxonomyTypesPane<Row extends TaxonomyPaneRow = TaxonomyPaneRow>({
  initialRows,
  tabs,
  editor,
  protectedRow,
  columns,
  api,
  messages,
}: Readonly<{
  initialRows: Row[];
  /** The module's section head (title + tab strip). */
  tabs: ReactNode;
  /** Each row's editor screen and label; omit for modules without one. */
  editor?: TaxonomyPaneEditor<Row>;
  /** The mount's fallback row; omit for modules that have none. */
  protectedRow?: TaxonomyPaneProtectedRow;
  /** The mount's own columns; omit for the one-line ST6 anatomy. */
  columns?: TaxonomyPaneColumns<Row>;
  api: TaxonomyPaneApi<Row>;
  messages: TaxonomyPaneMessages;
}>) {
  const intl = useIntl();
  const navigate = useNavigate();

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<Row | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const createInFlight = useRef(false);

  const live = rows.filter((row) => !row.archivedAt).sort(byDisplayOrder);
  const archived = rows.filter((row) => row.archivedAt).sort(byDisplayOrder);

  // A const binding, so the `inUse &&` guard below narrows inside the
  // rowMeta closure — a property access would not.
  const inUse = messages.inUse;

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: Row) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: Row, displayName: string) {
    noteRow(row.id, "saving");
    const { data, detail } = await api
      .rename(row.id, displayName)
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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
        .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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

  async function restore(row: Row) {
    noteRow(row.id, "saving");
    const { data, detail } = await api
      .restore(row.id)
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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
          columnsHeader={
            columns && (
              <div className="flex h-9 items-center border-b border-border-default pe-3 text-xs font-semibold text-muted">
                {/* The grip column has no header, and neither do the
                    trailing actions (ST12). */}
                <span className="w-9 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                  <span className="min-w-0 flex-1">
                    <FormattedMessage {...columns.name} />
                  </span>
                  {columns.meta.map((column) => (
                    <span key={column.header.id} className={`${column.width} shrink-0`}>
                      <FormattedMessage {...column.header} />
                    </span>
                  ))}
                </span>
                <span className="w-15" aria-hidden="true" />
              </div>
            )
          }
          nameSlotClassName={columns ? "min-w-0 flex-1" : undefined}
          rowCaption={columns?.description ? (row) => row.description : undefined}
          rowDetails={
            columns
              ? (row) =>
                  columns.meta.map((column) => (
                    <span
                      key={column.header.id}
                      className={`${column.width} shrink-0 truncate text-sm text-muted`}
                    >
                      <span className="sr-only">
                        <FormattedMessage {...column.prefix} />{" "}
                      </span>
                      {column.cell(row)}
                    </span>
                  ))
              : undefined
          }
          rowMeta={
            inUse && ((row) => <FormattedMessage {...inUse} values={{ count: row.inUseCount }} />)
          }
          rowActions={
            editor &&
            ((row) => (
              // Each row's own editor screen — fields attach there,
              // and the description lives there, not in the list.
              <Button
                variant="ghost"
                size="sm"
                className="px-1.5"
                aria-label={intl.formatMessage(editor.label, { name: row.displayName })}
                onClick={() => void navigate(editor.path(row))}
              >
                <Pencil size={16} aria-hidden="true" className="text-muted" />
              </Button>
            ))
          }
          protectedLabel={(row) =>
            protectedRow && row.slug === protectedRow.slug
              ? intl.formatMessage(protectedRow.label, { name: row.displayName })
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
