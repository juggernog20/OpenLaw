// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What a stored blob's own bytes say it is (the INT-002 M20/6 addendum,
 * DOC-004).
 *
 * An upload declares its media type and the API stores that declaration
 * as a hint — unverified, never echoed back by a preview, and treated as
 * a rendering suggestion rather than a fact (`render-family.ts`). **A
 * Request's attachment declares nothing**: `request_attachments` stores
 * no media type on purpose, because nothing on that side of conversion
 * reads one. So the promotion that turns one into a document has no
 * declaration to carry, and the M20/6 addendum says where the facts a
 * document needs come from instead: "a promotion that needs those facts
 * reads them off the blob".
 *
 * This is that read. It is deliberately small, and three rules keep it
 * that way.
 *
 * **The bytes name the type, and the name never overrules them.** Each
 * signature below is the one the format's own specification puts at the
 * head of the file. A file whose head matches nothing is
 * {@link UNTYPED_MEDIA_TYPE} — the widest thing that is always true, and
 * the same answer an upload that declared nothing gets. It is not a
 * failure: `render-family.ts` falls through to the filename for exactly
 * this case, so a `.docx` this module cannot name still routes to the
 * Word family and still asks the pipeline for its rendition.
 *
 * **Where a container holds several formats, the name picks among the
 * ones that container admits.** A `.docx` and a `.pptx` are both a zip,
 * and a `.doc` and a `.msg` are both an OLE2 compound file: the bytes
 * name the box and only the name tells the contents apart. A name the
 * box does not admit is not believed — a zip called `.pdf` is untyped
 * rather than a PDF.
 *
 * **The table names only types something downstream reads.** Every
 * answer here is a key in `render-family.ts`'s own table, so this module
 * can never assert a type nothing knows what to do with. BMP is absent
 * for the opposite reason: its signature is the two ASCII characters
 * `BM`, which is a coincidence rather than a fact, and a `.bmp` routes
 * by its name anyway.
 */

import { extensionOf } from "./render-family.js";

/**
 * How many bytes of the head {@link mediaTypeOfBlob} needs.
 *
 * The longest signature below reaches byte 12 (the AVIF brand), so 16 is
 * enough with room to spare — and small enough that a caller streaming a
 * blob can hold it without thinking about memory.
 */
export const MEDIA_TYPE_HEAD_BYTES = 16;

/**
 * What bytes nothing recognises are called — the widest thing that is
 * always true (DOC-004), and what a Request's attachment download
 * already answers.
 */
export const UNTYPED_MEDIA_TYPE = "application/octet-stream";

/** A box the bytes can name whose contents they cannot. */
type Container = "zip" | "ole2";

/**
 * Which member of a container a filename picks.
 *
 * Keyed by lowercase extension. Everything here is a type
 * `render-family.ts` routes; a container member it does not route — a
 * spreadsheet, which DOC-004 leaves download-only either way — is absent
 * rather than named for nobody.
 */
const CONTAINER_MEMBERS: Readonly<Record<Container, Readonly<Record<string, string>>>> = {
  zip: {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    odp: "application/vnd.oasis.opendocument.presentation",
  },
  ole2: {
    doc: "application/msword",
    ppt: "application/vnd.ms-powerpoint",
    msg: "application/vnd.ms-outlook",
  },
};

/** One head signature, and what matching it means. */
interface Signature {
  /** The bytes, and where in the head they sit. */
  parts: readonly { at: number; bytes: readonly number[] }[];
  /** The media type these bytes are, or the container they are a box
   * for. */
  says: string | { container: Container };
}

/** One ASCII marker as bytes, so the table reads as the specifications
 * write it. */
function ascii(marker: string): readonly number[] {
  return [...marker].map((character) => character.charCodeAt(0));
}

/**
 * The signatures, in the order they are asked.
 *
 * Order matters only where one prefix could match two rows, which it
 * cannot here: every row starts at a different byte string.
 */
const SIGNATURES: readonly Signature[] = [
  { parts: [{ at: 0, bytes: ascii("%PDF-") }], says: "application/pdf" },
  {
    parts: [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    says: "image/png",
  },
  // SOI plus the marker byte that always follows it. Three bytes rather
  // than four, because the fourth is the segment type and varies by
  // encoder.
  { parts: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }], says: "image/jpeg" },
  { parts: [{ at: 0, bytes: ascii("GIF87a") }], says: "image/gif" },
  { parts: [{ at: 0, bytes: ascii("GIF89a") }], says: "image/gif" },
  // A RIFF container whose form is WEBP. The form is what makes it an
  // image rather than, say, a WAV.
  {
    parts: [
      { at: 0, bytes: ascii("RIFF") },
      { at: 8, bytes: ascii("WEBP") },
    ],
    says: "image/webp",
  },
  // An ISO base media file whose brand is AVIF. `avis` is the sequence
  // brand — an animated one — and it is the same media type.
  {
    parts: [
      { at: 4, bytes: ascii("ftyp") },
      { at: 8, bytes: ascii("avif") },
    ],
    says: "image/avif",
  },
  {
    parts: [
      { at: 4, bytes: ascii("ftyp") },
      { at: 8, bytes: ascii("avis") },
    ],
    says: "image/avif",
  },
  { parts: [{ at: 0, bytes: ascii("{\\rtf1") }], says: "application/rtf" },
  // The three heads a zip can start with: a local file header, which is
  // an archive with entries in it; an end-of-central-directory record,
  // which is an empty archive; and the spanning marker.
  { parts: [{ at: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }], says: { container: "zip" } },
  { parts: [{ at: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }], says: { container: "zip" } },
  { parts: [{ at: 0, bytes: [0x50, 0x4b, 0x07, 0x08] }], says: { container: "zip" } },
  {
    parts: [{ at: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
    says: { container: "ole2" },
  },
];

/** Whether every part of one signature sits where it says it does. */
function matches(head: Uint8Array, signature: Signature): boolean {
  return signature.parts.every((part) =>
    part.bytes.every((byte, index) => head[part.at + index] === byte),
  );
}

/**
 * The media type of a stored blob, from the first
 * {@link MEDIA_TYPE_HEAD_BYTES} bytes of it and the name it arrived
 * under.
 *
 * `head` may be shorter than that — a file of three bytes has three —
 * and a short head simply matches fewer signatures. The answer is always
 * a media type: {@link UNTYPED_MEDIA_TYPE} when the bytes say nothing
 * this module can read.
 */
export function mediaTypeOfBlob(head: Uint8Array, filename: string): string {
  for (const signature of SIGNATURES) {
    if (!matches(head, signature)) continue;
    if (typeof signature.says === "string") return signature.says;
    const members = CONTAINER_MEMBERS[signature.says.container];
    // By own key only: the extension comes off a filename somebody
    // chose, and a bare index would answer for keys nobody wrote.
    const extension = extensionOf(filename);
    return Object.hasOwn(members, extension) ? members[extension]! : UNTYPED_MEDIA_TYPE;
  }
  return UNTYPED_MEDIA_TYPE;
}
