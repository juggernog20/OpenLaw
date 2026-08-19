// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The vocabulary behind a managed list table and its saved views
 * (DD-019, DES-046).
 *
 * A **catalogue** is what a surface knows how to draw: every column it
 * could show, with the width it starts at, the floor it will not go
 * below, and whether the list can be sorted by it. A **layout** is what
 * the reader is looking at right now: which of those columns, in what
 * order, at what widths, under which filters, sorted how. A **view** is a
 * layout with a name, saved on the server.
 *
 * The catalogue is the surface's contract with its own saved views. A
 * stored layout is just data, and it may name a column this build no
 * longer has — DD-019 clause 7 makes reading past that the page's job, so
 * `resolveLayout` below is the one place a stored layout is trusted, and
 * it trusts nothing it cannot draw.
 */

import type { ReactNode } from "react";
import type { IntlShape } from "react-intl";
import type { ListViewSurface, SortDirection } from "@openlaw/shared";
import { api } from "./api";

/** One column a surface can draw. */
export interface ColumnDef<Row> {
  /** Stable identity, and what a saved layout stores. Renaming one
   * orphans it out of every view that named it, which is why these read
   * like field names and not like headings. */
  key: string;
  /** The column heading, as an ICU message element (DES-013). */
  header: ReactNode;
  /** The same heading as a plain string, for the column menu's rows, the
   * resize handle's label, and the sort button's accessible name — none
   * of which can take an element. */
  label: (intl: IntlShape) => string;
  /** Where the column starts, in px. Every column has one, including the
   * one that stretches: stretching is a layout's choice, not a column's
   * nature, so the number is what the column takes the moment the reader
   * pins it (DES-046 clause 1). */
  defaultWidth: number;
  /** The narrowest a drag or a keypress may take it. */
  minWidth: number;
  /** Trailing alignment for a column of actions. */
  align?: "start" | "end";
  /**
   * The cell holds a shape rather than a text run — a status pill — so it
   * clips at the column edge instead of ending in an ellipsis (DES-046
   * clause 2).
   *
   * An ellipsis is a typographic mark, and it reads as "this text carries
   * on" only while it is sitting at the end of text. Put it on a pill and
   * it lands inside a coloured shape whose rounded end has been eaten to
   * make room for it, which reads as a broken pill rather than as a long
   * status name. A clean vertical cut at the column edge is the honest
   * mark: the shape is whole as far as it goes, and the table scrolls
   * sideways to the rest of it.
   */
  clip?: boolean;
  /** A column the reader may not hide — the list is unreadable without
   * it, so the menu shows it checked and disabled. */
  required?: boolean;
  /**
   * The API sort key this column orders by, when the list can order by
   * it at all. Absent means the header is plain text: several columns are
   * derived at read and no index can serve them (CTR-006).
   */
  sortKey?: string;
  /** The cell. */
  render: (row: Row, intl: IntlShape) => ReactNode;
}

/** Everything one surface can draw, and how it draws by default. */
export interface ColumnCatalogue<Row> {
  surface: ListViewSurface;
  columns: ColumnDef<Row>[];
  /** The built-in layout's columns, in order. Code rather than a seeded
   * row, so nobody starts with views to delete (DD-019 clause 7). */
  defaultColumnKeys: string[];
  /** Which column stretches in the built-in layout, and the one "Fill the
   * width" hands the spare space back to. The column whose content is
   * longest and least predictable — Title on contracts. */
  flexColumnKey: string;
}

/** One column as a layout holds it. */
export interface LayoutColumn {
  key: string;
  /** The pinned width in px. `null` in a layout stored before every column
   * carried one; resolved to the catalogue default on read. */
  width: number | null;
}

/** What the reader is looking at. The saved shape and the live shape are
 * the same shape, which is what lets "is this modified?" be one
 * comparison rather than a diff of two vocabularies. */
export interface Layout {
  columns: LayoutColumn[];
  /**
   * Which shown column stretches to absorb the card's spare width, or
   * `null` for none — in which case the spare width is trailing space
   * (DES-046 clause 1).
   *
   * This is a layout's choice rather than a column's nature, because a
   * column cannot both absorb spare width and be dragged narrower than
   * that width makes it. Dragging the stretching column is therefore what
   * sets this to `null`, and "Fill the width" is what sets it back.
   */
  flexKey: string | null;
  sort: { key: string; dir: SortDirection } | null;
  filters: Record<string, boolean | string>;
}

/**
 * A layout as the server holds it: a `Layout` whose `flexKey` may be
 * absent, because a config stored before that field existed is still a
 * config (DD-019 clause 7). `resolveLayout` is the one place that reads
 * one, and what it answers is a whole `Layout`.
 */
export type StoredLayout = Omit<Layout, "flexKey"> & { flexKey?: string | null };

/** One saved view as the API answers it. */
export interface SavedView {
  id: string;
  name: string;
  isDefault: boolean;
  layout: StoredLayout;
}

/** The layout a surface draws when no view is active. */
export function builtInLayout<Row>(catalogue: ColumnCatalogue<Row>): Layout {
  return {
    columns: catalogue.defaultColumnKeys.flatMap((key) => {
      const column = catalogue.columns.find((candidate) => candidate.key === key);
      return column ? [{ key, width: column.defaultWidth }] : [];
    }),
    flexKey: catalogue.flexColumnKey,
    sort: null,
    filters: {},
  };
}

/**
 * A stored layout, narrowed to what this build can actually draw
 * (DD-019 clause 7).
 *
 * Four ways a stored layout can be stale, and each is read past rather
 * than refused:
 *
 * - a column key the catalogue no longer has — dropped;
 * - the same key twice — kept once, at its first position;
 * - a sort key no column offers — cleared back to the natural order;
 * - a required column left out — put back, at the end;
 * - a stretching column that is not shown — nothing stretches.
 *
 * The last one is why this returns a layout and not a validity flag: a
 * contracts list with no Title is not a shorter list, it is a broken one,
 * and the reader should get their view with the Title restored rather than
 * an error page.
 */
export function resolveLayout<Row>(catalogue: ColumnCatalogue<Row>, stored: StoredLayout): Layout {
  const seen = new Set<string>();
  const columns: LayoutColumn[] = [];
  for (const column of stored.columns) {
    const known = catalogue.columns.find((candidate) => candidate.key === column.key);
    if (!known || seen.has(column.key)) continue;
    seen.add(column.key);
    // A layout stored before every column carried a width has nulls in it.
    // The catalogue's own number is the honest reading of those.
    columns.push({ key: column.key, width: column.width ?? known.defaultWidth });
  }
  for (const column of catalogue.columns) {
    if (column.required === true && !seen.has(column.key)) {
      seen.add(column.key);
      columns.push({ key: column.key, width: column.defaultWidth });
    }
  }
  // A layout that resolved to nothing is not a table. Falling back to the
  // built-in one is the only answer that leaves a page to look at.
  if (columns.length === 0) return builtInLayout(catalogue);

  const sortable = new Set(
    catalogue.columns.flatMap((column) => (column.sortKey === undefined ? [] : [column.sortKey])),
  );
  return {
    columns,
    // Nothing stretches unless the column that says it does is on screen.
    // A layout stored before this field existed reads as nothing, which is
    // the reading that cannot surprise anybody by moving a column.
    flexKey: typeof stored.flexKey === "string" && seen.has(stored.flexKey) ? stored.flexKey : null,
    sort: stored.sort && sortable.has(stored.sort.key) ? stored.sort : null,
    filters: stored.filters,
  };
}

/**
 * Whether two layouts are the same list.
 *
 * This is what the views menu's "Modified" marker reads (DES-046 clause
 * 6), so it compares the whole of a layout in a fixed order — a filter
 * map that serialized its keys differently must not read as a change the
 * reader made.
 */
export function sameLayout(a: Layout, b: Layout): boolean {
  const filters = (layout: Layout) =>
    Object.entries(layout.filters)
      .filter(([, value]) => value !== false && value !== "")
      .sort(([left], [right]) => left.localeCompare(right));
  return (
    // Positional, so a layout stored before `flexKey` existed — which
    // reads as undefined and serializes as null, the same as "nothing
    // stretches" — does not read as a change the reader made.
    JSON.stringify([a.columns, a.sort, filters(a), a.flexKey]) ===
    JSON.stringify([b.columns, b.sort, filters(b), b.flexKey])
  );
}

/**
 * The columns a layout shows, resolved to their definitions and in the
 * layout's own order.
 *
 * `width` is the column's pinned width, which every column has. `flex`
 * says this is the one column rendering without that width, because it is
 * absorbing the card's spare space instead.
 */
export function shownColumns<Row>(
  catalogue: ColumnCatalogue<Row>,
  layout: Layout,
): { def: ColumnDef<Row>; width: number; flex: boolean }[] {
  return layout.columns.flatMap((column) => {
    const def = catalogue.columns.find((candidate) => candidate.key === column.key);
    return def
      ? [
          {
            def,
            width: column.width ?? def.defaultWidth,
            flex: layout.flexKey === column.key,
          },
        ]
      : [];
  });
}

/**
 * The table's own minimum width, in px (DES-046 clause 1).
 *
 * Every pinned column's width, plus the stretching column's floor rather
 * than its width — a stretching column has no width of its own until it
 * runs out of room, and this is the number that says when that is. This is
 * what the old contracts table did not have: without it, width hints
 * summing past the container leave the stretching column nothing, and the
 * one column carrying the record's name collapses to its longest word.
 * With it the card scrolls sideways instead.
 */
export function tableMinWidth<Row>(catalogue: ColumnCatalogue<Row>, layout: Layout): number {
  return shownColumns(catalogue, layout).reduce(
    (total, { def, width, flex }) => total + (flex ? def.minWidth : width),
    0,
  );
}

/** One view as the seam answers it. */
interface ViewResponse {
  id: string;
  name: string;
  isDefault: boolean;
  config: StoredLayout;
}

const toView = (row: ViewResponse): SavedView => ({
  id: row.id,
  name: row.name,
  isDefault: row.isDefault,
  layout: row.config,
});

/** This person's views of one surface. A failed read answers an empty
 * list rather than throwing: views are a convenience, and a list that
 * would not render because a preference read failed is worse than a list
 * with no saved views in its menu. */
export async function readViews(surface: ListViewSurface): Promise<SavedView[]> {
  const { data } = await api
    .GET("/api/v1/list-views", { params: { query: { surface } } })
    .catch(() => ({ data: undefined }));
  return (data?.views ?? []).map((row) => toView(row as ViewResponse));
}

export async function createView(
  surface: ListViewSurface,
  name: string,
  layout: Layout,
  isDefault = false,
): Promise<SavedView[]> {
  const { data, error } = await api.POST("/api/v1/list-views", {
    body: { surface, name, config: layout, isDefault },
  });
  if (!data) throw error ?? new Error("The view could not be saved.");
  return data.views.map((row) => toView(row as ViewResponse));
}

export async function updateView(
  viewId: string,
  changes: { name?: string; config?: Layout; isDefault?: boolean },
): Promise<SavedView[]> {
  const { data, error } = await api.PATCH("/api/v1/list-views/{viewId}", {
    params: { path: { viewId } },
    body: changes,
  });
  if (!data) throw error ?? new Error("The view could not be changed.");
  return data.views.map((row) => toView(row as ViewResponse));
}

export async function deleteView(viewId: string): Promise<SavedView[]> {
  const { data, error } = await api.DELETE("/api/v1/list-views/{viewId}", {
    params: { path: { viewId } },
  });
  if (!data) throw error ?? new Error("The view could not be deleted.");
  return data.views.map((row) => toView(row as ViewResponse));
}
