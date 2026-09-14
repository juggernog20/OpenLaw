// SPDX-License-Identifier: AGPL-3.0-only

/** KNW-001: one small Markdown grammar for Knowledge, previews, and outbound cover notes. */
export type MarkdownInline =
  | { kind: "text" | "code" | "strong" | "em"; text: string }
  | { kind: "link"; text: string; href: string };
export type MarkdownBlock =
  | { kind: "paragraph"; children: MarkdownInline[] }
  | { kind: "heading"; level: number; children: MarkdownInline[] }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: MarkdownInline[][] };
const INLINE = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
function safeHref(raw: string): string | null {
  try {
    return ["http:", "https:", "mailto:"].includes(
      new URL(raw, "https://knowledge.invalid").protocol,
    )
      ? raw
      : null;
  } catch {
    return null;
  }
}
function inline(source: string): MarkdownInline[] {
  return source
    .split(INLINE)
    .filter(Boolean)
    .map((part): MarkdownInline => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const href = safeHref(link[2]!);
        return href ? { kind: "link", text: link[1]!, href } : { kind: "text", text: link[1]! };
      }
      if (part.startsWith("`") && part.endsWith("`"))
        return { kind: "code", text: part.slice(1, -1) };
      if (
        (part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))
      )
        return { kind: "strong", text: part.slice(2, -2) };
      if (
        (part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))
      )
        return { kind: "em", text: part.slice(1, -1) };
      return { kind: "text", text: part };
    });
}
export function parseKnowledgeMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.startsWith("```")) code.push(lines[index++]!);
      if (index < lines.length) index++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, children: inline(heading[2]!) });
      index++;
      continue;
    }
    const ordered = /^\d+\.\s+(.+)$/.test(line);
    if (ordered || /^[-*]\s+(.+)$/.test(line)) {
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const match = (ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/).exec(lines[index]!);
        if (!match) break;
        items.push(inline(match[1]!));
        index++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,3})\s|^```|^[-*]\s|^\d+\.\s/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!);
    blocks.push({ kind: "paragraph", children: inline(paragraph.join(" ")) });
  }
  return blocks;
}
