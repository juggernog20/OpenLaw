// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTrackedChangesDocx } from "./change-model.js";

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`../../testing/fixtures/doc-engine/${name}`, import.meta.url)),
  );
}

describe("parseTrackedChangesDocx", () => {
  it("reads document paragraphs, Word numbering, tracked changes, and table cells", () => {
    expect(parseTrackedChangesDocx(fixture("change-model.docx"))).toEqual({
      paragraphs: [
        {
          index: 0,
          style: "heading",
          label: null,
          runs: [{ text: "Agreement terms", change: "unchanged" }],
        },
        {
          index: 1,
          style: "body",
          label: "1.",
          runs: [{ text: "Definitions apply.", change: "unchanged" }],
        },
        {
          index: 2,
          style: "body",
          label: "2.4",
          runs: [
            { text: "2.4 Liability cap is ", change: "unchanged" },
            { text: "ten million", change: "deleted" },
            { text: ".", change: "unchanged" },
          ],
        },
        {
          index: 3,
          style: "body",
          label: null,
          runs: [
            { text: "The term includes ", change: "unchanged" },
            { text: "two extensions", change: "inserted" },
            { text: ".", change: "unchanged" },
          ],
        },
        {
          index: 4,
          style: "body",
          label: null,
          runs: [
            { text: "Notice is ", change: "unchanged" },
            { text: "thirty days", change: "deleted" },
            { text: "sixty days", change: "inserted" },
            { text: ".", change: "unchanged" },
          ],
        },
        {
          index: 5,
          style: "body",
          label: null,
          runs: [{ text: "Table unchanged", change: "unchanged" }],
        },
        {
          index: 6,
          style: "body",
          label: null,
          runs: [{ text: "Added cell text", change: "inserted" }],
        },
      ],
      changes: [
        {
          id: "change-1",
          paragraphIndex: 2,
          kind: "deleted",
          ref: "2.4",
          excerpt: "ten million",
        },
        {
          id: "change-2",
          paragraphIndex: 3,
          kind: "inserted",
          ref: "2.4",
          excerpt: "two extensions",
        },
        {
          id: "change-3",
          paragraphIndex: 4,
          kind: "replaced",
          ref: "2.4",
          excerpt: "thirty days → sixty days",
        },
        {
          id: "change-4",
          paragraphIndex: 6,
          kind: "inserted",
          ref: "2.4",
          excerpt: "Added cell text",
        },
      ],
    });
  });

  it("answers an empty change list for an ordinary Word file", () => {
    expect(parseTrackedChangesDocx(fixture("no-changes.docx"))).toEqual({
      paragraphs: [
        {
          index: 0,
          style: "body",
          label: null,
          runs: [{ text: "No tracked changes here.", change: "unchanged" }],
        },
      ],
      changes: [],
    });
  });

  it("uses a paragraph mark when no labelled paragraph precedes a change", () => {
    const model = parseTrackedChangesDocx(fixture("tracked-changes.docx"));
    expect(model.changes).toEqual([
      expect.objectContaining({ paragraphIndex: 1, ref: "¶2", kind: "replaced" }),
    ]);
  });
});
