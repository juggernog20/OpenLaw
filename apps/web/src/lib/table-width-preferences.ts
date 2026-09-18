// SPDX-License-Identifier: AGPL-3.0-only

import { builtInLayout, type Layout, type TableCatalogue } from "./list-views";

const storageKey = (userId: string, table: string) =>
  `openlaw:table-widths:v1:${encodeURIComponent(userId)}:${table}`;

/** Restore widths without persisting record data, filters, or column visibility. */
export function readTableWidths<Row>(
  userId: string,
  table: string,
  catalogue: TableCatalogue<Row>,
): Layout {
  const layout = builtInLayout(catalogue);
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(userId, table)) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return layout;
    const widths = stored as Record<string, unknown>;
    return {
      ...layout,
      columns: layout.columns.map((column) => {
        const width = widths[column.key];
        const definition = catalogue.columns.find((item) => item.key === column.key)!;
        return {
          ...column,
          width:
            typeof width === "number" && Number.isFinite(width) && width > 0
              ? Math.max(definition.minWidth, Math.min(1200, Math.round(width)))
              : column.width,
        };
      }),
    };
  } catch {
    return layout;
  }
}

export function writeTableWidths(userId: string, table: string, layout: Layout): void {
  try {
    localStorage.setItem(
      storageKey(userId, table),
      JSON.stringify(Object.fromEntries(layout.columns.map(({ key, width }) => [key, width]))),
    );
  } catch {
    // The table remains usable when browser storage is unavailable.
  }
}
