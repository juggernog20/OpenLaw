/* The paper the seeded instance holds.
 *
 * A document panel with nothing in it reviews badly, and so does one
 * full of files that will not open. Everything here is a real file of
 * its declared type: the PDFs render in the preview, the DOCX files
 * convert through the doc engine, and the text extraction that feeds
 * comparison and AI analysis has something to read.
 *
 * Both writers are deliberately small. A dependency would be a build
 * step for a script that runs on a laptop, and neither format needs one
 * for a page of left-aligned text.
 */

import { deflateRawSync } from "node:zlib";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 64;
const LINE_HEIGHT = 15;
const BODY_SIZE = 10.5;
const TITLE_SIZE = 15;
/** How many body lines fit between the margins. */
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);
/** Roughly what fits on a line at 10.5pt Helvetica. */
const CHARS_PER_LINE = 88;

/** Helvetica has no glyph for the nice characters, so they become plain ones. */
function toWinAnsi(text) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7e]/g, "?");
}

function escapePdfText(text) {
  return toWinAnsi(text).replace(/([\\()])/g, "\\$1");
}

/** Greedy wrap; the seed's paragraphs are short and this reads fine. */
function wrap(line, width = CHARS_PER_LINE) {
  if (line.length <= width) return [line];
  const wrapped = [];
  let current = "";
  for (const word of line.split(/\s+/)) {
    if (current === "") current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      wrapped.push(current);
      current = word;
    }
  }
  if (current !== "") wrapped.push(current);
  return wrapped;
}

/** Splits already-wrapped lines into pages, keeping the blank lines. */
function paginate(lines) {
  const pages = [];
  for (let index = 0; index < lines.length; index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  return pages.length > 0 ? pages : [[]];
}

function contentStream(lines, isFirstPage) {
  const parts = ["BT", `/F1 ${BODY_SIZE} Tf`, `${LINE_HEIGHT} TL`];
  parts.push(`1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`);
  lines.forEach((line, index) => {
    // The title line is the document's own heading, set larger.
    const isTitle = isFirstPage && index === 0;
    if (isTitle) parts.push(`/F2 ${TITLE_SIZE} Tf`);
    parts.push(`(${escapePdfText(line)}) Tj`, "T*");
    if (isTitle) parts.push(`/F1 ${BODY_SIZE} Tf`);
  });
  parts.push("ET");
  return parts.join("\n");
}

/**
 * A PDF of `lines`, one page per screenful.
 *
 * The object table is written by hand because the offsets have to be
 * byte-exact: a PDF whose xref is one byte out opens in nothing.
 */
export function makePdf(title, paragraphs) {
  const lines = [title, "", ...paragraphs.flatMap((p) => (p === "" ? [""] : wrap(p)))];
  const pages = paginate(lines);

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  // Reserved so the page objects can name their parent before it exists.
  const catalogId = add(null);
  const pagesId = add(null);
  const bodyFontId = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const titleFontId = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  const pageIds = [];
  pages.forEach((pageLines, index) => {
    const stream = contentStream(pageLines, index === 0);
    const streamId = add(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${bodyFontId} 0 R /F2 ${titleFontId} 0 R >> >> ` +
          `/Contents ${streamId} 0 R >>`,
      ),
    );
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "latin1");
    chunks.push(chunk);
    offset += chunk.length;
  });

  const xrefStart = offset;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (const entry of offsets) xref.push(`${String(entry).padStart(10, "0")} 00000 n \n`);
  xref.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );
  chunks.push(Buffer.from(xref.join(""), "latin1"));
  return Buffer.concat(chunks);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** A zip of `entries` (`{ name, data }`), deflated, no directories. */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1 Jan 1996, fixed so the bytes are stable
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(0, 42); // local header offset, filled below
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function xmlEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** A Word file of `paragraphs`, with `title` as a bold first line. */
export function makeDocx(title, paragraphs) {
  const runs = [title, ...paragraphs]
    .map((text, index) => {
      const properties = index === 0 ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : "";
      const bold = index === 0 ? '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>' : "";
      if (text === "") return "<w:p/>";
      return `<w:p>${properties}<w:r>${bold}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
    })
    .join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${runs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  return makeZip([
    { name: "[Content_Types].xml", data: DOCX_CONTENT_TYPES },
    { name: "_rels/.rels", data: DOCX_RELS },
    { name: "word/document.xml", data: document },
  ]);
}

/** Plain text, for the odd note or export a real instance also holds. */
export function makeTxt(title, paragraphs) {
  return Buffer.from([title, "", ...paragraphs].join("\n"), "utf8");
}

export const MEDIA_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
