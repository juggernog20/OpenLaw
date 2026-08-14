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
import {
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
