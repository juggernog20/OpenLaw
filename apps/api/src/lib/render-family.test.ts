// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DOC-004's routing, at the seam the preview route and the version
 * projection both call.
 *
 * Three things are asserted here and nowhere else: that a declared type
 * routes when it names a family, that the filename rescues an upload
 * that declared nothing, and that the preview type is always one of this
 * table's own strings rather than the uploader's.
 */

import { describe, expect, it } from "vitest";
import { isConvertibleFormat } from "./doc-engine/engine.js";
import {
  conversionFormatOf,
  extensionOf,
  previewContentType,
  RENDER_FAMILIES,
  renderFamilyOf,
} from "./render-family.js";

describe("render family", () => {
  it("routes the two families that render natively", () => {
    expect(renderFamilyOf("application/pdf", "msa.pdf")).toBe("pdf");
    expect(renderFamilyOf("image/png", "signature-page.png")).toBe("image");
    expect(renderFamilyOf("image/jpeg", "scan.jpg")).toBe("image");
  });

  it("names the families that render in later tickets", () => {
    expect(
      renderFamilyOf(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "draft.docx",
      ),
    ).toBe("word");
    expect(
      renderFamilyOf(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "board.pptx",
      ),
    ).toBe("presentation");
    expect(renderFamilyOf("message/rfc822", "dispute.eml")).toBe("email");
  });

  it("leaves everything outside the render set download-only", () => {
    expect(renderFamilyOf("application/zip", "bundle.zip")).toBe("other");
    expect(
      renderFamilyOf(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "fees.xlsx",
      ),
    ).toBe("other");
    expect(previewContentType("application/zip", "bundle.zip")).toBeNull();
  });

  it("keeps SVG out of the image family, because an inline SVG is a script", () => {
    expect(renderFamilyOf("image/svg+xml", "logo.svg")).toBe("other");
    expect(previewContentType("image/svg+xml", "logo.svg")).toBeNull();
    // And by the name alone, for an upload that declared nothing.
    expect(renderFamilyOf("application/octet-stream", "logo.svg")).toBe("other");
    expect(previewContentType("application/octet-stream", "logo.svgz")).toBeNull();
  });

  it("gives TIFF a download card rather than a preview no browser draws", () => {
    expect(renderFamilyOf("image/tiff", "fax.tiff")).toBe("other");
    expect(previewContentType("image/tiff", "fax.tiff")).toBeNull();
  });

  it("falls back to the filename when the upload declared nothing", () => {
    expect(renderFamilyOf("application/octet-stream", "msa.pdf")).toBe("pdf");
    expect(renderFamilyOf("application/octet-stream", "scan.JPG")).toBe("image");
    expect(previewContentType("application/octet-stream", "scan.JPG")).toBe("image/jpeg");
    expect(renderFamilyOf("application/octet-stream", "draft.docx")).toBe("word");
  });

  it("prefers the declared type over the name when both say something", () => {
    // The declaration is the more specific hint, and neither is trusted:
    // the preview type below is this table's, not the uploader's.
    expect(renderFamilyOf("application/pdf", "notes.txt")).toBe("pdf");
    expect(previewContentType("application/pdf", "notes.txt")).toBe("application/pdf");
  });

  it("reads a declared type with parameters, in any case", () => {
    expect(renderFamilyOf("Application/PDF; charset=binary", "x")).toBe("pdf");
    expect(previewContentType("IMAGE/PNG", "x")).toBe("image/png");
  });

  it("answers the exact type for each raster image, never one for all of them", () => {
    expect(previewContentType("image/png", "a.png")).toBe("image/png");
    expect(previewContentType("image/jpeg", "a.jpg")).toBe("image/jpeg");
    expect(previewContentType("image/gif", "a.gif")).toBe("image/gif");
    expect(previewContentType("image/webp", "a.webp")).toBe("image/webp");
  });

  it("never answers a preview type the uploader supplied", () => {
    // A declaration nothing in the table names cannot become a response
    // header, whatever it says about itself.
    expect(previewContentType("text/html", "invoice.html")).toBeNull();
    expect(previewContentType('text/html; charset="utf-8"', "invoice.pdf.html")).toBeNull();
  });

  it("only ever answers one of the named families", () => {
    for (const declared of [
      "application/pdf",
      "image/png",
      "text/plain",
      "",
      "nonsense",
      // The two keys a plain object answers for without anybody having
      // written them. Both reach the table from a request.
      "constructor",
      "__proto__",
    ]) {
      for (const name of ["file.bin", "report.constructor", "notes.__proto__"]) {
        expect(RENDER_FAMILIES).toContain(renderFamilyOf(declared, name));
        const previewType = previewContentType(declared, name);
        expect(previewType === null || typeof previewType === "string").toBe(true);
      }
    }
  });

  describe("the format a file is converted from (M12/4)", () => {
    it("names the source format for every Word and PowerPoint route", () => {
      expect(
        conversionFormatOf(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "draft.docx",
        ),
      ).toBe("docx");
      expect(
        conversionFormatOf(
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "board.pptx",
        ),
      ).toBe("pptx");
      expect(conversionFormatOf("application/msword", "old.doc")).toBe("doc");
      expect(conversionFormatOf("application/vnd.ms-powerpoint", "old.ppt")).toBe("ppt");
      expect(conversionFormatOf("application/vnd.oasis.opendocument.text", "notes.odt")).toBe(
        "odt",
      );
      expect(
        conversionFormatOf("application/vnd.oasis.opendocument.presentation", "deck.odp"),
      ).toBe("odp");
      expect(conversionFormatOf("application/rtf", "memo.rtf")).toBe("rtf");
      expect(conversionFormatOf("text/rtf", "memo.rtf")).toBe("rtf");
    });

    it("names it from the filename when the upload declared nothing", () => {
      // A file dragged out of an archive arrives as octet-stream. The
      // name is what routes it, and the format has to ride along or the
      // engine would be asked to convert "".
      expect(conversionFormatOf("application/octet-stream", "draft.docx")).toBe("docx");
      expect(conversionFormatOf("application/octet-stream", "board.pptx")).toBe("pptx");
    });

    it("takes the format from the declared type, not from a name that disagrees", () => {
      // The declaration is the more specific of the two, and it is what
      // chose the family. The format has to come from the same row, or a
      // DOCX called `.pdf` would be sent to the engine as a PDF.
      expect(
        conversionFormatOf(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "draft.pdf",
        ),
      ).toBe("docx");
    });

    it("answers nothing for a file whose preview is the stored file itself", () => {
      // PDFs and images are served as they are, so there is nothing to
      // convert and nothing to store.
      expect(conversionFormatOf("application/pdf", "msa.pdf")).toBeNull();
      expect(conversionFormatOf("image/png", "signature-page.png")).toBeNull();
      expect(conversionFormatOf("message/rfc822", "dispute.eml")).toBeNull();
      expect(conversionFormatOf("application/zip", "bundle.zip")).toBeNull();
    });

    it("only ever names a format the doc engine actually converts", () => {
      // The type holds this for a route somebody writes; this holds it
      // for a route somebody reaches. A format the engine refuses would
      // fail every conversion terminally rather than loudly, so the
      // answer is checked at the two doors the table has.
      for (const declared of [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.text",
        "application/rtf",
        "text/rtf",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.presentation",
      ]) {
        const format = conversionFormatOf(declared, "file.bin");
        expect(format, declared).not.toBeNull();
        expect(isConvertibleFormat(format!), declared).toBe(true);
      }
      for (const name of ["a.doc", "a.docx", "a.odt", "a.rtf", "a.ppt", "a.pptx", "a.odp"]) {
        const format = conversionFormatOf("application/octet-stream", name);
        expect(format, name).not.toBeNull();
        expect(isConvertibleFormat(format!), name).toBe(true);
      }
    });

    it("converts exactly the two families DOC-004 promises are converted", () => {
      for (const declared of [
        "application/pdf",
        "image/png",
        "message/rfc822",
        "application/zip",
        // Both converted families as well, or the equivalence only ever
        // runs its false side and pins "none of these convert".
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ]) {
        const converted = conversionFormatOf(declared, "file.bin") !== null;
        const family = renderFamilyOf(declared, "file.bin");
        expect(converted, declared).toBe(family === "word" || family === "presentation");
      }
    });
  });

  describe("extensionOf", () => {
    it("reads the last dot of the last segment", () => {
      expect(extensionOf("msa.final.PDF")).toBe("pdf");
      expect(extensionOf("archive.pdf/notes")).toBe("");
      expect(extensionOf("archive.pdf\\notes")).toBe("");
    });

    it("treats a leading-dot name as having no extension", () => {
      expect(extensionOf(".gitignore")).toBe("");
      expect(extensionOf("plain")).toBe("");
    });
  });
});
