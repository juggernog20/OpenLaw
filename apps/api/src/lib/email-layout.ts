// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import type { MarkdownBlock, MarkdownInline } from "@openlaw/shared";
import type { MailMessage } from "./mailer.js";

/** DES-093. Senders supply facts and copy; this module owns the HTML. */
export type EmailTone =
  "neutral" | "success" | "warning" | "info" | "danger" | "severe" | "assigned";
export interface EmailBrand {
  name?: string | null;
}
export interface EmailStatus {
  label: string;
  tone?: EmailTone;
}
export interface EmailAction {
  label: string;
  href: string;
  line?: string;
}
export interface EmailRecord {
  kind: string;
  ref: string;
  title: string;
  href: string;
  status?: EmailStatus;
  previousStatus?: string;
  actor?: string;
  document?: { name: string; version?: string; type?: string };
  facts?: { label: string; value: string; tone?: EmailTone }[];
  steps?: { labels: string[]; current: number };
  comment?: {
    author: string;
    tier?: "Legal Only" | "Working Team" | "Full Thread";
    /** The sender marks only mentions of this recipient. No HTML is accepted. */
    words: { text: string; mention?: boolean }[];
    cut?: boolean;
  };
}
export interface EmailSection {
  heading: string;
  total: number;
  href: string;
  rows: {
    title: string;
    href: string;
    ref?: string;
    meta?: string;
    due?: string;
    tone?: EmailTone;
    status?: EmailStatus;
    when?: string;
    date?: string;
  }[];
}
export interface EmailModel {
  subject: string;
  baseUrl: string;
  surface: "staff" | "portal";
  preheader?: string;
  tone?: EmailTone;
  label?: string;
  dateline?: string;
  headline?: string;
  greeting?: string;
  body?: string[];
  record?: EmailRecord;
  declineReason?: string;
  legalNote?: MarkdownBlock[];
  attachments?: { name: string; size: string; type?: string }[];
  sections?: EmailSection[];
  action?: EmailAction;
  fallbackLink?: string;
  footer?: { kind: "notification"; why: string } | { kind: "security" } | { kind: "system" };
}

const TONES: Record<EmailTone, { bg: string; fg: string }> = {
  neutral: { bg: "#eff1f3", fg: "#57606a" },
  success: { bg: "#dafbe1", fg: "#1a7f37" },
  warning: { bg: "#fff8c5", fg: "#9a6700" },
  info: { bg: "#ddf4ff", fg: "#0969da" },
  danger: { bg: "#ffebe9", fg: "#cf222e" },
  severe: { bg: "#fff1e5", fg: "#bc4c00" },
  assigned: { bg: "#fbefff", fg: "#8250df" },
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const TEXT = `font-family:${FONT};font-size:14px;line-height:1.55;color:#1f2328;`;
const SMALL = `font-family:${FONT};font-size:12px;line-height:1.5;color:#656d76;`;
const BORDER = "border:1px solid #d0d7de;border-radius:6px;border-collapse:separate;";
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const MARK_CID = "openlaw-mark@openlaw";
// Source: apps/web/public/icons/openlaw-192.png.
// assets/ is shipped beside both src/ and dist/, including in the worker image.
const MARK = readFileSync(new URL("../../assets/openlaw-192.png", import.meta.url));

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
const e = escapeHtml;
function href(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Email links must use HTTP or HTTPS");
  return e(url.href);
}
function pill(status: EmailStatus): string {
  const tone = TONES[status.tone ?? "neutral"];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;background:${tone.bg};color:${tone.fg};font-family:${FONT};font-size:12px;line-height:1.5;">${e(status.label)}</span>`;
}
function person(name: string, suffix = "", author = false): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
  return `<table ${TABLE} style="margin-top:8px;"><tr><td width="20" height="20" align="center" bgcolor="#ddf4ff" style="border-radius:10px;font-family:${FONT};font-size:10px;color:#0969da;">${e(initials)}</td><td style="padding-left:8px;${TEXT}font-size:13px;${author ? "font-weight:600;" : "color:#656d76;"}">${e(name)}${suffix}</td></tr></table>`;
}
function fileBadge(type = "file", size = 28): string {
  const badge =
    type === "word"
      ? ["#2b579a", "W"]
      : type === "pdf"
        ? ["#d93025", "P"]
        : type === "excel"
          ? ["#217346", "X"]
          : ["#656d76", "F"];
  return `<table ${TABLE}><tr><td width="${size}" height="${size}" align="center" bgcolor="${badge[0]}" style="border-radius:3px;font-family:${FONT};font-size:11px;color:#ffffff;">${badge[1]}</td></tr></table>`;
}
function actionRow(action: EmailAction): string {
  return `<table ${TABLE} width="100%"><tr><td class="stack" width="1" valign="middle" style="white-space:nowrap;">
<table ${TABLE} class="btn-full"><tr><td align="center" bgcolor="#1f883d" style="border:1px solid #1a7f37;border-radius:6px;"><a href="${href(action.href)}" style="display:inline-block;padding:10px 18px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:6px;">${e(action.label)}</a></td></tr></table>
</td>${action.line ? `<td class="stack stack-gap" valign="middle" style="padding-left:16px;${SMALL}">${e(action.line)}</td>` : ""}</tr></table>`;
}
function fact(label: string, valueHtml: string): string {
  return `<tr><td width="96" valign="middle" style="padding:5px 12px 5px 0;${SMALL}">${e(label)}</td><td style="padding:5px 0;${TEXT}font-size:13px;">${valueHtml}</td></tr>`;
}
function steps(block: NonNullable<EmailRecord["steps"]>): string {
  return `<table ${TABLE} style="margin-top:14px;">${block.labels
    .map((label, index) => {
      const done = index < block.current;
      const now = index === block.current;
      const dot = done
        ? "background:#1a7f37;color:#ffffff;"
        : now
          ? "background:#fff8c5;border:2px solid #9a6700;"
          : "border:2px solid #d0d7de;";
      return `<tr><td style="padding:4px 0;"><table ${TABLE}><tr><td width="16" height="16" align="center" style="border-radius:8px;font-size:10px;${dot}">${done ? "&#10003;" : "&nbsp;"}</td></tr></table></td><td style="padding-left:10px;${TEXT}font-size:13px;${now ? "font-weight:600;" : done ? "color:#656d76;" : "color:#7d8590;"}">${e(label)}${now ? " · now" : ""}</td></tr>`;
    })
    .join("")}</table>`;
}
function noteInline(parts: MarkdownInline[], baseUrl: string): string {
  return parts
    .map((part) => {
      if (part.kind === "text") return e(part.text);
      if (part.kind === "link") {
        const url = new URL(part.href, baseUrl);
        if (!["https:", "http:", "mailto:"].includes(url.protocol)) return e(part.text);
        return `<a href="${e(url.href)}" style="color:#0969da;">${e(part.text)}</a>`;
      }
      return `<${part.kind}>${e(part.text)}</${part.kind}>`;
    })
    .join("");
}
function legalNote(blocks: MarkdownBlock[], baseUrl: string): string {
  return blocks
    .map((block) => {
      if (block.kind === "code")
        return `<pre style="${SMALL}white-space:pre-wrap;"><code>${e(block.text)}</code></pre>`;
      if (block.kind === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag} style="margin:0 0 8px;padding-left:20px;${TEXT}">${block.items.map((item) => `<li>${noteInline(item, baseUrl)}</li>`).join("")}</${tag}>`;
      }
      const tag = block.kind === "heading" ? "h3" : "p";
      return `<${tag} style="margin:0 0 8px;${TEXT}">${noteInline(block.children, baseUrl)}</${tag}>`;
    })
    .join("");
}
function recordCard(record: EmailRecord, model: EmailModel): string {
  let content = `<p style="margin:0;${TEXT}font-size:16px;font-weight:600;"><a href="${href(record.href)}" style="color:#1f2328;text-decoration:none;">${e(record.title)}</a></p>`;
  if (record.comment) {
    const c = record.comment;
    const tier =
      model.surface === "staff" && c.tier
        ? ` <span style="${SMALL}font-weight:400;">· ${e(c.tier)}</span>`
        : "";
    const words = c.words
      .map((word) =>
        word.mention
          ? `<span style="background:#fbefff;color:#8250df;font-weight:600;">${e(word.text)}</span>`
          : e(word.text),
      )
      .join("")
      .replaceAll("\n", "<br>");
    content += `<table ${TABLE} width="100%" style="margin-top:12px;"><tr><td bgcolor="#f6f8fa" style="border:1px solid #d8dee4;border-radius:6px;padding:12px 14px;">${person(c.author, tier, true)}<p style="margin:8px 0 0;${TEXT}">${words}${c.cut ? "…" : ""}</p>${c.cut ? `<p style="margin:8px 0 0;${SMALL}"><a href="${href(record.href)}" style="color:#0969da;">Read the full comment &rarr;</a></p>` : ""}</td></tr></table>`;
  } else if (record.actor) content += person(record.actor);
  let facts = "";
  if (record.previousStatus)
    facts += fact(
      "Status",
      `${pill({ label: record.previousStatus })}${record.status ? ` &rarr; ${pill(record.status)}` : ""}`,
    );
  if (record.document) {
    const d = record.document;
    facts += fact(
      "Document",
      `<table ${TABLE}><tr><td>${fileBadge(d.type, 18)}</td><td style="padding-left:8px;${TEXT}font-size:13px;">${e(d.name)}${d.version ? ` ${pill({ label: d.version })}` : ""}</td></tr></table>`,
    );
  }
  for (const row of record.facts ?? [])
    facts += fact(row.label, row.tone ? pill({ label: row.value, tone: row.tone }) : e(row.value));
  if (facts) content += `<table ${TABLE} width="100%" style="margin-top:12px;">${facts}</table>`;
  if (record.steps) content += steps(record.steps);
  return `<table ${TABLE} width="100%" style="${BORDER}margin:0 0 24px;">
<tr><td bgcolor="#f6f8fa" style="padding:9px 16px;border-bottom:1px solid #d0d7de;border-radius:6px 6px 0 0;"><table ${TABLE} width="100%"><tr><td style="${SMALL}">${e(record.kind)} <span style="font-family:${MONO};color:#1f2328;">${e(record.ref)}</span></td><td align="right">${record.status && !record.previousStatus ? pill(record.status) : ""}</td></tr></table></td></tr>
<tr><td style="padding:14px 16px 16px;">${content}</td></tr>
${model.action ? `<tr><td style="border-top:1px solid #d8dee4;padding:14px 16px;">${actionRow(model.action)}</td></tr>` : ""}</table>`;
}
function briefing(sections: EmailSection[]): string {
  let tiles = "";
  for (let index = 0; index < sections.length; index += 3) {
    tiles += `<tr>${sections
      .slice(index, index + 3)
      .map(
        (s) =>
          `<td width="33%" valign="top" style="padding:0 4px 8px;"><table ${TABLE} width="100%" style="${BORDER}"><tr><td style="padding:10px 12px;"><p style="margin:0;${TEXT}font-size:20px;font-weight:600;">${s.total}</p><p style="margin:2px 0 0;${SMALL}">${e(s.heading)}</p></td></tr></table></td>`,
      )
      .join(
        "",
      )}${'<td width="33%"></td>'.repeat(Math.max(0, 3 - sections.slice(index, index + 3).length))}</tr>`;
  }
  return (
    (sections.length > 1
      ? `<table ${TABLE} width="100%" style="margin:0 0 16px;">${tiles}</table>`
      : "") +
    sections
      .map((s) => {
        const rows = s.rows
          .map(
            (
              r,
            ) => `<tr><td style="padding:12px 16px;border-top:1px solid #d8dee4;"><table ${TABLE} width="100%"><tr>
${r.when || r.date ? `<td width="100" valign="top" style="${SMALL}color:${TONES[r.tone ?? "neutral"].fg};">${e(r.when ?? "")}<br>${e(r.date ?? "")}</td>` : ""}
<td valign="top" style="${TEXT}"><a href="${href(r.href)}" style="color:#1f2328;text-decoration:none;font-weight:600;">${e(r.title)}</a>${r.meta ? `<br><span style="${SMALL}">${e(r.meta)}</span>` : ""}</td>
${r.ref || r.due || r.status ? `<td align="right" valign="top" style="padding-left:12px;${SMALL}color:${TONES[r.tone ?? "neutral"].fg};">${r.ref ? `<span style="font-family:${MONO};color:#656d76;white-space:nowrap;">${e(r.ref)}</span><br>` : ""}${r.status ? pill(r.status) : e(r.due ?? "")}</td>` : ""}
</tr></table></td></tr>`,
          )
          .join("");
        return `<table ${TABLE} width="100%" style="${BORDER}margin:0 0 24px;"><tr><td bgcolor="#f6f8fa" style="padding:9px 16px;"><table ${TABLE} width="100%"><tr><td style="${TEXT}font-weight:600;">${e(s.heading)} <span style="background:#eaeef2;color:#636a73;padding:0 7px;border-radius:12px;font-size:11px;">${s.total}</span></td><td align="right" style="${SMALL}">${s.total > s.rows.length ? `<a href="${href(s.href)}" style="color:#0969da;">View all ${s.total} &rarr;</a>` : ""}</td></tr></table></td></tr>${rows}</table>`;
      })
      .join("")
  );
}

export function renderEmailLayout(
  model: EmailModel,
  brand: EmailBrand,
): { html: string; attachments: NonNullable<MailMessage["attachments"]> } {
  const orgName = brand.name?.trim() ?? "";
  const name = orgName || "OpenLaw";
  const tone = TONES[model.tone ?? "neutral"];
  let inner = model.label
    ? `<p style="margin:0 0 8px;${SMALL}font-weight:600;color:${tone.fg};">&#9679;&nbsp; ${e(model.label)}${model.dateline ? ` <span style="color:#656d76;font-weight:400;">· ${e(model.dateline)}</span>` : ""}</p>`
    : "";
  if (model.headline)
    inner += `<h1 style="margin:0 0 20px;${TEXT}font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.3px;">${e(model.headline)}</h1>`;
  if (model.greeting) inner += `<p style="margin:0 0 12px;${TEXT}">${e(model.greeting)}</p>`;
  for (const line of model.body ?? []) inner += `<p style="margin:0 0 20px;${TEXT}">${e(line)}</p>`;
  if (model.declineReason)
    inner += `<table ${TABLE} width="100%" style="margin:0 0 24px;"><tr><td bgcolor="#f6f8fa" style="border-left:3px solid #cf222e;padding:12px 16px;${TEXT}">${e(model.declineReason).replaceAll("\n", "<br>")}</td></tr></table>`;
  if (model.record) inner += recordCard(model.record, model);
  if (model.legalNote?.length)
    inner += `<table ${TABLE} width="100%" style="margin:0 0 24px;"><tr><td style="border-left:3px solid #afb8c1;padding-left:16px;"><p style="margin:0 0 8px;${SMALL}font-weight:600;">Note from ${e(name)} Legal</p>${legalNote(model.legalNote, model.baseUrl)}</td></tr></table>`;
  if (model.attachments?.length)
    inner += `<table ${TABLE} width="100%" style="${BORDER}margin:0 0 24px;">${model.attachments.map((a, index) => `<tr><td style="padding:12px 16px;${index ? "border-top:1px solid #d8dee4;" : ""}"><table ${TABLE}><tr><td>${fileBadge(a.type)}</td><td style="padding-left:12px;${TEXT}">${e(a.name)}<br><span style="${SMALL}">Attached · ${e(a.size)}</span></td></tr></table></td></tr>`).join("")}</table>`;
  if (model.sections?.length) inner += briefing(model.sections);
  if (model.action && !model.record)
    inner += `<table ${TABLE} width="100%" style="margin:0 0 24px;"><tr><td>${actionRow(model.action)}</td></tr></table>`;
  if (model.fallbackLink)
    inner += `<p style="margin:0 0 24px;${SMALL}">Button not working? Paste this link into your browser:<br><a href="${href(model.fallbackLink)}" style="font-family:${MONO};color:#0969da;word-break:break-all;">${e(model.fallbackLink)}</a></p>`;
  let why = "";
  if (model.footer?.kind === "security")
    why = `This is an automatic security email. Nobody at ${e(name)} will ask you for this link.`;
  if (model.footer?.kind === "system") why = "Only Administrators can send this email.";
  if (model.footer?.kind === "notification") {
    const settings = new URL(
      model.surface === "portal" ? "/portal/settings" : "/settings/notifications",
      model.baseUrl,
    ).href;
    why = `${e(model.footer.why)} Change what reaches you in your <a href="${href(settings)}" style="color:#0969da;text-decoration:underline;">notification settings</a>.`;
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${e(model.subject)}</title>
<style>@media (max-width:620px){.container{width:100%!important;}.canvas{padding:20px 12px!important;}.px{padding-left:20px!important;padding-right:20px!important;}.stack{display:block!important;width:100%!important;}.stack-gap{padding:10px 0 0!important;}.btn-full{width:100%!important;}.btn-full a{display:block!important;text-align:center!important;}}</style></head>
<body style="margin:0;padding:0;background:#f6f8fa;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(model.preheader ?? model.headline ?? model.subject)}</div>
<table ${TABLE} width="100%" bgcolor="#f6f8fa"><tr><td class="canvas" align="center" style="padding:32px;">
<table ${TABLE} class="container" width="600" style="width:600px;max-width:600px;"><tr><td>
<table ${TABLE} width="100%" bgcolor="#ffffff" style="${BORDER}">
<tr><td class="px" bgcolor="#0d1117" style="border-radius:6px 6px 0 0;padding:10px 40px;"><table ${TABLE} width="100%"><tr><td width="24"><img src="cid:${MARK_CID}" width="24" height="24" alt="" style="display:block;border-radius:5px;background:#ffffff;"></td><td style="padding-left:10px;font-family:${FONT};font-size:14px;font-weight:600;color:#f0f6fc;">${e(name)} <span style="color:#7d8590;font-weight:400;">/ ${model.surface === "portal" ? "Legal portal" : "Legal"}</span></td></tr></table></td></tr>
<tr><td class="px" style="padding:32px 40px 8px;">${inner}</td></tr>
${why ? `<tr><td class="px" bgcolor="#f6f8fa" style="border-top:1px solid #d8dee4;border-radius:0 0 6px 6px;padding:14px 40px;${SMALL}">${why}</td></tr>` : ""}
</table></td></tr><tr><td align="center" style="padding:16px 32px 0;${SMALL}">${orgName ? `${e(orgName)} · sent by OpenLaw` : "Sent by OpenLaw"}</td></tr></table></td></tr></table></body></html>`;
  return {
    html,
    attachments: [
      { filename: "openlaw-192.png", content: MARK, contentType: "image/png", cid: MARK_CID },
    ],
  };
}
