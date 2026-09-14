// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: the same cover-note nodes feed the paired text and HTML email. */
import { parseKnowledgeMarkdown, type MarkdownInline } from "@openlaw/shared";
import type { MailMessage } from "../mailer.js";
import { escapeHtml, origin } from "./email.js";
function htmlInline(parts: MarkdownInline[], baseUrl: string): string {
  return parts
    .map((part) => {
      const text = escapeHtml(part.text);
      if (part.kind === "text") return text;
      if (part.kind === "link")
        return `<a href="${escapeHtml(new URL(part.href, baseUrl).href)}" rel="noreferrer">${text}</a>`;
      return `<${part.kind}>${text}</${part.kind}>`;
    })
    .join("");
}
const textInline = (parts: MarkdownInline[], baseUrl: string) =>
  parts
    .map((part) =>
      part.kind === "link" ? `${part.text} (${new URL(part.href, baseUrl).href})` : part.text,
    )
    .join("");
export function renderGenerationMail(input: {
  to: string;
  personName: string;
  autoDocName: string;
  organizationName: string;
  coverNote: string | null;
  baseUrl: string;
  autoDocId: string;
  generationId: string;
  attachments: NonNullable<MailMessage["attachments"]>;
}): MailMessage {
  const blocks = parseKnowledgeMarkdown(input.coverNote ?? "");
  const html = blocks
    .map((block) => {
      if (block.kind === "code") return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
      if (block.kind === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items.map((item) => `<li>${htmlInline(item, input.baseUrl)}</li>`).join("")}</${tag}>`;
      }
      const tag = block.kind === "heading" ? ["h2", "h3", "h4"][block.level - 1]! : "p";
      return `<${tag}>${htmlInline(block.children, input.baseUrl)}</${tag}>`;
    })
    .join("");
  const text = blocks
    .map((block) =>
      block.kind === "code"
        ? block.text
        : block.kind === "list"
          ? block.items
              .map(
                (item, i) =>
                  `${block.ordered ? `${i + 1}.` : "-"} ${textInline(item, input.baseUrl)}`,
              )
              .join("\n")
          : textInline(block.children, input.baseUrl),
    )
    .join("\n\n");
  const brand = input.organizationName ? `${input.organizationName} · OpenLaw` : "OpenLaw";
  const link = `${origin(input.baseUrl)}/auto-docs/${input.autoDocId}/generations/${input.generationId}`;
  const greeting = `Hello ${input.personName},`;
  const message = `Your generated ${input.autoDocName} is attached.`;
  return {
    to: input.to,
    subject: `${input.autoDocName} is ready`,
    attachments: input.attachments,
    text: [brand, "", greeting, "", message, "", text, "", "Download your files:", link].join("\n"),
    html: `<!doctype html><html><body><header><p><strong>${escapeHtml(brand)}</strong></p></header><main><h1>${escapeHtml(input.autoDocName)}</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(message)}</p>${html}<p><a href="${escapeHtml(link)}">Download your files</a></p></main></body></html>`,
  };
}
