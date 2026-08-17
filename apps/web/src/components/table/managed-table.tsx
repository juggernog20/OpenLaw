// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The managed list table (DES-046): a table whose columns the reader
 * chooses, orders, resizes, and sorts.
 *
 * **Widths are real, and the table has a floor** (DES-046 clause 1).
 * `table-layout: fixed` with a `<colgroup>` means a `<col>` width is the
 * column's width rather than a hint the browser may ignore. The table's
 * own `min-width` is the sum of those widths, so when they outgrow the
 * card the card scrolls sideways. That floor is the whole cure for the
 * cramped table this replaced, where width hints summing past the
 * container left the Title column its longest word and nothing else.
 *
 * **Where the card's spare width goes is the layout's choice.** One shown
 * column may stretch to absorb it — Title, by default, on contracts — and
 * dragging that column pins it, because nothing can both absorb the spare
 * width and be dragged narrower than that width makes it. When no column
 * stretches, the trailing filler column absorbs it instead, and every real
 * column keeps exactly the width it says it has.
 *
 * **Cells truncate, never wrap** (clause 2), so a row is one line tall and
 * thirty rows scan as thirty rows.
 *
 * **The resize handle is a keyboard control that also takes a drag**
 * (clause 3), which is why it is a `role="separator"` with a width in
 * `aria-valuenow` rather than a `div` with a mousedown listener.
 *
 * The component owns no layout state. It draws the layout it is given and
 * says what the reader asked for, because the page holds the layout that
 * a saved view is compared against (DD-019 clause 5).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIntl, FormattedMessage } from "react-intl";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortDirection } from "@openlaw/shared";
import {
  shownColumns,
  tableMinWidth,
  type ColumnCatalogue,
  type ColumnDef,
  type Layout,
} from "../../lib/list-views";

/** How far one arrow key moves a column edge, and how far with Shift
 * held. Sixteen is the spacing scale's four steps — enough to see, small
 * enough to land on a width you meant (DES-007). */
const NUDGE = 16;
const NUDGE_FAST = 64;

export function ManagedTable<Row>({
  catalogue,
  layout,
  rows,
  rowKey,
  onLayoutChange,
  focusRowKey,
  foot,
  actionsColumn,
}: Readonly<{
  catalogue: ColumnCatalogue<Row>;
  layout: Layout;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Where a width change or a sort press goes. The page owns the
   * layout, so the table only ever asks. */
  onLayoutChange: (next: Layout) => void;
  /** The row focus moves to once it exists — the first of a page that
   * was just appended, because that is where the answer starts
   * (DES-031). */
  focusRowKey?: string;
  /** The paging foot, under the table's last rule and outside its
   * sideways scroll, so it never slides out of reach (DES-031). */
  foot?: ReactNode;
  /**
   * A trailing column of row actions that is not part of the catalogue:
   * it exists because an action exists, not because a reader chose it, so
   * it is never in a saved view and never in the column menu.
   */
  actionsColumn?: {
    /** The accessible name of a column whose heading is drawn empty. */
    label: string;
    width: number;
    render: (row: Row) => ReactNode;
  };
}>) {
  const intl = useIntl();
  const shown = shownColumns(catalogue, layout);
  /** Whether a real column is absorbing the card's spare width. When none
   * is, the filler column absorbs it as trailing space. */
  const flexing = shown.some(({ flex }) => flex);
  const landing = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focusRowKey !== undefined) landing.current?.focus();
  }, [focusRowKey]);

  /**
   * Commit a new width for one column, floored at its own minimum.
   *
   * Dragging the stretching column pins it. It has to: a column cannot
   * both absorb the card's spare width and be dragged narrower than that
   * width makes it, so the drag is the reader saying they want the number
   * instead (DES-046 clause 1). The spare width becomes trailing space,
   * and "Fill the width" in the column menu hands it back.
   */
  function resize(key: string, width: number) {
    const def = catalogue.columns.find((candidate) => candidate.key === key);
    if (!def) return;
    onLayoutChange({
      ...layout,
      flexKey: layout.flexKey === key ? null : layout.flexKey,
      columns: layout.columns.map((column) =>
        column.key === key
          ? { ...column, width: Math.max(def.minWidth, Math.round(width)) }
          : column,
      ),
    });
  }

  /**
   * Cycle one column's sort: ascending, then descending, then off.
   *
   * Off is the list's natural order, which is a meaningful state and so
   * has to be reachable — on contracts it is newest reference first
   * (CTR-024), and a two-state toggle would strand it after the first
   * press (DES-046 clause 5).
   */
  function toggleSort(sortKey: string) {
    const current = layout.sort;
    const next: Layout["sort"] =
      current?.key !== sortKey
        ? { key: sortKey, dir: "asc" }
        : current.dir === "asc"
          ? { key: sortKey, dir: "desc" }
          : null;
    onLayoutChange({ ...layout, sort: next });
  }

  // The real columns, the filler, and the actions column if there is one.
  const totalColumns = shown.length + 1 + (actionsColumn ? 1 : 0);

  return (
    <div className="rounded-card border border-border-default bg-raised">
      {/* The sideways scroll belongs to the table, not to the card: the
          paging foot below must not slide out of reach (DES-031). */}
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed"
          style={{
            minWidth: `${String(tableMinWidth(catalogue, layout) + (actionsColumn?.width ?? 0))}px`,
          }}
        >
          {/* Where a width becomes a width, and where the card's spare
              width goes. Exactly one <col> here may go without a width,
              because a fixed-layout table splits the spare width equally
              between every column that has none — so the filler is given a
              hard 0 whenever a real column is the one stretching. */}
          <colgroup>
            {shown.map(({ def, width, flex }) => (
              <col key={def.key} style={flex ? undefined : { width: `${String(width)}px` }} />
            ))}
            <col style={flexing ? { width: 0 } : undefined} />
            {actionsColumn && <col style={{ width: `${String(actionsColumn.width)}px` }} />}
          </colgroup>
          <thead>
            <tr className="bg-section-header text-start text-sm font-medium text-muted">
              {/* Every column is resizable, the stretching one included.
                  The filler to their trailing side is what makes that true:
                  there is always something on the other side of a boundary
                  to give width to. */}
              {shown.map(({ def, width, flex }, index) => {
                const sortKey = def.sortKey;
                return (
                  <HeaderCell
                    key={def.key}
                    def={def}
                    intl={intl}
                    sort={
                      sortKey !== undefined && layout.sort?.key === sortKey ? layout.sort.dir : null
                    }
                    onSort={sortKey === undefined ? undefined : () => toggleSort(sortKey)}
                    resize={{
                      // A stretching column's pinned number is not what it
                      // is rendering at, so the handle measures the cell
                      // rather than trusting this. It is the fallback until
                      // the first measurement lands.
                      width,
                      measure: flex,
                      // The last column's trailing edge can be the table's
                      // own, because the filler collapses to nothing
                      // whenever a real column is stretching. There is
                      // nothing outside that edge to straddle into.
                      flush: index === shown.length - 1 && !actionsColumn,
                      commit: (next) => resize(def.key, next),
                    }}
                  />
                );
              })}
              <FillerCell head />
              {actionsColumn && (
                <th scope="col" className="px-4 py-2 text-end font-medium">
                  <span className="sr-only">{actionsColumn.label}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  // Focusable only while it is the landing row: a table of
                  // fifty tab stops nobody asked for is worse than none.
                  ref={key === focusRowKey ? landing : undefined}
                  tabIndex={key === focusRowKey ? -1 : undefined}
                  className="border-t border-border-default"
                >
                  {shown.map(({ def }) => (
                    <td
                      key={def.key}
                      className={`truncate px-4 py-2.5 text-sm ${def.align === "end" ? "text-end" : ""}`}
                    >
                      {def.render(row, intl)}
                    </td>
                  ))}
                  <FillerCell />
                  {actionsColumn && (
                    <td className="px-4 py-2.5 text-end">{actionsColumn.render(row)}</td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr className="border-t border-border-default">
                {/* A sorted or filtered list with no rows is not the
                    module's empty state — the reader narrowed it, and the
                    row that says so belongs inside the table they
                    narrowed. */}
                <td colSpan={totalColumns} className="px-4 py-8 text-center text-sm text-muted">
                  <FormattedMessage
                    id="table.noMatchingRows"
                    defaultMessage="No rows match the current filters."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {foot && (
        <div className="flex items-center justify-between gap-3 border-t border-border-default px-4 py-3">
          {foot}
        </div>
      )}
    </div>
  );
}

/**
 * The trailing column that holds nothing (DES-046 clause 1).
 *
 * It is what lets every real column keep the width the reader dragged it
 * to: the card's spare width goes here rather than being shared out over
 * columns that would then stop being the size they say they are. It also
 * gives the last real column something on its trailing side, which is what
 * makes that column resizable at all.
 *
 * Hidden from assistive technology, and no padding of its own, because it
 * is space rather than a column of blank values — at zero width it must
 * take zero width.
 */
function FillerCell({ head = false }: Readonly<{ head?: boolean }>) {
  return head ? (
    <th aria-hidden="true" className="p-0" />
  ) : (
    <td aria-hidden="true" className="p-0" />
  );
}

/** One heading: the sort affordance, and the resize handle on its
 * trailing edge. */
function HeaderCell<Row>({
  def,
  intl,
  sort,
  onSort,
  resize,
}: Readonly<{
  def: ColumnDef<Row>;
  intl: ReturnType<typeof useIntl>;
  sort: SortDirection | null;
  onSort?: () => void;
  resize: { width: number; measure: boolean; flush: boolean; commit: (next: number) => void };
}>) {
  return (
    <th
      scope="col"
      // The column's name, said once. Without this the cell's name is
      // computed from what is inside it, which includes the resize
      // handle's own label — so every heading announced as "Reference
      // Width of the Reference column", and every cell under it was
      // associated with that.
      aria-label={def.label(intl)}
      // `relative`, because the resize handle sits on this cell's own
      // trailing edge rather than between two cells — a table has no gap
      // between columns to put it in.
      className={`relative px-4 py-2 font-medium ${def.align === "end" ? "text-end" : "text-start"}`}
      aria-sort={sort === null ? undefined : sort === "asc" ? "ascending" : "descending"}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className="group flex w-full items-center gap-1 truncate rounded-chip text-start font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <span className="truncate">{def.header}</span>
          {sort === null ? (
            // Only on hover or focus: an unsorted column advertising that
            // it could be sorted on every row of the strip is noise.
            <ChevronsUpDown
              size={16}
              aria-hidden="true"
              className="shrink-0 text-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          ) : sort === "asc" ? (
            <ArrowUp size={16} aria-hidden="true" className="shrink-0" />
          ) : (
            <ArrowDown size={16} aria-hidden="true" className="shrink-0" />
          )}
        </button>
      ) : (
        <span className="block truncate">{def.header}</span>
      )}
      <ResizeHandle
        def={def}
        intl={intl}
        width={resize.width}
        measure={resize.measure}
        flush={resize.flush}
        commit={resize.commit}
      />
    </th>
  );
}

/**
 * The column edge (DES-046 clause 3).
 *
 * A `separator` with a width, so the keyboard path is the element itself
 * rather than an alternative bolted beside it. The 9px pointer target is
 * the recorded exception to DES-011's 24×24 minimum: a 24px strip would
 * swallow the sort press on the same cell, and what makes this reachable
 * without a pointer is the arrow keys, not a bigger box.
 */
function ResizeHandle<Row>({
  def,
  intl,
  width,
  measure,
  flush,
  commit,
}: Readonly<{
  def: ColumnDef<Row>;
  intl: ReturnType<typeof useIntl>;
  /** The column's pinned width. */
  width: number;
  /** This column is stretching, so its pinned width is not what it is
   * rendering at, and an interaction has to start from the cell. */
  measure: boolean;
  /**
   * This edge is the table's own trailing edge, so the strip sits wholly
   * inside the cell instead of straddling.
   *
   * A straddling strip hangs 4px past the cell, which is normally the next
   * column's business. At the table's edge it is nothing's business: it
   * becomes 4px of scrollable overflow, and the card grows a sideways
   * scrollbar for a table that fits. The strip keeps its 9px either way —
   * only which side of the rule it takes them from changes.
   */
  flush: boolean;
  commit: (next: number) => void;
}>) {
  /** The width while a drag is in flight. Local, so a drag paints at
   * pointer speed without asking the page to re-render its list on every
   * pixel; the page hears the result once, on release. */
  const [dragging, setDragging] = useState<{ from: number; startedAt: number } | null>(null);
  const live = useRef(width);
  const handle = useRef<HTMLSpanElement>(null);

  /**
   * The width an adjustment starts from.
   *
   * A pinned column renders at its number, so the number is the answer. A
   * stretching one is whatever the card had spare, so the cell is measured
   * — otherwise the first nudge would jump the column from 900px back to
   * the 280px it has not been using.
   */
  function startWidth() {
    const cell = handle.current?.parentElement;
    if (!measure || !cell) return width;
    return Math.round(cell.getBoundingClientRect().width);
  }

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      live.current = Math.max(def.minWidth, dragging.startedAt + (event.clientX - dragging.from));
      commit(live.current);
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, def.minWidth, commit]);

  const label = intl.formatMessage(
    { id: "table.resizeColumn", defaultMessage: "Width of the {column} column" },
    { column: def.label(intl) },
  );

  return (
    <span
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      // A stretching column has no width of its own to report: the number
      // above is what it takes the moment an adjustment pins it.
      aria-valuetext={
        measure
          ? intl.formatMessage({
              id: "table.fillsWidth",
              defaultMessage: "Fills the remaining width",
            })
          : undefined
      }
      aria-valuemin={def.minWidth}
      tabIndex={0}
      // -end-1 straddles the rule, so the grab area covers both sides of
      // the visible edge rather than sitting inside one column. At the
      // table's own edge it cannot: the strip takes its 9px from the inner
      // side and puts the rule at its end. The strip itself stays
      // invisible; the child below is the part you see.
      className={`group absolute top-0 flex h-full w-[9px] cursor-col-resize touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link ${
        flush ? "end-0 justify-end" : "-end-1 justify-center"
      }`}
      onPointerDown={(event) => {
        // Primary button only, and never a press that is really a sort
        // click that landed a pixel wide.
        if (event.button !== 0) return;
        event.preventDefault();
        setDragging({ from: event.clientX, startedAt: startWidth() });
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? NUDGE_FAST : NUDGE;
        const from = startWidth();
        if (event.key === "ArrowLeft") commit(from - step);
        else if (event.key === "ArrowRight") commit(from + step);
        else if (event.key === "Home") commit(def.defaultWidth);
        else return;
        // Only once a key did something: Tab and Escape stay the
        // browser's and the dialog's business (DES-010).
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {/* The line the reader aims at. It sits at the strip's centre, which
          is the column boundary, and it is drawn at rest in the same colour
          as every other rule in the table — a draggable edge has to look
          like an edge before anyone reaches for it. Under the pointer, on
          focus, and for the length of a drag it firms up one step. */}
      <span
        aria-hidden="true"
        className={`w-px transition-colors duration-150 group-hover:bg-border-strong group-focus-visible:bg-border-strong ${
          dragging ? "bg-border-strong" : "bg-border-default"
        }`}
      />
    </span>
  );
}
