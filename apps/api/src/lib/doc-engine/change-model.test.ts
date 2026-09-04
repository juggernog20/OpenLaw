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

/**
 * A package of several parts, for the cases that need more than the
 * document body — numbering, in particular, which lives in its own part
 * and without which Word generates no number at all.
 */
function zipOf(parts: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(parts)) {
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
    central.writeUInt32LE(offset, 42);

    locals.push(local, filename, contents);
    centrals.push(central, filename);
    offset += local.byteLength + filename.byteLength + contents.byteLength;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(centrals);
  const count = Object.keys(parts).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(body.byteLength, 16);
  return Buffer.concat([body, directory, end]);
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
          numberPrefix: null,
          runs: [{ text: "Agreement terms", change: "unchanged" }],
        },
        {
          index: 1,
          style: "body",
          label: "1.",
          numberPrefix: "1.",
          runs: [{ text: "Definitions apply.", change: "unchanged" }],
        },
        {
          index: 2,
          style: "body",
          label: "2.4",
          numberPrefix: null,
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
          numberPrefix: null,
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
          numberPrefix: null,
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
          numberPrefix: null,
          runs: [{ text: "Table unchanged", change: "unchanged" }],
        },
        {
          index: 6,
          style: "body",
          label: null,
          numberPrefix: null,
          runs: [{ text: "Added cell text", change: "inserted" }],
        },
        {
          index: 7,
          style: "body",
          label: null,
          numberPrefix: null,
          runs: [{ text: "Outer table cell", change: "unchanged" }],
        },
        {
          index: 8,
          style: "body",
          label: null,
          numberPrefix: null,
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
          numberPrefix: null,
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

  it("folds a substitution into one change whichever order Word wrote it in", () => {
    const substitution = (first: "ins" | "del", second: "ins" | "del") =>
      `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
      `<w:r><w:t xml:space="preserve">Notice of </w:t></w:r>` +
      `<w:${first} w:id="1" w:author="A"><w:r>` +
      `<w:${first === "del" ? "delText" : "t"}>thirty days</w:${first === "del" ? "delText" : "t"}>` +
      `</w:r></w:${first}>` +
      `<w:${second} w:id="2" w:author="A"><w:r>` +
      `<w:${second === "del" ? "delText" : "t"}>sixty days</w:${second === "del" ? "delText" : "t"}>` +
      `</w:r></w:${second}>` +
      `</w:p></w:body></w:document>`;

    // Deletion first: the old words are the ones struck out.
    expect(
      parseTrackedChangesDocx(zipEntry("word/document.xml", substitution("del", "ins"))).changes,
    ).toEqual([expect.objectContaining({ kind: "replaced", excerpt: "thirty days → sixty days" })]);

    // Insertion first, which Word also writes. One change, and the
    // excerpt still reads old → new rather than in run order.
    expect(
      parseTrackedChangesDocx(zipEntry("word/document.xml", substitution("ins", "del"))).changes,
    ).toEqual([expect.objectContaining({ kind: "replaced", excerpt: "sixty days → thirty days" })]);
  });

  it("gives a paragraph a number prefix only when its text does not already carry one", () => {
    // Word holds an auto-numbered paragraph's number outside the runs,
    // so the model carries it back for the screen to draw. A number the
    // author typed at the front of the text is already in the runs, and
    // carrying it again would print the clause number twice.
    const model = parseTrackedChangesDocx(fixture("change-model.docx"));
    const numbered = model.paragraphs.find((paragraph) => paragraph.label === "1.");
    const typed = model.paragraphs.find((paragraph) => paragraph.label === "2.4");

    expect(numbered?.runs.map((run) => run.text).join("")).toBe("Definitions apply.");
    expect(numbered?.numberPrefix).toBe("1.");

    expect(typed?.runs.map((run) => run.text).join("")).toMatch(/^2\.4 /u);
    expect(typed?.numberPrefix).toBeNull();
  });

  it("keeps a generated number whose text opens with a deeper clause", () => {
    // The text carries clause 1.1 and Word generates "1." for the
    // paragraph. Those are different numbers, so treating the text as a
    // repeat would drop a number the reader needs.
    const model = parseTrackedChangesDocx(
      zipOf({
        "word/numbering.xml":
          `<w:numbering xmlns:w="${W_NS}">` +
          `<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0">` +
          `<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
          `</w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num>` +
          `</w:numbering>`,
        "word/document.xml":
          `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
          `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
          `<w:r><w:t xml:space="preserve">1.1 Liability cap applies.</w:t></w:r>` +
          `</w:p></w:body></w:document>`,
      }),
    );
    expect(model.paragraphs[0]?.numberPrefix).toBe("1.");
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
