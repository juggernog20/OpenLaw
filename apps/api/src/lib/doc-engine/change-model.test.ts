// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseTrackedChangesDocx } from "./change-model.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`../../testing/fixtures/doc-engine/${name}`, import.meta.url)),
  );
}

function zipEntry(name: string, body: string): Buffer {
  const filename = Buffer.from(name);
  const contents = Buffer.from(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(contents), 14);
  local.writeUInt32LE(contents.byteLength, 18);
  local.writeUInt32LE(contents.byteLength, 22);
  local.writeUInt16LE(filename.byteLength, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(contents), 16);
  central.writeUInt32LE(contents.byteLength, 20);
  central.writeUInt32LE(contents.byteLength, 24);
  central.writeUInt16LE(filename.byteLength, 28);

  const directory = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(local.byteLength + filename.byteLength + contents.byteLength, 16);
  return Buffer.concat([local, filename, contents, directory, end]);
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
        {
          index: 7,
          style: "body",
          label: null,
          runs: [{ text: "Outer table cell", change: "unchanged" }],
        },
        {
          index: 8,
          style: "body",
          label: null,
          runs: [{ text: "Nested removed text", change: "deleted" }],
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
        {
          id: "change-5",
          paragraphIndex: 8,
          kind: "deleted",
          ref: "2.4",
          excerpt: "Nested removed text",
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

  it("reads a tab stop as a property, not as a tab character", () => {
    const model = parseTrackedChangesDocx(
      zipEntry(
        "word/document.xml",
        `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
          `<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>` +
          `<w:r><w:t>Clause</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>text</w:t></w:r>` +
          `</w:p></w:body></w:document>`,
      ),
    );
    expect(model.paragraphs[0]?.runs).toEqual([{ text: "Clause\ttext", change: "unchanged" }]);
  });

  it("reads paragraphs inside a content control in reading order", () => {
    const model = parseTrackedChangesDocx(
      zipEntry(
        "word/document.xml",
        `<w:document xmlns:w="${W_NS}"><w:body>` +
          `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
          `<w:sdt><w:sdtPr/><w:sdtContent>` +
          `<w:p><w:r><w:t xml:space="preserve">3.1. Inside </w:t></w:r>` +
          `<w:ins w:id="1"><w:r><w:t>the control</w:t></w:r></w:ins></w:p>` +
          `<w:tbl><w:tr><w:sdt><w:sdtContent><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>` +
          `</w:sdtContent></w:sdt></w:tr></w:tbl>` +
          `</w:sdtContent></w:sdt>` +
          `<w:p><w:r><w:t>After</w:t></w:r></w:p>` +
          `</w:body></w:document>`,
      ),
    );
    expect(model.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text))).toEqual([
      ["Before"],
      ["3.1. Inside ", "the control"],
      ["Cell"],
      ["After"],
    ]);
    expect(model.paragraphs[1]?.label).toBe("3.1.");
    expect(model.changes).toEqual([
      { id: "change-1", paragraphIndex: 1, kind: "inserted", ref: "3.1.", excerpt: "the control" },
    ]);
  });

  it.each([
    [Buffer.from("not a ZIP"), "The Word file has no ZIP central directory."],
    [zipEntry("other.xml", "<root/>"), "The Word file has no word/document.xml part."],
    [zipEntry("word/document.xml", "<"), "The Word file has invalid XML"],
    [
      zipEntry("word/document.xml", `<w:document xmlns:w="${W_NS}"/>`),
      "The Word document has no body.",
    ],
  ])("refuses a malformed Word package", (bytes, message) => {
    expect(() => parseTrackedChangesDocx(bytes)).toThrow(message);
  });
});
