// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one decision display conversion makes before it touches anything:
 * whether this version's preview is a file the pipeline has to make.
 *
 * Asserted here rather than only through the pipeline because it is a
 * rule with a boundary, and a boundary is cheaper to pin with a string
 * than with an upload. What the job actually does end to end — convert,
 * store, read the rendition's text, and fail plainly — is asserted at
 * the HTTP seam, in the documents module's suite.
 */

import { describe, expect, it } from "vitest";
import { needsDisplayRendition } from "./display-conversion.js";

describe("which files need a display rendition", () => {
  it("converts a Word document", () => {
    expect(
      needsDisplayRendition(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "draft.docx",
      ),
    ).toBe(true);
    expect(needsDisplayRendition("application/msword", "old.doc")).toBe(true);
    expect(needsDisplayRendition("application/rtf", "memo.rtf")).toBe(true);
  });

  it("converts a PowerPoint deck", () => {
    expect(
      needsDisplayRendition(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "board.pptx",
      ),
    ).toBe(true);
    expect(needsDisplayRendition("application/vnd.ms-powerpoint", "old.ppt")).toBe(true);
  });

  it("converts a Word document that declared nothing, by its name", () => {
    // A file dragged out of an archive arrives as octet-stream. The
    // family routing falls through to the filename, and so does this.
    expect(needsDisplayRendition("application/octet-stream", "draft.docx")).toBe(true);
  });

  it("converts nothing that already draws in a browser", () => {
    // A PDF and a raster image are served as they are. Converting one
    // would replace what a reader sees with a machine's re-rendering of
    // it, which is exactly what DOC-005 rules out.
    expect(needsDisplayRendition("application/pdf", "msa.pdf")).toBe(false);
    expect(needsDisplayRendition("image/png", "signature-page.png")).toBe(false);
  });

  it("converts nothing outside the render set", () => {
    expect(
      needsDisplayRendition(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "fees.xlsx",
      ),
    ).toBe(false);
    expect(needsDisplayRendition("application/zip", "bundle.zip")).toBe(false);
    // An email is parsed in process (M12/5), with no sidecar involved.
    expect(needsDisplayRendition("message/rfc822", "dispute.eml")).toBe(false);
  });
});
