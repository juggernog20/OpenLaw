// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The deterministic doc engine — the stand-in used everywhere the engine
 * binaries are not the thing under test.
 *
 * It is not a mock. It records nothing, expects nothing, and has no
 * knobs: the same bytes always answer the same way, so a suite can state
 * the text it expects instead of reading back whatever a spy was told.
 * What it answers is derived from a digest of the source, which is what
 * makes "the same way" mean something.
 *
 * It is honest about the two things a caller can get wrong — a format
 * the engine does not convert, and bytes that are not the document they
 * claim to be — because those are terminal failures the pipeline has to
 * branch on, and a fake that accepted everything would let a suite pass
 * while the real engine refuses. It is deliberately **not** honest about
 * fidelity: it cannot read a Word document, so it never claims to. The
 * fidelity half of the contract is proved against the real image, and
 * only there (see testing/doc-engine-contract.ts).
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  DocEngineUnavailableError,
  SourceUnreadableError,
  isConvertibleFormat,
  unsupportedFormat,
  type DocEngine,
} from "./engine.js";

/**
 * The comment line the fake writes into every PDF it produces, and reads
 * back out again.
 *
 * It is what lets `extractPdfText` answer the text of a rendition this
 * engine converted, which is the one round trip the pipeline actually
 * performs: a Word document becomes a PDF rendition, and the rendition
 * is what the text is extracted from.
 */
const MARKER = "% openlaw-fake-doc-engine: ";

/**
 * The comment line that makes a PDF an image-only scan to this engine.
 *
 * DOC-005's branch is decided by what extraction answers, not by what a
 * file says it is, so a suite that has to exercise the OCR path needs a
 * PDF whose text layer really does come back with nothing. A real scan
 * is a picture of a page and the fake cannot make one, so the fact is
 * written into the file the same way the conversion marker is — the fake
 * reads the bytes and answers what they say, which is the one thing it
 * has ever done.
 *
 * {@link fakeImageOnlyPdf} builds one.
 */
const IMAGE_ONLY_MARKER = "% openlaw-fake-doc-engine-image-only: ";

/** The formats that are ZIP packages, and so can be checked for one. */
const PACKAGED_FORMATS = new Set(["docx", "pptx", "odt", "odp"]);

/** The first four bytes of every ZIP local file header. */
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** The signature of a ZIP's end-of-central-directory record. */
const ZIP_END = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
/** Every PDF starts with this. */
const PDF_HEADER = Buffer.from("%PDF-", "ascii");

function digest(source: Buffer): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

export function fakeConversionText(format: string, source: Buffer): string {
  return `Converted ${format} document ${digest(source)}`;
}

export function fakeExtractedText(pdf: Buffer): string {
  return `Text layer of PDF ${digest(pdf)}`;
}

export function fakeOcrText(pdf: Buffer): string {
  return `Text read by OCR from PDF ${digest(pdf)}`;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  } catch (error) {
    // A source that dies part way through is the caller's stream
    // failing, not the engine refusing the file. The real engine
    // reports it the same way: transient, with the original as cause.
    throw new DocEngineUnavailableError("The source stream failed before it was read.", {
      cause: error,
    });
  }
  return Buffer.concat(chunks);
}

function pdfString(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

/**
 * A one-page PDF showing `text`, with the same text in a marker comment.
 *
 * Written out by hand rather than with a library because it has to be
 * exactly two things: a real PDF, so a caller may store and serve it
 * like any rendition, and byte-for-byte the same for the same text, so
 * the fake stays deterministic. No date, no identifier, no compression.
 */
function onePagePdf(marker: string, text: string, words: boolean): Buffer {
  // With words, the page draws them. Without, it draws a grey block —
  // which is what a scanned page is to a PDF reader: a picture, with
  // nothing in the file that says what it shows.
  const content = words
    ? `BT /F1 12 Tf 72 760 Td (${pdfString(text)}) Tj ET\n`
    : "0.8 g 72 560 451 200 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  // The marker rides in a header comment, where the format allows any
  // bytes and no reader will render it.
  let body = `%PDF-1.7\n${marker}${text}\n`;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = Buffer.byteLength(body, "latin1");
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) table += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(body + table + trailer, "latin1");
}

function markerOf(pdf: Buffer, marker: string): string | undefined {
  const start = pdf.indexOf(marker);
  if (start < 0) return undefined;
  const from = start + marker.length;
  const end = pdf.indexOf("\n", from);
  return pdf.toString("utf8", from, end < 0 ? pdf.byteLength : end);
}

/**
 * A PDF this engine reads as an image-only scan: pictures of pages, and
 * no text layer at all (DOC-005).
 *
 * `label` names the scan, so two of them are different files and each
 * one OCRs to its own text. Nothing renders the label — the page it
 * builds carries no words, which is the whole point.
 *
 * This is what a suite uploads to make the pipeline take the OCR branch.
 * Extraction answers it with an empty string, exactly as the real engine
 * answers a real scan, and that nothing is the signal to read the pages.
 */
export function fakeImageOnlyPdf(label: string): Buffer {
  return onePagePdf(IMAGE_ONLY_MARKER, label, false);
}

/** Refuses bytes that are plainly not the source they were declared to be. */
function assertReadableSource(source: Buffer, format: string): void {
  if (source.byteLength === 0) {
    throw new SourceUnreadableError(`The ${JSON.stringify(format)} source has no bytes.`);
  }
  if (!PACKAGED_FORMATS.has(format)) return;
  // The packaged formats are ZIP archives, so the fake can check the one
  // thing the real engine also insists on: the archive is whole. A
  // truncated upload has the header and no central directory.
  if (
    !source.subarray(0, ZIP_HEADER.byteLength).equals(ZIP_HEADER) ||
    source.lastIndexOf(ZIP_END) < 0
  ) {
    throw new SourceUnreadableError(`The ${JSON.stringify(format)} source is not a whole package.`);
  }
}

/** Refuses bytes that are not a PDF. */
function assertReadablePdf(pdf: Buffer): void {
  if (!pdf.subarray(0, PDF_HEADER.byteLength).equals(PDF_HEADER)) {
    throw new SourceUnreadableError("The source is not a PDF.");
  }
}

export function createFakeDocEngine(): DocEngine {
  return {
    async convertToPdf(source, format) {
      if (!isConvertibleFormat(format)) {
        // Closed, not left open: the bytes are never read, and a stream
        // the caller opened and nobody closes holds its file handle
        // until the process notices.
        source.destroy();
        throw unsupportedFormat(format);
      }
      // Every other refusal reads the source first, so a caller never
      // has to know which failures consume the stream and which do not.
      const bytes = await collect(source);
      assertReadableSource(bytes, format);
      return Readable.from([onePagePdf(MARKER, fakeConversionText(format, bytes), true)]);
    },

    async ocrPdf(pdf) {
      const bytes = await collect(pdf);
      assertReadablePdf(bytes);
      return fakeOcrText(bytes);
    },

    async extractPdfText(pdf) {
      const bytes = await collect(pdf);
      assertReadablePdf(bytes);
      // A scan has no text layer, and saying so is not a failure — it is
      // DOC-005's branch, and the caller reads the pages instead.
      if (markerOf(bytes, IMAGE_ONLY_MARKER) !== undefined) return "";
      // A rendition this engine produced answers the text it was made
      // with, so the pipeline's one real round trip — convert, then
      // extract from the conversion — holds end to end.
      return markerOf(bytes, MARKER) ?? fakeExtractedText(bytes);
    },
  };
}
