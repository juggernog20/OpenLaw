// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads the part of a tracked-changes Word file that the DOC-003 compare
 * screen needs. The parser does no I/O and runs no document engine. A
 * caller gives it the complete OOXML package and gets one change model.
 */

import { inflateRawSync } from "node:zlib";
import {
  DOMParser,
  type DOMParserOptions,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_XML_PART_BYTES = 64 * 1024 * 1024;
const EXCERPT_LENGTH = 180;

export type ChangeKind = "unchanged" | "inserted" | "deleted";

export interface ChangeRun {
  text: string;
  change: ChangeKind;
}

export interface ChangeParagraph {
  index: number;
  style: "heading" | "body";
  /**
   * The clause this paragraph is under, for the change pane's reference.
   *
   * It comes from Word's numbering when the paragraph has some, and is
   * otherwise read off the front of the text. Either way it names the
   * clause; it does not say whether the text already prints it.
   */
  label: string | null;
  /**
   * The number Word generates for this paragraph, which its text does
   * not contain.
   *
   * Word holds an auto-numbered paragraph's number outside the runs, so
   * a comparison that drew only the runs would lose the numbering of
   * every auto-numbered contract. This carries it back. It is null when
   * the number is already the first thing in the text, because drawing
   * it then would print the clause number twice.
   */
  numberPrefix: string | null;
  runs: ChangeRun[];
}

export interface DocumentChange {
  id: string;
  paragraphIndex: number;
  kind: Exclude<ChangeKind, "unchanged"> | "replaced";
  ref: string;
  excerpt: string;
}

export interface ChangeModel {
  paragraphs: ChangeParagraph[];
  changes: DocumentChange[];
}

interface ZipEntry {
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function zipEntries(packageBytes: Buffer): Map<string, ZipEntry> {
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

function readZipEntry(packageBytes: Buffer, entry: ZipEntry): Buffer {
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

function xmlPart(
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

function elements(node: XmlNode): XmlElement[] {
  const answer: XmlElement[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) answer.push(child as XmlElement);
  }
  return answer;
}

function children(node: XmlNode, localName: string): XmlElement[] {
  return elements(node).filter((child) => child.localName === localName);
}

function child(node: XmlNode, localName: string): XmlElement | undefined {
  return elements(node).find((candidate) => candidate.localName === localName);
}

/** Wrappers Word puts around block content without changing its reading order. */
const TRANSPARENT_WRAPPERS = new Set(["sdt", "sdtContent", "customXml"]);

/**
 * The children of `node` named in `localNames`, in document order,
 * looking through content controls and custom XML wrappers. A cover
 * page or a table of contents sits inside a `w:sdt`, and a change
 * model that skipped it would show nothing for a change made there.
 */
function blocks(node: XmlNode, localNames: readonly string[]): XmlElement[] {
  const answer: XmlElement[] = [];
  for (const element of elements(node)) {
    const name = element.localName ?? "";
    if (localNames.includes(name)) answer.push(element);
    else if (TRANSPARENT_WRAPPERS.has(name)) answer.push(...blocks(element, localNames));
  }
  return answer;
}

function value(element: XmlElement | undefined, name = "val"): string | undefined {
  return element?.getAttributeNS(W_NS, name) ?? element?.getAttribute(`w:${name}`) ?? undefined;
}

function headingStyles(styles: XmlDocument | undefined): Set<string> {
  const answer = new Set<string>();
  if (!styles) return answer;
  for (const style of Array.from(styles.getElementsByTagNameNS(W_NS, "style"))) {
    if (value(style, "type") !== "paragraph") continue;
    const id = value(style, "styleId");
    const name = value(child(style, "name"));
    if (id && (headingName(id) || (name !== undefined && headingName(name)))) answer.add(id);
  }
  return answer;
}

function headingName(name: string): boolean {
  return /^heading(?:\s|\d|$)/i.test(name);
}

interface NumberLevel {
  format: string;
  text: string;
  start: number;
}

interface Numbering {
  abstractByNumber: Map<string, string>;
  levelsByAbstract: Map<string, Map<number, NumberLevel>>;
  counters: Map<string, number[]>;
}

function numberingOf(numbering: XmlDocument | undefined): Numbering {
  const answer: Numbering = {
    abstractByNumber: new Map(),
    levelsByAbstract: new Map(),
    counters: new Map(),
  };
  if (!numbering) return answer;

  for (const abstract of Array.from(numbering.getElementsByTagNameNS(W_NS, "abstractNum"))) {
    const id = value(abstract, "abstractNumId");
    if (!id) continue;
    const levels = new Map<number, NumberLevel>();
    for (const level of children(abstract, "lvl")) {
      const index = Number(value(level, "ilvl") ?? "0");
      levels.set(index, {
        format: value(child(level, "numFmt")) ?? "decimal",
        text: value(child(level, "lvlText")) ?? `%${index + 1}.`,
        start: Number(value(child(level, "start")) ?? "1"),
      });
    }
    answer.levelsByAbstract.set(id, levels);
  }
  for (const number of Array.from(numbering.getElementsByTagNameNS(W_NS, "num"))) {
    const id = value(number, "numId");
    const abstract = value(child(number, "abstractNumId"));
    if (id && abstract) answer.abstractByNumber.set(id, abstract);
  }
  return answer;
}

function alpha(value: number, upper: boolean): string {
  let number = value;
  let answer = "";
  while (number > 0) {
    number -= 1;
    answer = String.fromCharCode((upper ? 65 : 97) + (number % 26)) + answer;
    number = Math.floor(number / 26);
  }
  return answer || "0";
}

function roman(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let left = value;
  let answer = "";
  for (const [amount, glyph] of numerals) {
    while (left >= amount) {
      answer += glyph;
      left -= amount;
    }
  }
  return answer;
}

function formattedNumber(number: number, format: string): string {
  switch (format) {
    case "lowerLetter":
      return alpha(number, false);
    case "upperLetter":
      return alpha(number, true);
    case "lowerRoman":
      return roman(number).toLowerCase();
    case "upperRoman":
      return roman(number);
    default:
      return String(number);
  }
}

function numberingLabel(paragraph: XmlElement, numbering: Numbering): string | null {
  const properties = child(paragraph, "pPr");
  const numberProperties = properties && child(properties, "numPr");
  const numberId = value(numberProperties && child(numberProperties, "numId"));
  const levelIndex = Number(value(numberProperties && child(numberProperties, "ilvl")) ?? "0");
  if (!numberId) return null;
  const abstractId = numbering.abstractByNumber.get(numberId);
  const levels = abstractId ? numbering.levelsByAbstract.get(abstractId) : undefined;
  const level = levels?.get(levelIndex);
  if (!levels || !level) return null;

  const counters = numbering.counters.get(numberId) ?? [];
  counters[levelIndex] = (counters[levelIndex] ?? level.start - 1) + 1;
  counters.length = levelIndex + 1;
  numbering.counters.set(numberId, counters);
  return level.text.replaceAll(/%(\d+)/g, (_match, raw: string) => {
    const index = Number(raw) - 1;
    const definition = levels.get(index) ?? level;
    return formattedNumber(counters[index] ?? definition.start, definition.format);
  });
}

function appendRun(runs: ChangeRun[], text: string, change: ChangeKind): void {
  if (!text) return;
  const previous = runs.at(-1);
  if (previous?.change === change) previous.text += text;
  else runs.push({ text, change });
}

function paragraphRuns(paragraph: XmlElement): ChangeRun[] {
  const runs: ChangeRun[] = [];
  let fieldDepth = 0;

  function visit(node: XmlNode, change: ChangeKind): void {
    if (node.nodeType !== 1) return;
    const element = node as XmlElement;
    const name = element.localName;
    // Properties carry no text. `w:pPr/w:tabs/w:tab` is a tab stop, not
    // a tab character, and would otherwise read as one.
    if (name === "pPr" || name === "rPr") return;
    if (name === "fldSimple" || name === "drawing" || name === "pict" || name === "object") return;
    if (name === "fldChar") {
      const kind = value(element, "fldCharType");
      if (kind === "begin") fieldDepth += 1;
      else if (kind === "end") fieldDepth = Math.max(0, fieldDepth - 1);
      return;
    }
    if (name === "instrText") return;
    const nestedChange =
      name === "ins" || name === "moveTo"
        ? "inserted"
        : name === "del" || name === "moveFrom"
          ? "deleted"
          : change;
    if (fieldDepth === 0 && (name === "t" || name === "delText")) {
      appendRun(runs, element.textContent ?? "", nestedChange);
      return;
    }
    if (fieldDepth === 0 && name === "tab") appendRun(runs, "\t", nestedChange);
    if (fieldDepth === 0 && (name === "br" || name === "cr")) appendRun(runs, "\n", nestedChange);
    for (const nested of elements(element)) visit(nested, nestedChange);
  }

  for (const element of elements(paragraph)) visit(element, "unchanged");
  return runs;
}

/** "2.", "2.4", or "2.4." at the start of the text, followed by a space. */
export function leadingClauseLabel(text: string): string | null {
  const match = /^\s*((?:\d+\.)+\d+\.?|\d+\.)(?=\s)/u.exec(text);
  return match?.[1] ?? null;
}

/** Whether `text` already opens with `label`, ignoring leading space. */
function startsWithLabel(text: string, label: string): boolean {
  return text.trimStart().startsWith(label);
}

interface ParsedParagraph {
  style: "heading" | "body";
  label: string | null;
  numberPrefix: string | null;
  runs: ChangeRun[];
}

function parseParagraph(
  paragraph: XmlElement,
  headings: ReadonlySet<string>,
  numbering: Numbering,
): ParsedParagraph {
  const styleId = value(child(child(paragraph, "pPr") ?? paragraph, "pStyle"));
  const runs = paragraphRuns(paragraph);
  const text = runs.map((run) => run.text).join("");
  const generated = numberingLabel(paragraph, numbering);
  return {
    style: styleId && (headingName(styleId) || headings.has(styleId)) ? "heading" : "body",
    label: generated ?? leadingClauseLabel(text),
    // A generated number that the text already opens with is not drawn
    // again. Word does not normally write one twice, but a document
    // converted from another tool can carry both, and one number read
    // twice is worse than a number the file itself already shows.
    numberPrefix: generated && !startsWithLabel(text, generated) ? generated : null,
    runs,
  };
}

function tableParagraphs(
  table: XmlElement,
  headings: ReadonlySet<string>,
  numbering: Numbering,
): ParsedParagraph[] {
  const answer: ParsedParagraph[] = [];
  for (const row of blocks(table, ["tr"])) {
    for (const cell of blocks(row, ["tc"])) {
      const cellParagraphs = blocks(cell, ["p"]).map((paragraph) =>
        parseParagraph(paragraph, headings, numbering),
      );
      const first = cellParagraphs[0];
      if (!first) {
        answer.push({ style: "body", label: null, numberPrefix: null, runs: [] });
        continue;
      }
      const runs: ChangeRun[] = [];
      cellParagraphs.forEach((paragraph, index) => {
        if (index > 0) appendRun(runs, "\n", "unchanged");
        for (const run of paragraph.runs) appendRun(runs, run.text, run.change);
      });
      // A cell's paragraphs are flattened into one, so the cell keeps
      // the first paragraph's numbering rather than repeating it per
      // line.
      answer.push({
        style: first.style,
        label: first.label,
        numberPrefix: first.numberPrefix,
        runs,
      });
      for (const nested of blocks(cell, ["tbl"])) {
        answer.push(...tableParagraphs(nested, headings, numbering));
      }
    }
  }
  return answer;
}

function documentParagraphs(
  document: XmlDocument,
  headings: ReadonlySet<string>,
  numbering: Numbering,
): ParsedParagraph[] {
  const body = document.getElementsByTagNameNS(W_NS, "body").item(0);
  if (!body) throw new Error("The Word document has no body.");
  const answer: ParsedParagraph[] = [];
  for (const block of blocks(body, ["p", "tbl"])) {
    if (block.localName === "p") answer.push(parseParagraph(block, headings, numbering));
    if (block.localName === "tbl") {
      answer.push(...tableParagraphs(block, headings, numbering));
    }
  }
  return answer;
}

function oneLine(text: string): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

export function changesOf(paragraphs: ChangeParagraph[]): DocumentChange[] {
  const answer: DocumentChange[] = [];
  let nearestLabel: string | null = null;
  for (const paragraph of paragraphs) {
    if (paragraph.label) nearestLabel = paragraph.label;
    let runIndex = 0;
    while (runIndex < paragraph.runs.length) {
      const run = paragraph.runs[runIndex];
      if (!run || run.change === "unchanged") {
        runIndex += 1;
        continue;
      }
      const firstKind = run.change;
      let firstText = "";
      while (paragraph.runs[runIndex]?.change === firstKind) {
        firstText += paragraph.runs[runIndex]?.text ?? "";
        runIndex += 1;
      }
      let kind: DocumentChange["kind"] = firstKind;
      let excerpt = oneLine(firstText);
      // A substitution reaches the file as a deletion beside an
      // insertion, and Word writes the pair in either order depending on
      // how the edit was made. Both orders are one change to a reader,
      // so both fold into one `replaced` entry — otherwise the count
      // overstates the edit and the change pane offers two navigation
      // stops for one substitution. The excerpt always reads old → new,
      // whichever order the runs arrived in.
      const secondKind = firstKind === "deleted" ? "inserted" : "deleted";
      if (
        (firstKind === "deleted" || firstKind === "inserted") &&
        paragraph.runs[runIndex]?.change === secondKind
      ) {
        let secondText = "";
        while (paragraph.runs[runIndex]?.change === secondKind) {
          secondText += paragraph.runs[runIndex]?.text ?? "";
          runIndex += 1;
        }
        const [before, after] =
          firstKind === "deleted" ? [firstText, secondText] : [secondText, firstText];
        kind = "replaced";
        excerpt = oneLine(`${before} → ${after}`);
      }
      answer.push({
        id: `change-${answer.length + 1}`,
        paragraphIndex: paragraph.index,
        kind,
        ref: nearestLabel ?? `¶${paragraph.index + 1}`,
        excerpt,
      });
    }
  }
  return answer;
}

/** Parses a tracked-changes DOCX package into the model the compare screen reads. */
export function parseTrackedChangesDocx(packageBytes: Buffer): ChangeModel {
  const entries = zipEntries(packageBytes);
  const document = xmlPart(packageBytes, entries, "word/document.xml", true);
  const headings = headingStyles(xmlPart(packageBytes, entries, "word/styles.xml"));
  const numbering = numberingOf(xmlPart(packageBytes, entries, "word/numbering.xml"));
  const paragraphs = documentParagraphs(document as XmlDocument, headings, numbering).map(
    (paragraph, index): ChangeParagraph => ({ index, ...paragraph }),
  );
  return { paragraphs, changes: changesOf(paragraphs) };
}
