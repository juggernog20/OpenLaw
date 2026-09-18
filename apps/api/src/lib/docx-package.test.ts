// SPDX-License-Identifier: AGPL-3.0-only

/** The template screen and the ZIP guard, against hand-built packages. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  DocxScreeningError,
  MAX_ZIP_ENTRIES,
  screenDocxPackage,
  verifyZipPackage,
  zipEntries,
} from "./docx-package.js";
import {
  buildWordPackage,
  complexField,
  forgeDeclaredSize,
  OFFICE_RELATIONSHIPS_NS,
  paragraph,
  relationships,
  wordBody,
  WORD_NS,
} from "../testing/word-package.js";

const fixture = (name: string) =>
  readFile(new URL(`../testing/fixtures/auto-docs/${name}.docx`, import.meta.url));
const relationship = (type: string, target: string, external = true) =>
  `<Relationship Id="rId9" Type="${OFFICE_RELATIONSHIPS_NS}/${type}" Target="${target}"${
    external ? ' TargetMode="External"' : ""
  }/>`;

describe("screenDocxPackage", () => {
  it("passes the checked-in templates", async () => {
    for (const name of ["plain", "formatting", "parts", "blocks", "directives"]) {
      const bytes = await fixture(name);
      expect(() => screenDocxPackage(bytes)).not.toThrow();
    }
  });
  it("allows an external hyperlink and an internal image", () => {
    const bytes = buildWordPackage({
      "word/_rels/document.xml.rels": relationships(
        relationship("hyperlink", "https://example.com") +
          relationship("image", "media/image1.png", false),
      ),
    });
    expect(() => screenDocxPackage(bytes)).not.toThrow();
  });
  it.each([
    ["attachedTemplate", "word/_rels/settings.xml.rels", "file:///\\\\evil\\share\\t.dotm"],
    ["oleObject", "word/_rels/document.xml.rels", "file:///C:/payload.xlsx"],
    ["image", "word/_rels/document.xml.rels", "https://evil.example/pixel.png"],
  ])("refuses an external %s relationship", (type, part, target) => {
    const bytes = buildWordPackage({ [part]: relationships(relationship(type, target)) });
    expect(() => screenDocxPackage(bytes)).toThrow(DocxScreeningError);
    expect(() => screenDocxPackage(bytes)).toThrow(`external ${type} link in ${part}`);
  });
  it("refuses a macro project part and a macro-enabled content type", () => {
    expect(() =>
      screenDocxPackage(buildWordPackage({ "word/vbaProject.bin": Buffer.alloc(8) })),
    ).toThrow("macro project");
    expect(() =>
      screenDocxPackage(
        buildWordPackage({
          "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>`,
        }),
      ),
    ).toThrow("macro-enabled content type");
  });
  it("refuses a DDEAUTO field even when the keyword is split across runs", () => {
    const bytes = buildWordPackage({
      "word/document.xml": wordBody(
        paragraph("{{counterparty_name}}") + complexField(" DDE", 'AUTO c:\\\\shell "/c calc" '),
      ),
    });
    expect(() => screenDocxPackage(bytes)).toThrow("DDEAUTO field in word/document.xml");
  });
  it("refuses INCLUDETEXT in a simple field and INCLUDEPICTURE in a header", () => {
    expect(() =>
      screenDocxPackage(
        buildWordPackage({
          "word/document.xml": wordBody(
            `<w:p><w:fldSimple w:instr=" INCLUDETEXT &quot;\\\\\\\\evil\\\\x.docx&quot; "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>`,
          ),
        }),
      ),
    ).toThrow("INCLUDETEXT field in word/document.xml");
    expect(() =>
      screenDocxPackage(
        buildWordPackage({
          "word/header1.xml": `<w:hdr xmlns:w="${WORD_NS}">${complexField(
            ' INCLUDEPICTURE "https://evil.example/a.png" \\d ',
          )}</w:hdr>`,
        }),
      ),
    ).toThrow("INCLUDEPICTURE field in word/header1.xml");
  });
  it("allows ordinary fields", () => {
    const bytes = buildWordPackage({
      "word/document.xml": wordBody(
        complexField(" PAGE ") +
          complexField(" HYPERLINK ", '"https://example.com/import" ') +
          `<w:p><w:fldSimple w:instr=" MERGEFIELD company "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>`,
      ),
    });
    expect(() => screenDocxPackage(bytes)).not.toThrow();
  });
});

describe("verifyZipPackage", () => {
  it("accepts an honest package under the ceiling", () => {
    expect(() => verifyZipPackage(buildWordPackage(), 64 * 1024)).not.toThrow();
  });
  it("refuses entries that inflate past the ceiling whatever the directory claims", () => {
    const honest = buildWordPackage({ "word/media/pad.bin": Buffer.alloc(300 * 1024) });
    const forged = forgeDeclaredSize(honest, "word/media/pad.bin", 10);
    expect(
      [...zipEntries(forged).entries()].find(([name]) => name === "word/media/pad.bin")![1]
        .uncompressedSize,
    ).toBe(10);
    expect(() => verifyZipPackage(forged, 64 * 1024)).toThrow(/inflates past/);
    expect(() => verifyZipPackage(honest, 64 * 1024)).toThrow(
      "expanded Word template exceeds 64 KiB",
    );
    expect(() => verifyZipPackage(honest, 1024 * 1024)).not.toThrow();
  });
  it("refuses a package with more entries than the cap", () => {
    const zip = new PizZip();
    for (let index = 0; index <= MAX_ZIP_ENTRIES; index += 1) zip.file(`part${index}.xml`, "<a/>");
    const bytes = zip.generate({ type: "nodebuffer", compression: "STORE" });
    expect(() => verifyZipPackage(bytes, 64 * 1024 * 1024)).toThrow(
      `more than ${MAX_ZIP_ENTRIES} ZIP entries`,
    );
  });
});
