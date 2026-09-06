// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { fitColumnWidths, resizeColumnWidths } from "./table-widths";

const columns = [
  { key: "summary", width: 300, minWidth: 180, flex: true },
  { key: "type", width: 180, minWidth: 100, flex: false },
  { key: "requester", width: 160, minWidth: 100, flex: false },
];

describe("data column space beside pinned actions", () => {
  it("gives the flex column the remaining space", () => {
    expect(fitColumnWidths(columns, 800)).toEqual([460, 180, 160]);
  });
  it("resizes an ordinary column using only Summary's spare space", () => {
    expect(resizeColumnWidths(columns, 800, "type", 230)).toEqual([410, 230, 160]);
    expect(resizeColumnWidths(columns, 800, "type", 1200)).toEqual([180, 460, 160]);
  });
  it("returns freed space to Summary", () => {
    expect(resizeColumnWidths(columns, 800, "requester", 100)).toEqual([520, 180, 100]);
  });
  it("trades only with the next column when Summary itself is dragged", () => {
    expect(resizeColumnWidths(columns, 600, "summary", 1200)).toEqual([340, 100, 160]);
    expect(resizeColumnWidths(columns, 600, "summary", 180)).toEqual([180, 260, 160]);
  });
  it("fits oversized saved widths when the viewport shrinks", () => {
    const fitted = fitColumnWidths(
      columns.map((column) => ({ ...column, flex: false, width: 1000 })),
      500,
    );
    expect(fitted.reduce((sum, width) => sum + width, 0)).toBeCloseTo(500);
    fitted.forEach((width, index) =>
      expect(width).toBeGreaterThanOrEqual(columns[index]!.minWidth),
    );
  });
  it("keeps readable minimums when the data area needs to scroll", () => {
    expect(fitColumnWidths(columns, 250)).toEqual([180, 100, 100]);
  });
});
