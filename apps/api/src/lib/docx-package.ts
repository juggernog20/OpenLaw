// SPDX-License-Identifier: AGPL-3.0-only

/** DOC-003 and TECH-028: bounded ZIP and XML reads for Word comparison and Auto-Doc detection. */
import { inflateRawSync } from "node:zlib";
import { DOMParser, type DOMParserOptions, type Document as XmlDocument } from "@xmldom/xmldom";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_XML_PART_BYTES = 64 * 1024 * 1024;
/**
 * The most entries one package may hold. A Word file carries tens of
 * parts, a large one a few hundred. Past this the package is not a
 * template, and each entry costs a directory walk and an inflate.
 */
export const MAX_ZIP_ENTRIES = 2000;

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
  if (count > MAX_ZIP_ENTRIES)
    throw new Error(`The Word file holds more than ${MAX_ZIP_ENTRIES} ZIP entries.`);
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

/**
 * Inflates one entry. The declared size is a claim, so the inflate stops
 * at `maxBytes` whatever the directory says, and a body that does not
 * match its declared size is refused.
 */
export function readZipEntry(
  packageBytes: Buffer,
  entry: ZipEntry,
  maxBytes = MAX_XML_PART_BYTES,
): Buffer {
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`The Word XML part exceeds ${maxBytes} bytes.`);
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
    try {
      body = inflateRawSync(compressed, { maxOutputLength: maxBytes });
    } catch (error) {
      if (isOutputTooLarge(error))
        throw new Error(
          `The Word file has a ZIP entry that inflates past ${formatBytes(maxBytes)}.`,
          { cause: error },
        );
      throw new Error("The Word file has a ZIP entry that does not inflate.", { cause: error });
    }
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

/** Sizes in the unit the ceiling was stated in, so a message reads as the limit does. */
function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

function isOutputTooLarge(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ERR_BUFFER_TOO_LARGE")
  );
}

/**
 * Inflates every entry against `maxExpandedBytes` and refuses the package
 * when the total passes it. The central directory's declared sizes are
 * not trusted: each inflate is bounded by what the ceiling still allows,
 * and an entry whose body does not match its declared size is refused.
 * Runs at upload and again before the fill, so a package stored before
 * this guard is refused too.
 */
export function verifyZipPackage(packageBytes: Buffer, maxExpandedBytes: number): void {
  const entries = zipEntries(packageBytes);
  let total = 0;
  for (const [name, entry] of entries) {
    const remaining = maxExpandedBytes - total;
    if (remaining <= 0 || entry.uncompressedSize > remaining)
      throw new Error(`The expanded Word template exceeds ${formatBytes(maxExpandedBytes)}.`);
    let body: Buffer;
    try {
      body = readZipEntry(packageBytes, entry, remaining);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The Word file could not be read.";
      throw new Error(`${reason} (${name})`, { cause: error });
    }
    total += body.byteLength;
  }
}

const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const WORDPROCESSING_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const HYPERLINK_RELATIONSHIP = /\/hyperlink$/;
const MACRO_CONTENT_TYPE = /vbaProject|vbaData|macroEnabled/i;
const MACRO_PART = /^word\/vba(?:Project\.bin|Data\.xml)$/;
/** Field keywords that pull content from outside the package or run a
 * DDE server. IMPORT is the older name of INCLUDEPICTURE. */
const REFUSED_FIELD_KEYWORDS = new Set([
  "DDE",
  "DDEAUTO",
  "INCLUDETEXT",
  "INCLUDEPICTURE",
  "IMPORT",
]);

/** A template part the Auto-Doc upload refuses, with the reason a Member can act on. */
export class DocxScreeningError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocxScreeningError";
  }
}

type XmlElement = XmlDocument["documentElement"] & object;
function elements(root: XmlDocument, visit: (element: XmlElement) => void): void {
  function walk(node: XmlElement | null) {
    if (!node) return;
    if (node.nodeType === 1) visit(node);
    for (let child = node.firstChild; child; child = child.nextSibling)
      walk(child as unknown as XmlElement);
  }
  walk(root.documentElement as XmlElement | null);
}
function isNamed(element: XmlElement, namespace: string, localName: string): boolean {
  return element.namespaceURI === namespace && element.localName === localName;
}
function relationshipLabel(type: string): string {
  const name = type.slice(type.lastIndexOf("/") + 1);
  return name || type;
}

/**
 * Refuses the Word parts that let a filled document reach outside itself:
 * external relationships other than hyperlinks, a macro project or a
 * macro-enabled content type, and fields that pull content or run DDE.
 * Throws {@link DocxScreeningError} naming the first reason found.
 */
export function screenDocxPackage(packageBytes: Buffer): void {
  let entries: Map<string, ZipEntry>;
  try {
    entries = zipEntries(packageBytes);
  } catch (error) {
    throw new DocxScreeningError(
      error instanceof Error ? error.message : "The Word file could not be read.",
      { cause: error },
    );
  }
  const part = (name: string): XmlDocument => {
    try {
      return xmlPart(packageBytes, entries, name, true);
    } catch (error) {
      throw new DocxScreeningError(
        error instanceof Error ? error.message : `The Word file has an unreadable ${name} part.`,
        { cause: error },
      );
    }
  };
  for (const name of entries.keys()) {
    if (MACRO_PART.test(name))
      throw new DocxScreeningError(`The Word file carries a macro project (${name}).`);
  }
  if (entries.has("[Content_Types].xml"))
    elements(part("[Content_Types].xml"), (element) => {
      if (
        !isNamed(element, CONTENT_TYPES_NS, "Default") &&
        !isNamed(element, CONTENT_TYPES_NS, "Override")
      )
        return;
      const contentType = element.getAttribute("ContentType") ?? "";
      if (MACRO_CONTENT_TYPE.test(contentType))
        throw new DocxScreeningError(
          `The Word file declares a macro-enabled content type (${contentType}).`,
        );
    });
  for (const name of [...entries.keys()].filter((name) => name.endsWith(".rels")))
    elements(part(name), (element) => {
      if (!isNamed(element, RELATIONSHIPS_NS, "Relationship")) return;
      const type = element.getAttribute("Type") ?? "";
      if (/\/vbaProject$/.test(type))
        throw new DocxScreeningError(`The Word file links a macro project in ${name}.`);
      const external = (element.getAttribute("TargetMode") ?? "").toLowerCase() === "external";
      if (external && !HYPERLINK_RELATIONSHIP.test(type))
        throw new DocxScreeningError(
          `The Word file has an external ${relationshipLabel(type)} link in ${name}. Only hyperlinks may point outside the file.`,
        );
    });
  for (const name of [...entries.keys()].filter(
    (name) => name.startsWith("word/") && name.endsWith(".xml"),
  )) {
    const open: string[] = [];
    const refuse = (instruction: string) => {
      const keyword = instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
      if (REFUSED_FIELD_KEYWORDS.has(keyword))
        throw new DocxScreeningError(`The Word file has a ${keyword} field in ${name}.`);
    };
    elements(part(name), (element) => {
      if (isNamed(element, WORDPROCESSING_NS, "fldSimple"))
        refuse(element.getAttributeNS(WORDPROCESSING_NS, "instr") ?? "");
      else if (isNamed(element, WORDPROCESSING_NS, "fldChar")) {
        const kind = element.getAttributeNS(WORDPROCESSING_NS, "fldCharType");
        if (kind === "begin") open.push("");
        else if (kind === "separate" || kind === "end") {
          const instruction = open.pop();
          if (instruction !== undefined) refuse(instruction);
        }
      } else if (isNamed(element, WORDPROCESSING_NS, "instrText")) {
        const text = element.textContent ?? "";
        if (open.length) open[open.length - 1] += text;
        else refuse(text);
      }
    });
    for (const instruction of open) refuse(instruction);
  }
}
