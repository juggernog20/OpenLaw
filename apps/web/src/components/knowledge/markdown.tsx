// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A deliberately small Markdown renderer for Knowledge guidance.
 * It emits React elements from a fixed tag set; source HTML remains text.
 */
import { Fragment, type ReactNode } from "react";
import { FormattedMessage } from "react-intl";

const INLINE = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw, "https://knowledge.invalid");
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

function inline(source: string): ReactNode[] {
  return source
    .split(INLINE)
    .filter(Boolean)
    .map((part, index) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const href = safeHref(link[2]!);
        return href ? (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-link underline"
          >
            {link[1]}
            {/* Every Markdown link opens a new tab; a sighted reader
                sees the switch happen and a screen-reader user does
                not — the same sr-only note the deflection panel adds. */}{" "}
            <span className="sr-only">
              <FormattedMessage
                id="knowledge.markdown.newTab"
                defaultMessage="(opens in a new tab)"
              />
            </span>
          </a>
        ) : (
          <Fragment key={index}>{link[1]}</Fragment>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={index} className="rounded-chip bg-section-header px-1">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (
        (part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))
      ) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (
        (part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))
      ) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }
      return <Fragment key={index}>{part}</Fragment>;
    });
}

export function KnowledgeMarkdown({ source }: Readonly<{ source: string }>) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) code.push(lines[index++]!);
      if (index < lines.length) index += 1;
      blocks.push(
        <pre
          key={blocks.length}
          className="overflow-x-auto rounded-card bg-section-header p-3 text-sm"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      // The record page owns h1 and its Guidance section owns h2, so
      // `#` starts at h3 and the outline stays in order. A lookup
      // rather than a template-string cast: the regex admits one to
      // three marker characters, and the array states the same range
      // without asserting it.
      const headingTags = ["h3", "h4", "h5"] as const;
      const Tag = headingTags[heading[1]!.length - 1] ?? "h5";
      blocks.push(
        <Tag key={blocks.length} className="font-semibold">
          {inline(heading[2]!)}
        </Tag>,
      );
      index += 1;
      continue;
    }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const match = orderedList
          ? /^\d+\.\s+(.+)$/.exec(lines[index]!)
          : /^[-*]\s+(.+)$/.exec(lines[index]!);
        if (!match) break;
        items.push(<li key={items.length}>{inline(match[1]!)}</li>);
        index += 1;
      }
      blocks.push(
        orderedList ? (
          <ol key={blocks.length} className="list-decimal ps-6">
            {items}
          </ol>
        ) : (
          <ul key={blocks.length} className="list-disc ps-6">
            {items}
          </ul>
        ),
      );
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,3})\s|^```|^[-*]\s|^\d+\.\s/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!);
    blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
  }
  return <div className="flex flex-col gap-3 text-base leading-6">{blocks}</div>;
}
