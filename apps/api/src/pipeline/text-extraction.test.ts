// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two decisions text extraction makes before it touches anything,
 * stated on their own.
 *
 * They are asserted here rather than only through the pipeline because
 * each is a rule with a boundary, and a boundary is cheaper to pin with
 * a string than with an upload. What the pipeline actually does end to
 * end is asserted at the HTTP seam, in the documents module's suite.
 */

import { describe, expect, it } from "vitest";
import { extractsText, hasUsableTextLayer, MIN_NATIVE_TEXT_CHARACTERS } from "./text-extraction.js";

describe("is this PDF's own text layer the document's text?", () => {
  it("takes a page of words as they are", () => {
    expect(
      hasUsableTextLayer("This deed is dated the first of March. The assignor transfers."),
    ).toBe(true);
  });

  it("reads nothing at all as a scan", () => {
    // The ordinary answer for an image-only PDF, and DOC-005's whole
    // branch: extraction comes back empty and the pages get OCR'd.
    expect(hasUsableTextLayer("")).toBe(false);
  });

  it("reads whitespace and rules as nothing", () => {
    // A scanner writes page furniture into a text layer without writing
    // a single word into it.
    expect(hasUsableTextLayer("\n\n   \t\n---\n....\n")).toBe(false);
  });

  it("reads a stamped page number as a scan, not as a document", () => {
    // "Page 1 of 12" is nine letters and digits. A file whose only text
    // is that is a scan by every meaning that matters here.
    expect(hasUsableTextLayer("Page 1 of 12")).toBe(false);
  });

  it("counts letters and digits, and draws the line where it says it does", () => {
    const belowTheLine = "a".repeat(MIN_NATIVE_TEXT_CHARACTERS - 1);
    expect(hasUsableTextLayer(belowTheLine)).toBe(false);
    expect(hasUsableTextLayer(`${belowTheLine}a`)).toBe(true);
    // Punctuation is not a word. Padding the same short text with it
    // must not push it over.
    expect(hasUsableTextLayer(`${belowTheLine} .,;:-—()[]`)).toBe(false);
  });

  it("counts words in any script", () => {
    // The repository is not an English-only one, and a rule that counted
    // ASCII would send every Arabic contract to OCR for no reason.
    expect(hasUsableTextLayer("هذه اتفاقية عدم إفشاء بين الطرفين")).toBe(true);
  });
});

describe("which files have text to read", () => {
  it("reads a PDF", () => {
    expect(extractsText("application/pdf", "msa.pdf")).toBe(true);
  });

  it("reads a PDF that declared nothing, by its name", () => {
    // An upload from a client that sent no type arrives as
    // octet-stream. The family routing falls through to the filename,
    // and so does this.
    expect(extractsText("application/octet-stream", "scan.pdf")).toBe(true);
  });

  it("reads nothing from an image", () => {
    // DOC-005 is image-only PDFs. A photographed page uploaded as a JPG
    // renders and yields no text in v1.
    expect(extractsText("image/jpeg", "signature-page.jpg")).toBe(false);
  });

  it("reads nothing from a spreadsheet, which is download-only for good", () => {
    expect(extractsText("application/vnd.ms-excel", "schedule.xls")).toBe(false);
  });

  it("reads Word and PowerPoint, out of the rendition they are converted to", () => {
    // M12/4 converts these to a PDF rendition and reads that — one
    // extraction path, over PDF. Their text is owed from the moment they
    // are uploaded, so the read answers `pending` rather than
    // `unsupported`, even though this handler never touches them.
    expect(extractsText("application/msword", "draft.doc")).toBe(true);
    expect(
      extractsText(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "draft.docx",
      ),
    ).toBe(true);
    expect(extractsText("application/vnd.ms-powerpoint", "board.ppt")).toBe(true);
    expect(extractsText("application/octet-stream", "board.pptx")).toBe(true);
  });

  it("reads nothing from an email until the step that parses it", () => {
    // M12/5 parses MSG/EML in process and the parsed body is the text.
    expect(extractsText("message/rfc822", "dispute.eml")).toBe(false);
  });
});
