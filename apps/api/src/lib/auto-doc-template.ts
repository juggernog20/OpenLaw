// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002: detection and fill share this pure scan of merged Word text. */
import type { Node as XmlNode } from "@xmldom/xmldom";
import { xmlPart, zipEntries } from "./docx-package.js";

/** Bounded at 120 characters, the length the form editor saves, so detection
 * never mints a field name the editor cannot write back. */
export const AUTO_DOC_SLUG = /^[a-z][a-z0-9_]{0,119}$/;
export interface TemplateToken {
  kind: "placeholder" | "block_open" | "block_close";
  name: string;
  start: number;
  end: number;
}
export interface TemplateDetection {
  placeholders: string[];
  blocks: string[];
}
export class TemplateDetectionError extends Error {
  constructor(reason: string, offending: string) {
    super(`${reason}: ${JSON.stringify(offending.trimEnd().slice(0, 300))}`);
    this.name = "TemplateDetectionError";
  }
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
      const name = isBlock ? content.slice(7).trim() : content;
      if (!AUTO_DOC_SLUG.test(name))
        throw new TemplateDetectionError(
          "Use a valid slug for the Placeholder or Block name",
          quoted,
        );
      if (isBlock) {
        open.push({ name, text: quoted });
        if (!blocks.includes(name)) blocks.push(name);
      } else placeholders.push(name);
      tokens.push({ kind: isBlock ? "block_open" : "placeholder", name, start, end });
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
  for (const part of templateTextParts(bytes)) {
    const found = scanTemplateText(part.text);
    placeholders.push(...found.placeholders);
    for (const block of found.blocks) if (!blocks.includes(block)) blocks.push(block);
  }
  return { placeholders, blocks };
}
