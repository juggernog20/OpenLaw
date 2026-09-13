// SPDX-License-Identifier: AGPL-3.0-only

/** KNW-001: the shared Markdown grammar renders only owned React elements. */
import { Fragment } from "react";
import { FormattedMessage } from "react-intl";
import { parseKnowledgeMarkdown, type MarkdownInline } from "@openlaw/shared";
function inline(parts: MarkdownInline[]) {
  return parts.map((part, index) => {
    switch (part.kind) {
      case "link":
        return (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noreferrer"
            className="text-link underline"
          >
            {part.text}{" "}
            <span className="sr-only">
              <FormattedMessage
                id="knowledge.markdown.newTab"
                defaultMessage="(opens in a new tab)"
              />
            </span>
          </a>
        );
      case "code":
        return (
          <code key={index} className="rounded-chip bg-section-header px-1">
            {part.text}
          </code>
        );
      case "strong":
        return <strong key={index}>{part.text}</strong>;
      case "em":
        return <em key={index}>{part.text}</em>;
      case "text":
        return <Fragment key={index}>{part.text}</Fragment>;
    }
  });
}
export function KnowledgeMarkdown({ source }: Readonly<{ source: string }>) {
  return (
    <div className="flex flex-col gap-3 text-base leading-6">
      {parseKnowledgeMarkdown(source).map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return <p key={index}>{inline(block.children)}</p>;
          case "heading": {
            const Tag = (["h3", "h4", "h5"] as const)[block.level - 1] ?? "h5";
            return (
              <Tag key={index} className="font-semibold">
                {inline(block.children)}
              </Tag>
            );
          }
          case "code":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-card bg-section-header p-3 text-sm"
              >
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index} className={block.ordered ? "list-decimal ps-6" : "list-disc ps-6"}>
                {block.items.map((item, i) => (
                  <li key={i}>{inline(item)}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
