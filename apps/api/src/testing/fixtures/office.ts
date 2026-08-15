// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Word documents and PowerPoint decks to upload in a test (M12/4).
 *
 * A DOCX and a PPTX are ZIP packages, and both the doc engine and the
 * fake that stands in for it refuse a package that is not whole — a
 * truncated upload has the header and no central directory. So the
 * fixture is a real archive, written out by hand: exact, dependency
 * free, and the same bytes for the same label. It is the compound file
 * the email fixtures burn, one format down.
 *
 * **The archive is whole, not furnished.** It carries one stored entry
 * and a correct central directory, so any reader opens it. It does not
 * carry the parts a real Office package carries, and it does not need
 * to: nothing on the path under test opens the archive. The family is
 * chosen from the declared type and the filename (DOC-004), and the fake
 * engine checks the package's shape rather than its contents. Fidelity
 * is proved against the real image, in the doc-engine contract suite,
 * with real files.
 */

/** The one entry every fixture carries. Named for what it is, because a
 * Word part name inside a fixture uploaded as a deck would be a claim
 * this file cannot keep. */
const ENTRY_NAME = "openlaw-fixture.xml";

/** ZIP's CRC-32, written out because a fixture with a wrong checksum is
 * not the whole archive this file promises. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A whole office package carrying `label`, as a browser would send one.
 *
 * The label is what makes two fixtures different files, so each one
 * converts to its own rendition and reads back its own text.
 */
export function officePackage(label: string): Buffer {
  const name = Buffer.from(ENTRY_NAME, "ascii");
  const body = Buffer.from(label, "utf8");
  const checksum = crc32(body);

  // The local file header is thirty bytes, and every field sits at the
  // offset the format gives it. The entry is stored rather than
  // deflated, and carries no timestamp, so the same label always writes
  // the same bytes.
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // the version needed to read it
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(body.byteLength, 18); // compressed size
  local.writeUInt32LE(body.byteLength, 22); // uncompressed size
  local.writeUInt16LE(name.byteLength, 26);

  // And the central directory's entry is forty-six.
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // the version that wrote it
  central.writeUInt16LE(20, 6); // the version needed to read it
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(body.byteLength, 20);
  central.writeUInt32LE(body.byteLength, 24);
  central.writeUInt16LE(name.byteLength, 28);
  central.writeUInt32LE(0, 42); // where the local header is

  const entry = Buffer.concat([local, name, body]);
  const directory = Buffer.concat([central, name]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); // entries on this disk
  end.writeUInt16LE(1, 10); // entries in all
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(entry.byteLength, 16); // where the directory starts

  return Buffer.concat([entry, directory, end]);
}

/** The declared type a browser sends for a .docx. */
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** And for a .pptx. */
export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
