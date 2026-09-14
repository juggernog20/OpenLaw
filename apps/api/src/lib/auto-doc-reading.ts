// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The template reading (DES-087): a Word template's text, paragraph by
 * paragraph, with each Placeholder and Block marker typed so the form
 * builder can draw them as chips beside the form that fills them.
 *
 * It is a reading, not a rendering. Paragraphs and line breaks keep;
 * tables flatten to their paragraphs; the other Word parts follow the
 * body under their part name. The true page is the Document reader.
 */
import { scanTemplateText, templateTextParts } from "./auto-doc-template.js";

export type ReadingSegment =
  | { kind: "text"; text: string }
  | { kind: "placeholder"; text: string; name: string; directive: string | null; hasField: boolean }
  | { kind: "block_open"; name: string }
  | { kind: "block_close"; name: string };

export type ReadingPart = {
  name: string;
  kind: "body" | "header" | "footer" | "footnotes" | "endnotes";
  paragraphs: ReadingSegment[][];
};

function partKind(name: string): ReadingPart["kind"] {
  if (name === "word/document.xml") return "body";
  if (/^word\/header\d+\.xml$/.test(name)) return "header";
  if (/^word\/footer\d+\.xml$/.test(name)) return "footer";
  if (name === "word/footnotes.xml") return "footnotes";
  return "endnotes";
}

/**
 * Splits one part's text into paragraphs of typed segments. `slugs` is
 * the set of form field slugs the newest form version holds, so an
 * unfilled Placeholder can say so in the reading.
 */
export function readTemplatePart(text: string, slugs: ReadonlySet<string>): ReadingSegment[][] {
  const { tokens } = scanTemplateText(text);
  const paragraphs: ReadingSegment[][] = [];
  let current: ReadingSegment[] = [];
  function pushText(chunk: string) {
    const lines = chunk.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) {
        paragraphs.push(current);
        current = [];
      }
      if (line) current.push({ kind: "text", text: line });
    });
  }
  let offset = 0;
  for (const token of tokens) {
    pushText(text.slice(offset, token.start));
    if (token.kind === "placeholder")
      current.push({
        kind: "placeholder",
        text: text.slice(token.start, token.end),
        name: token.name,
        directive: token.directive ?? null,
        hasField: slugs.has(token.name),
      });
    else current.push({ kind: token.kind, name: token.name });
    offset = token.end;
  }
  pushText(text.slice(offset));
  paragraphs.push(current);
  // A blank paragraph carries nothing a reader can act on; the card's
  // paragraph rhythm keeps the spacing.
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

/** The whole file: the body first, then the other text parts in name order. */
export function readTemplate(bytes: Buffer, slugs: ReadonlySet<string>): ReadingPart[] {
  return templateTextParts(bytes)
    .map((part) => ({
      name: part.name,
      kind: partKind(part.name),
      paragraphs: readTemplatePart(part.text, slugs),
    }))
    .filter((part) => part.paragraphs.length > 0);
}
