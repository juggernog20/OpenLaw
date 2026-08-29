// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one question the backfill sweep asks of a version, stated on its
 * own.
 *
 * The sweep walks every version in the install and decides, for each,
 * whether the pipeline still owes it something and which job would
 * deliver it. That rule has several boundaries: a family that derives
 * nothing, a derivation that is already there, a derivation that gave
 * up. A boundary is cheaper to pin with a row than with an upload. What
 * the sweep does to an upgrading install is asserted end to end in the
 * documents module's own suite.
 */

import { describe, expect, it } from "vitest";
import { DOCX_MIME_TYPE as DOCX, PPTX_MIME_TYPE as PPTX } from "../testing/fixtures/office.js";
import { derivationOwedBy } from "./backfill.js";

/** A version as the sweep reads it: what it is, and where its two
 * derivations have got to. */
const version = (
  mimeType: string,
  originalFilename: string,
  textState: "pending" | "ready" | "failed" | null,
  renditionState: "pending" | "ready" | "failed" | null = null,
) => ({ mimeType, originalFilename, textState, renditionState });

describe("what a version is still owed", () => {
  it("asks for extraction when a PDF has no derivation at all", () => {
    // The upgrade case: uploaded before the derivation tables existed,
    // so nothing was ever recorded as owed for it.
    expect(derivationOwedBy(version("application/pdf", "msa.pdf", null))).toBe("text-extraction");
  });

  it("asks for conversion when a Word draft has no derivation at all", () => {
    // One job, not two. The conversion writes the rendition and reads
    // its text at the end of the same work (M12/4).
    expect(derivationOwedBy(version(DOCX, "redline.docx", null, null))).toBe("display-conversion");
  });

  it("asks again when a derivation is still pending", () => {
    // A lost queue send, or a job that expired against a wedged worker
    // on its last attempt. Neither wrote an outcome, and the sweep
    // cannot tell them apart. Both want the same thing: to be asked
    // again.
    expect(derivationOwedBy(version("application/pdf", "scan.pdf", "pending"))).toBe(
      "text-extraction",
    );
    expect(derivationOwedBy(version(DOCX, "draft.docx", "pending", "pending"))).toBe(
      "display-conversion",
    );
  });

  it("asks for nothing when the text is already there", () => {
    expect(derivationOwedBy(version("application/pdf", "msa.pdf", "ready"))).toBeNull();
  });

  it("asks for nothing when a derivation gave up", () => {
    // A terminal failure is settled. Re-asking on every boot would
    // convert the same bytes again for ever and never answer
    // differently.
    expect(derivationOwedBy(version("application/pdf", "not-a-pdf.pdf", "failed"))).toBeNull();
    expect(derivationOwedBy(version(DOCX, "truncated.docx", "failed", "failed"))).toBeNull();
  });

  it("leaves a Word draft alone when its conversion gave up, text and all", () => {
    // The text was only ever going to come out of that rendition, so a
    // text row left owed here is not a reason to convert again.
    expect(derivationOwedBy(version(DOCX, "truncated.docx", "pending", "failed"))).toBeNull();
  });

  it("asks for conversion again when the rendition is there but its text is not", () => {
    // The job converted and then failed to read the PDF it had just
    // written. Running it again skips the conversion and reads the text.
    expect(derivationOwedBy(version(PPTX, "deck.pptx", "pending", "ready"))).toBe(
      "display-conversion",
    );
  });

  it("asks for nothing for a family that yields nothing", () => {
    // An image renders as it is and has no text in v1; a spreadsheet is
    // download-only for good (DOC-004, DOC-005). Neither ever gets a
    // derivation row, and a sweep that enqueued for them would ask the
    // pipeline to do work it would only refuse.
    expect(derivationOwedBy(version("image/png", "signature-page.png", null))).toBeNull();
    expect(derivationOwedBy(version("application/zip", "bundle.zip", null))).toBeNull();
  });

  it("asks for extraction for an email, which needs no conversion", () => {
    expect(derivationOwedBy(version("message/rfc822", "thread.eml", null))).toBe("text-extraction");
  });
});
