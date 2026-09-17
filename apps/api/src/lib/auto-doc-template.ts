// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002: detection and fill share this pure scan of merged Word text. */
import type { Node as XmlNode } from "@xmldom/xmldom";
import { xmlPart, zipEntries } from "./docx-package.js";

/** Bounded at 120 characters, the length the form editor saves, so detection
 * never mints a field name the editor cannot write back. */
export const AUTO_DOC_SLUG = /^[a-z][a-z0-9_]{0,119}$/;
export const AUTO_DOC_TEXT_STYLES = ["bold", "underline", "italic"] as const;
export type AutoDocTextStyle = (typeof AUTO_DOC_TEXT_STYLES)[number];
export function isAutoDocTextStyle(value: string | undefined): value is AutoDocTextStyle {
  return AUTO_DOC_TEXT_STYLES.some((style) => style === value);
}
export interface TemplateToken {
  kind: "placeholder" | "block_open" | "block_close";
  name: string;
  start: number;
  end: number;
  directive?: string;
}
export interface TemplateDirective {
  slug: string;
  directive: string;
}
export interface TemplateDetection {
  placeholders: string[];
  blocks: string[];
  /** Absent in scans saved before directives were detected. */
  directives?: TemplateDirective[];
}
export class TemplateDetectionError extends Error {
  constructor(reason: string, offending: string) {
    super(`${reason}: ${JSON.stringify(offending.trimEnd().slice(0, 300))}`);
    this.name = "TemplateDetectionError";
  }
}

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function parseAutoDocPlaceholder(content: string): { name: string; directive?: string } {
  const [name = "", directive, ...extra] = content.split("|").map((part) => part.trim());
  if (!AUTO_DOC_SLUG.test(name))
    throw new TemplateDetectionError(
      "Use a valid slug for the Placeholder or Block name",
      `{{${content}}}`,
    );
  if (
    extra.length ||
    (directive !== undefined &&
      !isAutoDocTextStyle(directive) &&
      !/^(?:upper|date:(?:YYYY-MM-DD|DD\/MM\/YYYY|MMMM D, YYYY)|currency:[A-Z]{3})$/.test(
        directive,
      ))
  )
    throw new TemplateDetectionError(
      "Use bold, underline, italic, upper, a supported date format, or currency with a three-letter code",
      `{{${content}}}`,
    );
  if (directive?.startsWith("currency:")) {
    const code = directive.slice(9);
    if (!SUPPORTED_CURRENCIES.has(code))
      throw new TemplateDetectionError("Use a supported currency code", `{{${content}}}`);
  }
  return { name, ...(directive === undefined ? {} : { directive }) };
}

export function scanTemplateText(text: string): TemplateDetection & { tokens: TemplateToken[] } {
  const tokens: TemplateToken[] = [];
  const placeholders: string[] = [];
  const blocks: string[] = [];
  const open: { name: string; text: string }[] = [];
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf("{{", offset);
    const strayClose = text.indexOf("}}", offset);
    if (strayClose !== -1 && (start === -1 || strayClose < start))
      throw new TemplateDetectionError("A marker closes without an opening brace", "}}");
    if (start === -1) break;
    const close = text.indexOf("}}", start + 2);
    const next = text.indexOf("{{", start + 2);
    if (close === -1 || (next !== -1 && next < close))
      throw new TemplateDetectionError(
        "Unclosed Placeholder brace",
        text.slice(start, next === -1 ? undefined : next),
      );
    const end = close + 2;
    const quoted = text.slice(start, end);
    const content = text.slice(start + 2, close).trim();
    if (content === "/block") {
      const block = open.pop();
      if (!block) throw new TemplateDetectionError("A Block closes without an opening tag", quoted);
      tokens.push({ kind: "block_close", name: block.name, start, end });
    } else {
      const isBlock = content.startsWith("#block ");
      const parsed = isBlock ? { name: content.slice(7).trim() } : parseAutoDocPlaceholder(content);
      const { name } = parsed;
      if (!AUTO_DOC_SLUG.test(name))
        throw new TemplateDetectionError(
          "Use a valid slug for the Placeholder or Block name",
          quoted,
        );
      if (isBlock) {
        open.push({ name, text: quoted });
        if (!blocks.includes(name)) blocks.push(name);
      } else placeholders.push(name);
      tokens.push({ kind: isBlock ? "block_open" : "placeholder", ...parsed, start, end });
    }
    offset = end;
  }
  if (open.length) throw new TemplateDetectionError("Unclosed Block", open.at(-1)!.text);
  return { placeholders, blocks, tokens };
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function wordText(node: XmlNode): string {
  const pieces: string[] = [];
  function visit(current: XmlNode) {
    if (
      current.nodeType === 1 &&
      "localName" in current &&
      "namespaceURI" in current &&
      current.namespaceURI === WORD_NS
    ) {
      if (current.localName === "t") {
        pieces.push(current.textContent ?? "");
        return;
      }
      if (current.localName === "tab") pieces.push("\t");
      if (current.localName === "br" || current.localName === "cr") pieces.push("\n");
    }
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child);
    if (
      current.nodeType === 1 &&
      "localName" in current &&
      "namespaceURI" in current &&
      current.namespaceURI === WORD_NS &&
      current.localName === "p"
    )
      pieces.push("\n");
  }
  visit(node);
  return pieces.join("");
}

/** Main text comes first, followed by the other Word text parts in name order. */
export function templateTextParts(bytes: Buffer): { name: string; text: string }[] {
  const entries = zipEntries(bytes);
  const names = [
    "word/document.xml",
    ...[...entries.keys()]
      .filter((name) => /^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name))
      .sort(),
  ];
  if (
    names.reduce((total, name) => total + (entries.get(name)?.uncompressedSize ?? 0), 0) >
    64 * 1024 * 1024
  )
    throw new Error("The Word template text exceeds 64 MiB.");
  return names.map((name) => {
    const document = xmlPart(bytes, entries, name, true)!;
    const root = document.documentElement;
    if (
      !root ||
      root.namespaceURI !== WORD_NS ||
      (name === "word/document.xml" && root.localName !== "document")
    )
      throw new Error(`The Word file has an invalid ${name} part.`);
    return { name, text: wordText(document) };
  });
}

export function detectAutoDocTemplate(bytes: Buffer): TemplateDetection {
  const placeholders: string[] = [];
  const blocks: string[] = [];
  const directives: TemplateDirective[] = [];
  for (const part of templateTextParts(bytes)) {
    const found = scanTemplateText(part.text);
    placeholders.push(...found.placeholders);
    for (const block of found.blocks) if (!blocks.includes(block)) blocks.push(block);
    for (const token of found.tokens)
      if (
        token.kind === "placeholder" &&
        token.directive !== undefined &&
        !directives.some((held) => held.slug === token.name && held.directive === token.directive)
      )
        directives.push({ slug: token.name, directive: token.directive });
  }
  return { placeholders, blocks, directives };
}
