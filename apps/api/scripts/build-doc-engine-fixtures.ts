// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the doc-engine contract suite's fixtures.
 *
 * The fixtures are committed binaries. They are committed rather than
 * generated at test time because a contract suite must measure the
 * engine, not the fixture generator, and because two of them need the
 * sidecar image's own tooling to make. This script is how they were
 * made, kept so the next person can remake or extend them:
 *
 *   docker build -f services/doc-engine/Dockerfile -t openlaw-doc-engine:dev .
 *   pnpm --filter @openlaw/api exec tsx scripts/build-doc-engine-fixtures.ts
 *
 * What it writes into src/testing/fixtures/doc-engine:
 *
 * - `plain.docx` — an ordinary Word document. Written here as real
 *   OOXML, not round-tripped through LibreOffice, so the conversion
 *   under test reads what Word would have written.
 * - `tracked-changes.docx` — the fidelity case TECH-010 flags: a Word
 *   document carrying a tracked insertion, a tracked deletion, and a
 *   margin comment. DOC-004 promises all three render.
 * - `deck.pptx` — a one-slide PowerPoint deck.
 * - `native-text.pdf` — a PDF with a real text layer, which extraction
 *   must read without OCR.
 * - `scan.pdf` — the same page as a picture of itself: an image-only
 *   PDF with no text layer at all, which is what OCR is for (DOC-005).
 * - `compare-older.docx` / `compare-newer.docx` — the clean Word pair
 *   LibreOffice compares in the DOC-003 fidelity case.
 * - `compare-newer.odt` — the newer fixture as a real ODT, proving the
 *   shape tier's cross-format comparison rather than only its filename.
 * - `change-model.docx` — every structure the tracked-change parser
 *   reads: a heading, numbering, a clause label, three change kinds,
 *   and a table.
 * - `no-changes.docx` — the parser's empty-change case.
 *
 * The two PowerPoint/PDF fixtures are produced by running LibreOffice
 * and poppler inside the sidecar image. Making a valid PPTX by hand
 * means writing a slide master, a layout, and a theme; making a
 * believable scan means rasterising a page. Both tools are already in
 * the image, so the image makes them.
 */

import { execFileSync } from "node:child_process";
import { crc32 } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The image the LibreOffice-driven fixtures are built in. */
const IMAGE = process.env.DOC_ENGINE_IMAGE ?? "openlaw-doc-engine:dev";

const fixtures = fileURLToPath(new URL("../src/testing/fixtures/doc-engine/", import.meta.url));

// --- A minimal ZIP writer ---------------------------------------------
//
// An OOXML file is a ZIP of XML parts. Entries are stored uncompressed:
// the fixtures are a few kilobytes, every reader accepts stored entries,
// and storing them keeps this writer to the format's essentials.

interface ZipEntry {
  name: string;
  body: Buffer;
}

/** A ZIP archive holding `entries`, in the order they are given. */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const sum = crc32(entry.body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // modification time
    local.writeUInt16LE(0x21, 12); // modification date — 1 January 1980
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(entry.body.byteLength, 18);
    local.writeUInt32LE(entry.body.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, name, entry.body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); // central directory signature
    directory.writeUInt16LE(20, 4); // version made by
    directory.writeUInt16LE(20, 6); // version needed
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(sum, 16);
    directory.writeUInt32LE(entry.body.byteLength, 20);
    directory.writeUInt32LE(entry.body.byteLength, 24);
    directory.writeUInt16LE(name.byteLength, 28);
    directory.writeUInt16LE(0, 30); // no extra field
    directory.writeUInt16LE(0, 32); // no comment
    directory.writeUInt16LE(0, 34); // disk number
    directory.writeUInt16LE(0, 36); // internal attributes
    directory.writeUInt32LE(0, 38); // external attributes
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);

    offset += local.byteLength + name.byteLength + entry.body.byteLength;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...locals, directory, end]);
}

/** A part of an OOXML package. */
function part(name: string, xml: string): ZipEntry {
  return {
    name,
    body: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`, "utf8"),
  };
}

// --- The Word fixtures -------------------------------------------------

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The date every tracked change and comment in the fixtures carries. */
const AUTHORED_AT = "2026-08-14T09:00:00Z";

interface DocxParts {
  comments?: string;
  numbering?: string;
  styles?: string;
}

/** The OOXML package around one `word/document.xml`, with its optional Word parts. */
function docx(documentXml: string, parts: DocxParts = {}): Buffer {
  const contentTypes = part(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      (parts.comments
        ? `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`
        : "") +
      (parts.numbering
        ? `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`
        : "") +
      (parts.styles
        ? `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
        : "") +
      `</Types>`,
  );
  const packageRels = part(
    "_rels/.rels",
    `<Relationships xmlns="${RELS_NS}">` +
      `<Relationship Id="rId1" Type="${REL_TYPES}/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  const documentRels = part(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="${RELS_NS}">` +
      (parts.comments
        ? `<Relationship Id="rId1" Type="${REL_TYPES}/comments" Target="comments.xml"/>`
        : "") +
      (parts.numbering
        ? `<Relationship Id="rId2" Type="${REL_TYPES}/numbering" Target="numbering.xml"/>`
        : "") +
      (parts.styles
        ? `<Relationship Id="rId3" Type="${REL_TYPES}/styles" Target="styles.xml"/>`
        : "") +
      `</Relationships>`,
  );
  const entries = [contentTypes, packageRels, documentRels, part("word/document.xml", documentXml)];
  if (parts.comments) entries.push(part("word/comments.xml", parts.comments));
  if (parts.numbering) entries.push(part("word/numbering.xml", parts.numbering));
  if (parts.styles) entries.push(part("word/styles.xml", parts.styles));
  return zip(entries);
}

/** A minimal OpenDocument Text package used as a real cross-format operand. */
function odt(paragraphs: readonly string[]): Buffer {
  return zip([
    {
      name: "mimetype",
      body: Buffer.from("application/vnd.oasis.opendocument.text"),
    },
    part(
      "META-INF/manifest.xml",
      `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
        `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>` +
        `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
        `</manifest:manifest>`,
    ),
    part(
      "content.xml",
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
        `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">` +
        `<office:body><office:text>${paragraphs.map((text) => `<text:p>${text}</text:p>`).join("")}` +
        `</office:text></office:body></office:document-content>`,
    ),
  ]);
}

/** A paragraph of one plain run. */
function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const PLAIN_DOCX = docx(
  `<w:document xmlns:w="${W_NS}"><w:body>` +
    paragraph("Mutual Non-Disclosure Agreement") +
    paragraph(
      "Each party shall keep the other party's Confidential Information in confidence for five years.",
    ) +
    `</w:body></w:document>`,
);

const TRACKED_CHANGES_DOCX = docx(
  `<w:document xmlns:w="${W_NS}"><w:body>` +
    paragraph("Master Services Agreement — round three") +
    // One paragraph carrying all three things at once: a tracked
    // deletion, a tracked insertion, and a comment anchored across
    // both. A conversion that drops any of them fails DOC-004.
    `<w:p>` +
    `<w:commentRangeStart w:id="0"/>` +
    `<w:r><w:t xml:space="preserve">This Agreement is governed by the laws of </w:t></w:r>` +
    `<w:del w:id="1" w:author="Counterparty Counsel" w:date="${AUTHORED_AT}">` +
    `<w:r><w:delText xml:space="preserve">England and Wales</w:delText></w:r>` +
    `</w:del>` +
    `<w:ins w:id="2" w:author="Counterparty Counsel" w:date="${AUTHORED_AT}">` +
    `<w:r><w:t xml:space="preserve">the Dubai International Financial Centre</w:t></w:r>` +
    `</w:ins>` +
    `<w:r><w:t>.</w:t></w:r>` +
    `<w:commentRangeEnd w:id="0"/>` +
    `<w:r><w:commentReference w:id="0"/></w:r>` +
    `</w:p>` +
    `</w:body></w:document>`,
  {
    comments:
      `<w:comments xmlns:w="${W_NS}">` +
      `<w:comment w:id="0" w:author="Counterparty Counsel" w:initials="CC" w:date="${AUTHORED_AT}">` +
      paragraph("Confirm the DIFC Courts have exclusive jurisdiction.") +
      `</w:comment>` +
      `</w:comments>`,
  },
);

const COMPARE_OLDER_DOCX = docx(
  `<w:document xmlns:w="${W_NS}"><w:body>` +
    paragraph("Services Agreement") +
    paragraph("2.1 The notice period is thirty days.") +
    paragraph("Fees are payable monthly.") +
    `</w:body></w:document>`,
);

const COMPARE_NEWER_DOCX = docx(
  `<w:document xmlns:w="${W_NS}"><w:body>` +
    paragraph("Services Agreement") +
    paragraph("2.1 The notice period is sixty days.") +
    paragraph("Fees are payable quarterly.") +
    `</w:body></w:document>`,
);

const COMPARE_NEWER_ODT = odt([
  "Services Agreement",
  "2.1 The notice period is sixty days.",
  "Fees are payable quarterly.",
]);

const CHANGE_MODEL_DOCX = docx(
  `<w:document xmlns:w="${W_NS}"><w:body>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Agreement terms</w:t></w:r>` +
    `<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>` +
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>` +
    `<w:r><w:t>Definitions apply.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">2.4 Liability cap is </w:t></w:r>` +
    `<w:del w:id="1" w:author="Counsel" w:date="${AUTHORED_AT}"><w:r><w:delText>ten million</w:delText></w:r></w:del>` +
    `<w:r><w:t>.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">The term includes </w:t></w:r>` +
    `<w:ins w:id="2" w:author="Counsel" w:date="${AUTHORED_AT}"><w:r><w:t>two extensions</w:t></w:r></w:ins>` +
    `<w:r><w:t>.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">Notice is </w:t></w:r>` +
    `<w:del w:id="3" w:author="Counsel" w:date="${AUTHORED_AT}"><w:r><w:delText>thirty days</w:delText></w:r></w:del>` +
    `<w:ins w:id="4" w:author="Counsel" w:date="${AUTHORED_AT}"><w:r><w:t>sixty days</w:t></w:r></w:ins>` +
    `<w:r><w:t>.</w:t></w:r></w:p>` +
    `<w:tbl><w:tr>` +
    `<w:tc><w:p><w:r><w:t>Table unchanged</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:p><w:ins w:id="5" w:author="Counsel" w:date="${AUTHORED_AT}"><w:r><w:t>Added cell text</w:t></w:r></w:ins></w:p></w:tc>` +
    `<w:tc><w:p><w:r><w:t>Outer table cell</w:t></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc><w:p>` +
    `<w:del w:id="6" w:author="Counsel" w:date="${AUTHORED_AT}"><w:r><w:delText>Nested removed text</w:delText></w:r></w:del>` +
    `</w:p></w:tc></w:tr></w:tbl></w:tc>` +
    `</w:tr></w:tbl>` +
    `</w:body></w:document>`,
  {
    numbering:
      `<w:numbering xmlns:w="${W_NS}">` +
      `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
      `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="7"><w:abstractNumId w:val="2"/></w:num>` +
      `</w:numbering>`,
  },
);

const NO_CHANGES_DOCX = docx(
  `<w:document xmlns:w="${W_NS}"><w:body>${paragraph("No tracked changes here.")}</w:body></w:document>`,
);

// --- The LibreOffice-built fixtures ------------------------------------

/**
 * A Flat ODF presentation — one XML file rather than a package, which is
 * why the deck starts life in this format. LibreOffice converts it to a
 * real PPTX below, and that PPTX is what the suite feeds the engine.
 */
const DECK_FODP = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.presentation">
  <office:automatic-styles/>
  <office:body><office:presentation>
    <draw:page draw:name="Board approval">
      <draw:frame svg:width="24cm" svg:height="3cm" svg:x="2cm" svg:y="3cm">
        <draw:text-box><text:p>Board approval of the acquisition</text:p></draw:text-box>
      </draw:frame>
      <draw:frame svg:width="24cm" svg:height="4cm" svg:x="2cm" svg:y="8cm">
        <draw:text-box><text:p>Signing is conditional on regulatory clearance.</text:p></draw:text-box>
      </draw:frame>
    </draw:page>
  </office:presentation></office:body>
</office:document>
`;

/**
 * The page both PDF fixtures are made from. The wording is deliberately
 * plain and well spaced: OCR is measured against it, and a fixture that
 * needs a perfect reading to pass would fail on Tesseract's version
 * rather than on the engine's behaviour.
 */
const SCAN_SOURCE_FODT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
  <office:automatic-styles>
    <style:style style:name="Big" style:family="paragraph">
      <style:text-properties fo:font-size="20pt" style:font-name="Liberation Serif"/>
      <style:paragraph-properties fo:margin-bottom="0.6cm"/>
    </style:style>
  </office:automatic-styles>
  <office:body><office:text>
    <text:p text:style-name="Big">DEED OF ASSIGNMENT</text:p>
    <text:p text:style-name="Big">This deed is dated the first of March.</text:p>
    <text:p text:style-name="Big">The assignor transfers the whole of the rights.</text:p>
  </office:text></office:body>
</office:document>
`;

/** Runs a command inside the sidecar image, over a shared directory. */
function inImage(work: string, script: string): void {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      // The image runs as an unprivileged user; matching it to the
      // caller is what lets the container write into the mount.
      "--user",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      "--volume",
      `${work}:/work`,
      "--workdir",
      "/work",
      IMAGE,
      "-euc",
      script,
    ],
    { stdio: "inherit" },
  );
}

function main(): void {
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, "plain.docx"), PLAIN_DOCX);
  writeFileSync(join(fixtures, "tracked-changes.docx"), TRACKED_CHANGES_DOCX);
  writeFileSync(join(fixtures, "compare-older.docx"), COMPARE_OLDER_DOCX);
  writeFileSync(join(fixtures, "compare-newer.docx"), COMPARE_NEWER_DOCX);
  writeFileSync(join(fixtures, "compare-newer.odt"), COMPARE_NEWER_ODT);
  writeFileSync(join(fixtures, "change-model.docx"), CHANGE_MODEL_DOCX);
  writeFileSync(join(fixtures, "no-changes.docx"), NO_CHANGES_DOCX);

  if (process.env.DOC_ENGINE_WORD_FIXTURES_ONLY === "1") {
    console.log(`wrote the Word fixtures to ${fixtures}`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "doc-engine-fixtures-"));
  try {
    writeFileSync(join(work, "deck.fodp"), DECK_FODP);
    writeFileSync(join(work, "page.fodt"), SCAN_SOURCE_FODT);
    inImage(
      work,
      [
        "export HOME=/tmp",
        // The deck, as a real PowerPoint file.
        'soffice --headless --convert-to pptx:"Impress MS PowerPoint 2007 XML" --outdir . deck.fodp',
        // The page, as a PDF with a real text layer.
        "soffice --headless --convert-to pdf --outdir . page.fodt",
        // The same page as a picture of itself: rasterise it, then wrap
        // the picture in a PDF. What comes out has no text layer at all,
        // which is what an image-only scan is.
        "pdftoppm -r 200 -gray -png page.pdf page-image",
        "python3 -m img2pdf --output scan.pdf page-image-1.png",
      ].join("\n"),
    );
    writeFileSync(join(fixtures, "deck.pptx"), readFileSync(join(work, "deck.pptx")));
    writeFileSync(join(fixtures, "native-text.pdf"), readFileSync(join(work, "page.pdf")));
    writeFileSync(join(fixtures, "scan.pdf"), readFileSync(join(work, "scan.pdf")));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`wrote the doc-engine fixtures to ${fixtures}`);
}

main();
