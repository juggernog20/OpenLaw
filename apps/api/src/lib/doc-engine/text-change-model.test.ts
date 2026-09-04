// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { buildTextChangeModel } from "./text-change-model.js";

describe("buildTextChangeModel", () => {
  it("aligns paragraphs and marks changed words, inserted paragraphs, and clause labels", () => {
    const model = buildTextChangeModel(
      "1. Services\n\nSupplier will respond within thirty days.\n\n3. Fees stay fixed.",
      "1. Services\n\nSupplier will respond within sixty days.\n\n2. Notices go by email.\n\n3. Fees stay fixed.",
    );

    expect(model.paragraphs).toHaveLength(4);
    expect(model.paragraphs.map(({ style, label }) => ({ style, label }))).toEqual([
      { style: "body", label: "1." },
      { style: "body", label: null },
      { style: "body", label: "2." },
      { style: "body", label: "3." },
    ]);
    expect(model.paragraphs[1]?.runs).toEqual([
      { text: "Supplier will respond within ", change: "unchanged" },
      { text: "thirty ", change: "deleted" },
      { text: "sixty ", change: "inserted" },
      { text: "days.", change: "unchanged" },
    ]);
    expect(model.paragraphs[2]?.runs).toEqual([
      { text: "2. Notices go by email.", change: "inserted" },
    ]);
    expect(model.changes).toEqual([
      {
        id: "change-1",
        paragraphIndex: 1,
        kind: "replaced",
        ref: "1.",
        excerpt: "thirty → sixty",
      },
      {
        id: "change-2",
        paragraphIndex: 2,
        kind: "inserted",
        ref: "2.",
        excerpt: "2. Notices go by email.",
      },
    ]);
  });

  it("ignores whitespace differences when both texts contain the same words", () => {
    const model = buildTextChangeModel(
      "1. Same   words here.\n\nSecond clause.",
      "1. Same words\nhere.\n\nSecond clause.",
    );

    expect(model.changes).toEqual([]);
    expect(model.paragraphs).toEqual([
      {
        index: 0,
        style: "body",
        label: "1.",
        numberPrefix: null,
        runs: [{ text: "1. Same words here.", change: "unchanged" }],
      },
      {
        index: 1,
        style: "body",
        label: null,
        numberPrefix: null,
        runs: [{ text: "Second clause.", change: "unchanged" }],
      },
    ]);
  });

  it("keeps a removed paragraph in the reading order as deleted text", () => {
    const model = buildTextChangeModel(
      "Opening.\n\n2. Removed words.\n\nClosing.",
      "Opening.\n\nClosing.",
    );

    expect(model.paragraphs[1]).toEqual({
      index: 1,
      style: "body",
      label: "2.",
      numberPrefix: null,
      runs: [{ text: "2. Removed words.", change: "deleted" }],
    });
    expect(model.changes).toEqual([
      {
        id: "change-1",
        paragraphIndex: 1,
        kind: "deleted",
        ref: "2.",
        excerpt: "2. Removed words.",
      },
    ]);
  });

  it("reads a form feed page break as a paragraph boundary", () => {
    const model = buildTextChangeModel(
      "Last clause of page one.\n\fFirst clause of page two.\n\f",
      "Last clause of page one.\n\nFirst clause of page two.",
    );

    expect(model.changes).toEqual([]);
    expect(model.paragraphs.map(({ runs }) => runs[0]?.text)).toEqual([
      "Last clause of page one.",
      "First clause of page two.",
    ]);
  });
});
