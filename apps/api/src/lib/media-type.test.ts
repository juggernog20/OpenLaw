// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The blob-side read of a media type (the INT-002 M20/6 addendum), at
 * the seam the promotion calls.
 *
 * Three rules are asserted here and nowhere else: the bytes name the
 * type and a filename never overrules them; a container's name picks
 * only among the members that container admits; bytes the table cannot
 * read are `application/octet-stream`, untyped and never an error. The
 * API suite asserts what a promotion stores. This suite pins the table
 * itself, edge by edge.
 */

import { describe, expect, it } from "vitest";
import { mediaTypeOfBlob, MEDIA_TYPE_HEAD_BYTES, UNTYPED_MEDIA_TYPE } from "./media-type.js";
import { renderFamilyOf } from "./render-family.js";

/** A head from an ASCII marker, followed by any raw bytes given. */
function head(marker: string, ...tail: number[]): Uint8Array {
  return Uint8Array.from([...[...marker].map((c) => c.charCodeAt(0)), ...tail]);
}

/** A head from raw bytes. */
function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

describe("mediaTypeOfBlob", () => {
  it("names the single-format signatures off the bytes alone", () => {
    expect(mediaTypeOfBlob(head("%PDF-1.7 x"), "draft.pdf")).toBe("application/pdf");
    expect(mediaTypeOfBlob(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "scan.png")).toBe(
      "image/png",
    );
    expect(mediaTypeOfBlob(bytes(0xff, 0xd8, 0xff, 0xe0), "scan.jpg")).toBe("image/jpeg");
    expect(mediaTypeOfBlob(head("GIF87a"), "old.gif")).toBe("image/gif");
    expect(mediaTypeOfBlob(head("GIF89a"), "new.gif")).toBe("image/gif");
    expect(mediaTypeOfBlob(head("{\\rtf1\\ansi"), "memo.rtf")).toBe("application/rtf");
  });

  it("asks a RIFF box for its form, and an ISO box for its brand", () => {
    expect(
      mediaTypeOfBlob(
        head("RIFF", 1, 2, 3, 4, ...[..."WEBP"].map((c) => c.charCodeAt(0))),
        "photo.webp",
      ),
    ).toBe("image/webp");
    // A WAV is the same box with another form, and this table does not
    // name audio.
    expect(
      mediaTypeOfBlob(
        head("RIFF", 1, 2, 3, 4, ...[..."WAVE"].map((c) => c.charCodeAt(0))),
        "note.wav",
      ),
    ).toBe(UNTYPED_MEDIA_TYPE);
    expect(mediaTypeOfBlob(head("\0\0\0\x1cftypavif"), "photo.avif")).toBe("image/avif");
    expect(mediaTypeOfBlob(head("\0\0\0\x1cftypavis"), "clip.avif")).toBe("image/avif");
    // An MP4's brand is not AVIF's, and this table does not name video.
    expect(mediaTypeOfBlob(head("\0\0\0\x1cftypisom"), "clip.mp4")).toBe(UNTYPED_MEDIA_TYPE);
  });

  it("lets the name pick among the members a zip admits, and nothing else", () => {
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "draft.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "board.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "memo.odt")).toBe(
      "application/vnd.oasis.opendocument.text",
    );
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "slides.odp")).toBe(
      "application/vnd.oasis.opendocument.presentation",
    );
    // The empty-archive head is the same box.
    expect(mediaTypeOfBlob(bytes(...ZIP_EMPTY), "draft.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    // Case comes off the name, not the table.
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "DRAFT.DOCX")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    // A zip called .pdf is not a PDF: the box does not admit that
    // member, so the name loses and the answer is the widest true one.
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "claims.pdf")).toBe(UNTYPED_MEDIA_TYPE);
    // A spreadsheet is a member nothing downstream routes, so it is
    // absent from the table rather than named for nobody (DOC-004).
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "fees.xlsx")).toBe(UNTYPED_MEDIA_TYPE);
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "bundle.zip")).toBe(UNTYPED_MEDIA_TYPE);
  });

  it("does the same for an OLE2 compound file", () => {
    expect(mediaTypeOfBlob(bytes(...OLE2), "legacy.doc")).toBe("application/msword");
    expect(mediaTypeOfBlob(bytes(...OLE2), "deck.ppt")).toBe("application/vnd.ms-powerpoint");
    expect(mediaTypeOfBlob(bytes(...OLE2), "dispute.msg")).toBe("application/vnd.ms-outlook");
    expect(mediaTypeOfBlob(bytes(...OLE2), "fees.xls")).toBe(UNTYPED_MEDIA_TYPE);
  });

  it("looks members up by own key only, so a hostile name reads no prototype", () => {
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "notes.__proto__")).toBe(UNTYPED_MEDIA_TYPE);
    expect(mediaTypeOfBlob(bytes(...ZIP_LOCAL), "notes.constructor")).toBe(UNTYPED_MEDIA_TYPE);
  });

  it("answers untyped for bytes it cannot read, however short", () => {
    expect(mediaTypeOfBlob(head("plain words, not a PDF"), "notes.pdf")).toBe(UNTYPED_MEDIA_TYPE);
    expect(mediaTypeOfBlob(bytes(), "empty.pdf")).toBe(UNTYPED_MEDIA_TYPE);
    // A head shorter than a signature matches nothing rather than
    // reading past the end.
    expect(mediaTypeOfBlob(head("%PD"), "cut-short.pdf")).toBe(UNTYPED_MEDIA_TYPE);
  });

  it("names only types the render table routes, so nothing it asserts is unroutable", () => {
    // The module's own invariant, checked over every answer above:
    // whatever this table names, `render-family.ts` has a family for.
    // None may fall to the catch-all an unknown type would get.
    const named: [Uint8Array, string][] = [
      [head("%PDF-1.7"), "draft.pdf"],
      [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "scan.png"],
      [bytes(0xff, 0xd8, 0xff, 0xe0), "scan.jpg"],
      [head("GIF89a"), "new.gif"],
      [head("{\\rtf1"), "memo.rtf"],
      [bytes(...ZIP_LOCAL), "draft.docx"],
      [bytes(...ZIP_LOCAL), "board.pptx"],
      [bytes(...ZIP_LOCAL), "memo.odt"],
      [bytes(...ZIP_LOCAL), "slides.odp"],
      [bytes(...OLE2), "legacy.doc"],
      [bytes(...OLE2), "deck.ppt"],
      [bytes(...OLE2), "dispute.msg"],
    ];
    for (const [blobHead, filename] of named) {
      const mediaType = mediaTypeOfBlob(blobHead, filename);
      expect(mediaType, filename).not.toBe(UNTYPED_MEDIA_TYPE);
      expect(renderFamilyOf(mediaType, "no-extension"), filename).not.toBe("other");
    }
  });

  it("asks for a head long enough for its own longest signature", () => {
    // The AVIF brand ends at byte 12, the deepest read the table makes.
    expect(MEDIA_TYPE_HEAD_BYTES).toBeGreaterThanOrEqual(12);
  });
});
