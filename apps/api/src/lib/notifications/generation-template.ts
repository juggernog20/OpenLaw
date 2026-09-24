// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: the same cover-note nodes feed the paired text and HTML email. */
import { parseKnowledgeMarkdown, type MarkdownInline } from "@openlaw/shared";
import type { MailMessage } from "../mailer.js";
import { renderEmailLayout, type EmailModel } from "../email-layout.js";
import { origin } from "./email.js";

function fileSize(bytes: number): string {
  const step = [
    { unit: "gigabyte", threshold: 1e9 },
    { unit: "megabyte", threshold: 1e6 },
    { unit: "kilobyte", threshold: 1e3 },
  ].find(({ threshold }) => bytes >= threshold) ?? { unit: "byte", threshold: 1 };
  return new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: step.unit,
    maximumFractionDigits: 1,
  }).format(bytes / step.threshold);
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
  emailLogoPng?: string | null;
  surface: EmailModel["surface"];
  coverNote: string | null;
  baseUrl: string;
  autoDocId: string;
  generationId: string;
  attachments: NonNullable<MailMessage["attachments"]>;
}): MailMessage {
  const blocks = parseKnowledgeMarkdown(input.coverNote ?? "");
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
  const subject = `${input.autoDocName} is ready`;
  const layout = renderEmailLayout(
    {
      subject,
      baseUrl: input.baseUrl,
      surface: input.surface,
      tone: "success",
      label: "Auto-Doc",
      headline: input.autoDocName,
      greeting,
      body: [message],
      legalNote: blocks,
      attachments: input.attachments.map((attachment) => ({
        name: attachment.filename,
        size: fileSize(attachment.content.byteLength),
        type:
          attachment.contentType === "application/pdf"
            ? "pdf"
            : attachment.contentType ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              ? "word"
              : "file",
      })),
      action: { label: "Download your files", href: link },
    },
    { name: input.organizationName, emailLogoPng: input.emailLogoPng },
  );
  return {
    to: input.to,
    subject,
    attachments: [...input.attachments, ...layout.attachments],
    text: [brand, "", greeting, "", message, "", text, "", "Download your files:", link].join("\n"),
    html: layout.html,
  };
}
