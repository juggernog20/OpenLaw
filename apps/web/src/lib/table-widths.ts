// SPDX-License-Identifier: AGPL-3.0-only

interface FittedColumn {
  key: string;
  width: number;
  minWidth: number;
  flex: boolean;
}

/** Fit data columns beside fixed actions. Below their combined minimum, the data scrolls. */
export function fitColumnWidths(columns: readonly FittedColumn[], available: number): number[] {
  const minimum = columns.reduce((sum, column) => sum + column.minWidth, 0);
  const budget = Math.max(minimum, available);
  const widths = columns.map((column) => Math.max(column.minWidth, column.width));
  const flex = columns.findIndex((column) => column.flex);
  if (flex >= 0) {
    const other = widths.reduce((sum, width, index) => sum + (index === flex ? 0 : width), 0);
    widths[flex] = Math.max(columns[flex]!.minWidth, budget - other);
  }
  const excess = widths.reduce((sum, width) => sum + width, 0) - budget;
  if (excess > 0) {
    const spare = widths.reduce((sum, width, index) => sum + width - columns[index]!.minWidth, 0);
    for (let index = 0; index < widths.length; index++) {
      if (spare === 0) continue;
      const slack = widths[index]! - columns[index]!.minWidth;
      widths[index] = Math.max(columns[index]!.minWidth, widths[index]! - (excess * slack) / spare);
    }
  }
  return widths;
}

/** A drag trades width only with the core column, or its neighbour when dragging the core. */
export function resizeColumnWidths(
  columns: readonly FittedColumn[],
  available: number,
  key: string,
  requested: number,
): number[] {
  const widths = fitColumnWidths(columns, available);
  const changed = columns.findIndex((column) => column.key === key);
  const core = columns.findIndex((column) => column.flex);
  if (changed < 0 || core < 0 || columns.length < 2) return widths;
  const partner =
    changed === core ? (changed + 1 < columns.length ? changed + 1 : changed - 1) : core;
  const combined = widths[changed]! + widths[partner]!;
  widths[changed] = Math.max(
    columns[changed]!.minWidth,
    Math.min(requested, combined - columns[partner]!.minWidth),
  );
  widths[partner] = combined - widths[changed]!;
  return widths;
}
