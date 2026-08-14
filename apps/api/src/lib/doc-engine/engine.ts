// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The doc engine (TECH-010): one narrow interface over the three things
 * a document engine does for us, with an implementation behind it.
 *
 * The interface has three operations — convert a source to PDF, read an
 * image-only PDF with OCR, read a PDF's native text layer — and nothing
 * else. It stays narrow and stream-based for the reason the storage
 * adapter does: TECH-010 keeps a commercial SDK (Aspose-class) as the
 * documented swap-in if LibreOffice fidelity fails, and an interface
 * shaped around LibreOffice's command line could not carry one. Nothing
 * here names a tool, a filter, a temporary file, or a page.
 *
 * Two rules hold for every implementation:
 *
 * - **The engine is stateless.** Nothing a call does is visible to the
 *   next one. The same bytes always answer the same way.
 * - **The engine derives, it never stores.** It answers bytes and text
 *   to its caller. What is kept, and under which key, is the caller's
 *   decision (DOC-012), and the original a person uploaded is never
 *   replaced by what came back (DOC-005).
 *
 * The failures below are split by what a caller should do about them,
 * because the pipeline that will call this has to choose between marking
 * a derivation failed and retrying it. {@link UnsupportedFormatError}
 * and {@link SourceUnreadableError} are terminal — the file is what it
 * is, and a retry converts the same bytes again.
 * {@link DocEngineTimeoutError} and {@link DocEngineUnavailableError}
 * are transient — a wedged LibreOffice or a restarting sidecar is
 * exactly what a retry heals.
 */

import type { Readable } from "node:stream";

/** Base class of every failure this interface defines. */
export class DocEngineError extends Error {}

/** The engine does not convert that source format. Terminal. */
export class UnsupportedFormatError extends DocEngineError {
  constructor(format: string) {
    super(`The doc engine does not convert ${JSON.stringify(format)} to PDF.`);
    this.name = "UnsupportedFormatError";
  }
}

/** The bytes are not readable as the document they claim to be. Terminal. */
export class SourceUnreadableError extends DocEngineError {
  constructor(message: string) {
    super(message);
    this.name = "SourceUnreadableError";
  }
}

/** The operation ran past its bound and was killed. Transient. */
export class DocEngineTimeoutError extends DocEngineError {
  constructor(message: string) {
    super(message);
    this.name = "DocEngineTimeoutError";
  }
}

/** The engine could not be reached, or failed for its own reasons. Transient. */
export class DocEngineUnavailableError extends DocEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DocEngineUnavailableError";
  }
}

/**
 * The source formats the engine converts to PDF, as lowercase filename
 * extensions.
 *
 * The list is the render set DOC-004 promises minus what needs no
 * conversion: PDFs and images render as they are, and email is parsed in
 * process. The OpenDocument formats are here because the same engine
 * reads them for free and a legal team that runs LibreOffice will upload
 * them.
 *
 * The sidecar keeps the same list, because it is the side that maps a
 * format to an export filter. The contract suite is what holds the two
 * together: every format named here is proved to convert against the
 * real image.
 */
export const CONVERTIBLE_FORMATS = [
  "doc",
  "docx",
  "odp",
  "odt",
  "ppt",
  "pptx",
  "rtf",
] as const satisfies readonly string[];

/** A source format the engine converts. */
export type ConvertibleFormat = (typeof CONVERTIBLE_FORMATS)[number];

/**
 * Whether the engine converts `format`.
 *
 * The caller passes what the filename and the declared MIME type say,
 * which is a hint and never a security decision: the engine reads the
 * bytes to find out what they really are, and a mismatch shows up as a
 * conversion that fails, not as a file that is trusted.
 */
export function isConvertibleFormat(format: string): format is ConvertibleFormat {
  return (CONVERTIBLE_FORMATS as readonly string[]).includes(format);
}

/**
 * The one doc-engine seam. Injected into the app factory beside the
 * database, the mailer, and storage; application code only ever sees
 * this type.
 */
export interface DocEngine {
  /**
   * Converts a source document to a PDF and opens it for reading. That
   * PDF is the display rendition the doc panel shows, so the conversion
   * carries what DOC-004 promises is visible: a Word document's tracked
   * changes and its comments.
   *
   * `format` is the source's lowercase filename extension. Rejects with
   * {@link UnsupportedFormatError} when it is not one this engine
   * converts, and with {@link SourceUnreadableError} when the bytes
   * cannot be read as a document.
   */
  convertToPdf(source: Readable, format: string): Promise<Readable>;

  /**
   * Reads an image-only PDF with OCR and answers the text (DOC-005).
   *
   * The OCR'd PDF the engine produces on the way is thrown away, and is
   * not part of this interface: the stored original is always what
   * renders, so there is nothing for a caller to do with it.
   *
   * Rejects with {@link SourceUnreadableError} when the bytes are not a
   * readable PDF.
   */
  ocrPdf(pdf: Readable): Promise<string>;

  /**
   * Reads a PDF's native text layer.
   *
   * A PDF that is only pictures of pages answers text with no words in
   * it. That is not a failure — it is the signal to run {@link ocrPdf}
   * instead (DOC-005).
   *
   * Rejects with {@link SourceUnreadableError} when the bytes are not a
   * readable PDF.
   */
  extractPdfText(pdf: Readable): Promise<string>;
}
