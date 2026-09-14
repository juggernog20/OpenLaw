// SPDX-License-Identifier: AGPL-3.0-only

/** DOC-003 and TECH-028: bounded ZIP and XML reads for Word comparison and Auto-Doc detection. */
import { inflateRawSync } from "node:zlib";
import { DOMParser, type DOMParserOptions, type Document as XmlDocument } from "@xmldom/xmldom";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_XML_PART_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export function zipEntries(packageBytes: Buffer): Map<string, ZipEntry> {
  const minimumEnd = Math.max(0, packageBytes.byteLength - 65_557);
  let end = -1;
  for (let offset = packageBytes.byteLength - 22; offset >= minimumEnd; offset -= 1) {
    if (packageBytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("The Word file has no ZIP central directory.");

  const count = packageBytes.readUInt16LE(end + 10);
  let offset = packageBytes.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > packageBytes.byteLength ||
      packageBytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY
    ) {
      throw new Error("The Word file has an invalid ZIP central directory.");
    }
    const nameLength = packageBytes.readUInt16LE(offset + 28);
    const extraLength = packageBytes.readUInt16LE(offset + 30);
    const commentLength = packageBytes.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > packageBytes.byteLength) {
      throw new Error("The Word file has a truncated ZIP entry name.");
    }
    entries.set(packageBytes.toString("utf8", nameStart, nameEnd), {
      compression: packageBytes.readUInt16LE(offset + 10),
      compressedSize: packageBytes.readUInt32LE(offset + 20),
      uncompressedSize: packageBytes.readUInt32LE(offset + 24),
      localOffset: packageBytes.readUInt32LE(offset + 42),
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(packageBytes: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > MAX_XML_PART_BYTES) {
    throw new Error(`The Word XML part exceeds ${MAX_XML_PART_BYTES} bytes.`);
  }
  const offset = entry.localOffset;
  if (
    offset + 30 > packageBytes.byteLength ||
    packageBytes.readUInt32LE(offset) !== LOCAL_FILE_HEADER
  ) {
    throw new Error("The Word file has an invalid ZIP local header.");
  }
  const nameLength = packageBytes.readUInt16LE(offset + 26);
  const extraLength = packageBytes.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > packageBytes.byteLength) throw new Error("The Word file has a truncated XML part.");
  const compressed = packageBytes.subarray(start, end);
  let body: Buffer;
  if (entry.compression === 0) body = Buffer.from(compressed);
  else if (entry.compression === 8) {
    body = inflateRawSync(compressed, { maxOutputLength: MAX_XML_PART_BYTES });
  } else throw new Error(`The Word file uses unsupported ZIP compression ${entry.compression}.`);
  if (body.byteLength !== entry.uncompressedSize) {
    throw new Error("The Word file has an XML part whose size does not match its directory entry.");
  }
  return body;
}

export function xmlPart(
  packageBytes: Buffer,
  entries: ReadonlyMap<string, ZipEntry>,
  name: string,
  required: true,
): XmlDocument;
export function xmlPart(
  packageBytes: Buffer,
  entries: ReadonlyMap<string, ZipEntry>,
  name: string,
  required?: boolean,
): XmlDocument | undefined;
export function xmlPart(
  packageBytes: Buffer,
  entries: ReadonlyMap<string, ZipEntry>,
  name: string,
  required = false,
): XmlDocument | undefined {
  const entry = entries.get(name);
  if (!entry) {
    if (required) throw new Error(`The Word file has no ${name} part.`);
    return undefined;
  }
  let invalid = false;
  let document: XmlDocument;
  // xmldom throws on a fatal error by itself. `onError` catches the
  // recoverable kind, which a Word part must not have either. The
  // options are a typed value, not a literal: an older xmldom typing
  // reaches this program through samlify, and a literal is checked
  // against its constructor overload too, which has no `onError`.
  const options: DOMParserOptions = {
    onError(level) {
      if (level !== "warning") invalid = true;
    },
  };
  try {
    document = new DOMParser(options).parseFromString(
      readZipEntry(packageBytes, entry).toString("utf8"),
      "application/xml",
    );
  } catch {
    throw new Error(`The Word file has invalid XML in ${name}.`);
  }
  if (invalid || !document.documentElement) {
    throw new Error(`The Word file has invalid XML in ${name}.`);
  }
  return document;
}
