// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-020 list-editor: the shared anatomy for taxonomy settings
 * panes, extracted at its rule-of-three moment (#81 types, #82 statuses,
 * #83 fields). One card edits one taxonomy: the header strip carries the
 * title, the row-count caption, the Show-archived toggle, and the Add
 * CTA; rows are 44px with in-place rename (DES-017), qualifier content
 * beside the name, a right-aligned meta caption, and one trailing action
 * — archive, restore, or the lock on protected rows. Reorder (drag or
 * arrow keys from the grip) and the inline add row are optional: ordered
 * taxonomies pass `reorder`; panes whose creation is one field pass
 * `addRow`, and richer panes open a dialog from the Add CTA instead
 * (DES-021). Archived rows sit greyed behind the toggle in the ST5
 * treatment. The panes own their data, API calls, and guard dialogs —
 * this component owns the anatomy.
 */

import { useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Archive, ArchiveRestore, GripVertical, Lock, Plus } from "lucide-react";
import { SettingsCard } from "./settings-card";
import { StatusNote, type FieldStatus } from "./status-note";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

/** What the anatomy needs from a row; panes extend it freely. */
export interface ListEditorRow {
  id: string;
  displayName: string;
  archivedAt: string | null;
}

export interface ListEditorReorder {
  /** The order commit's state, shown beside the count caption. */
  status: FieldStatus;
  detail?: string;
  /** The grip's accessible name for one row at one position. */
  gripLabel: (row: ListEditorRow, position: number, total: number) => string;
  /** A valid move (bounds already checked): commit it and announce. */
  onMove: (fromIndex: number, toIndex: number) => void;
}

export interface ListEditorProps<Row extends ListEditorRow> {
  /** Live rows, in render order. */
  rows: Row[];
  /** Archived rows, revealed by the Show-archived toggle. */
  archivedRows: Row[];
  title: ReactNode;
  /** The row-count caption content (ICU plural, pane vocabulary). */
  count: ReactNode;
  /** An optional caption before the count (e.g. the pane's scope note). */
  headerCaption?: ReactNode;
  addLabel: ReactNode;
  /** Opens the pane's creation surface — the inline `addRow` or a dialog. */
  onAdd: () => void;
  /** The help caption below the card (DES-020's two non-obvious behaviors). */
  help: ReactNode;
  /** An optional column-header strip above the rows (DES-021 tables). */
  columnsHeader?: ReactNode;
  /** Per-row save state, keyed by row id; drives the row's StatusNote. */
  rowStatus: Record<string, FieldStatus>;
  rowError: Record<string, string | undefined>;
  renameLabel: (row: Row) => string;
  /** Commits an in-place rename; the trimmed draft is never empty. */
  onRename: (row: Row, displayName: string) => void;
  /** Content beside the name: qualifier pills, table columns. */
  rowDetails?: (row: Row) => ReactNode;
  /** Wraps the name cell (e.g. `min-w-0 flex-1` so fixed-width detail
   * cells align as table columns — DES-021); unset renders it bare. */
  nameSlotClassName?: string;
  /** The right-aligned caption (usage counts). */
  rowMeta?: (row: Row) => ReactNode;
  /** Extra trailing icon actions before archive (e.g. an edit button). */
  rowActions?: (row: Row) => ReactNode;
  /** The lock's accessible name for protected rows; null renders archive. */
  protectedLabel?: (row: Row) => string | null;
  archiveLabel: (row: Row) => string;
  /** Opens the pane's SET-003 archive guard. */
  onArchive: (row: Row) => void;
  restoreLabel: (row: Row) => string;
  onRestore: (row: Row) => void;
  /** Drag/arrow-key reorder for ordered taxonomies; omit for catalogs. */
  reorder?: ListEditorReorder;
  /** The inline draft row's content, rendered while `adding` (DES-020's
   * one-field add). Panes with dialog creation leave it out. */
  addRow?: ReactNode;
  adding?: boolean;
  /** Live-region text for keyboard reorder announcements (WCAG 4.1.3). */
  announcement?: string;
  /** The list element, for parking focus when a dialog closes over a
   * row that has left the list. */
  listRef?: RefObject<HTMLUListElement | null>;
}

export function ListEditor<Row extends ListEditorRow>({
  rows,
  archivedRows,
  title,
  count,
  headerCaption,
  addLabel,
  onAdd,
  help,
  columnsHeader,
  rowStatus,
  rowError,
  renameLabel,
  onRename,
  rowDetails,
  nameSlotClassName,
  rowMeta,
  rowActions,
  protectedLabel,
  archiveLabel,
  onArchive,
  restoreLabel,
  onRestore,
  reorder,
  addRow,
  adding = false,
  announcement = "",
  listRef,
}: Readonly<ListEditorProps<Row>>) {
  const intl = useIntl();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const hasArchived = archivedRows.length > 0;

  function commitRename(row: Row, draft: string) {
    setEditing(null);
    const displayName = draft.trim();
    // Nothing to save (or nothing valid): revert per DES-017.
    if (displayName === "" || displayName === row.displayName) return;
    onRename(row, displayName);
  }

  function drop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!reorder || from === null || from === targetIndex || reorder.status === "saving") return;
    reorder.onMove(from, targetIndex);
  }

  function moveBy(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (!reorder || reorder.status === "saving") return;
    if (target < 0 || target >= rows.length) return;
    reorder.onMove(index, target);
  }

  function nameCell(row: Row) {
    if (editing?.id === row.id) {
      return (
        <Input
          autoFocus
          value={editing.draft}
          aria-label={renameLabel(row)}
          className="h-7 w-64 max-w-full"
          onChange={(event) => setEditing({ id: row.id, draft: event.target.value })}
          onBlur={() => commitRename(row, editing.draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename(row, editing.draft);
            if (event.key === "Escape") setEditing(null);
          }}
        />
      );
    }
    return (
      <button
        type="button"
        // In-place rename (DES-017/DES-020): the name IS the editor.
        onClick={() => setEditing({ id: row.id, draft: row.displayName })}
        aria-label={renameLabel(row)}
        className="rounded-chip text-base font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        {row.displayName}
      </button>
    );
  }

  function trailingAction(row: Row) {
    if (row.archivedAt) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5"
          disabled={rowStatus[row.id] === "saving"}
          aria-label={restoreLabel(row)}
          onClick={() => onRestore(row)}
        >
          <ArchiveRestore size={16} aria-hidden="true" className="text-muted" />
        </Button>
      );
    }
    const lockLabel = protectedLabel?.(row) ?? null;
    if (lockLabel !== null) {
      // The lock, not a disabled button (DES-020): protection is a fact
      // about the row, and the server refuses regardless.
      return (
        <span className="flex size-7 items-center justify-center">
          <Lock size={16} role="img" aria-label={lockLabel} className="text-muted" />
        </span>
      );
    }
    return (
      <Button
        variant="ghost"
        size="sm"
        className="px-1.5"
        disabled={rowStatus[row.id] === "saving"}
        aria-label={archiveLabel(row)}
        onClick={() => onArchive(row)}
      >
        <Archive size={16} aria-hidden="true" className="text-muted" />
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SettingsCard
        title={title}
        flush
        actions={
          <div className="flex items-center gap-3">
            {headerCaption && (
              <span className="text-sm whitespace-nowrap text-muted">{headerCaption}</span>
            )}
            {hasArchived && (
              <span className="flex items-center gap-2 text-sm text-muted">
                <FormattedMessage id="listEditor.showArchived" defaultMessage="Show archived" />
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                  aria-label={intl.formatMessage({
                    id: "listEditor.showArchived",
                    defaultMessage: "Show archived",
                  })}
                />
              </span>
            )}
            <span className="text-sm whitespace-nowrap text-muted">{count}</span>
            {reorder && <StatusNote status={reorder.status} detail={reorder.detail} />}
            <Button size="sm" className="px-3 whitespace-nowrap" onClick={onAdd}>
              <Plus size={16} aria-hidden="true" />
              {addLabel}
            </Button>
          </div>
        }
      >
        {/* Keyboard moves are announced here; the row order itself is
            silent to a reader (WCAG 4.1.3). */}
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
        {columnsHeader}
        {/* tabIndex -1: guard dialogs park focus here when the row they
            were opened from has left the list. */}
        <ul ref={listRef} tabIndex={-1}>
          {rows.map((row, index) => (
            <li
              key={row.id}
              draggable={reorder !== undefined && editing?.id !== row.id}
              onDragStart={() => {
                dragFrom.current = index;
              }}
              onDragOver={reorder && ((event) => event.preventDefault())}
              onDrop={reorder && ((event) => drop(event, index))}
              className="flex h-11 items-center border-b border-border-muted pe-3"
            >
              {reorder && (
                <span className="flex w-9 shrink-0 justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-grab px-1"
                    disabled={reorder.status === "saving"}
                    aria-label={reorder.gripLabel(row, index + 1, rows.length)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        moveBy(index, -1);
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        moveBy(index, 1);
                      }
                    }}
                  >
                    <GripVertical size={16} aria-hidden="true" className="text-muted" />
                  </Button>
                </span>
              )}
              <span
                className={`flex min-w-0 flex-1 items-center gap-2 ${reorder ? "ps-1" : "ps-4"}`}
              >
                {nameSlotClassName ? (
                  <span className={nameSlotClassName}>{nameCell(row)}</span>
                ) : (
                  nameCell(row)
                )}
                {rowDetails?.(row)}
              </span>
              {rowMeta && (
                <span className="px-3 text-sm whitespace-nowrap text-muted">{rowMeta(row)}</span>
              )}
              <span className="flex items-center gap-1">
                <StatusNote status={rowStatus[row.id] ?? "idle"} detail={rowError[row.id]} />
                {rowActions?.(row)}
                {trailingAction(row)}
              </span>
            </li>
          ))}
          {adding && addRow && (
            <li
              className={`flex h-11 items-center gap-2 border-b border-border-muted pe-3 ${reorder ? "ps-9" : "ps-4"}`}
            >
              {addRow}
            </li>
          )}
          {showArchived &&
            archivedRows.map((row) => (
              <li key={row.id} className="flex h-11 items-center border-b border-border-muted pe-3">
                <span className={reorder ? "w-9 shrink-0" : "w-4 shrink-0"} aria-hidden="true" />
                {/* ST5's archived treatment: identity at half opacity,
                    a neutral pill, restore in the trailing slot. */}
                <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                  <span className="text-base font-medium text-primary opacity-50">
                    {row.displayName}
                  </span>
                  {rowDetails && (
                    <span className="flex items-center gap-2 opacity-50">{rowDetails(row)}</span>
                  )}
                  <span className="inline-flex rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-status-neutral-fg">
                    <FormattedMessage id="listEditor.archivedPill" defaultMessage="Archived" />
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <StatusNote status={rowStatus[row.id] ?? "idle"} detail={rowError[row.id]} />
                  {trailingAction(row)}
                </span>
              </li>
            ))}
        </ul>
      </SettingsCard>
      <p className="text-sm text-muted">{help}</p>
    </div>
  );
}
