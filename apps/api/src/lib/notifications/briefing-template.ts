// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The daily briefing template (NOT-008): one first-class text part and
 * one first-class HTML part assembled from independently optional
 * sections. The round decides what belongs in each section; this file
 * decides how those sections read.
 */

import type { NotificationEventType } from "@openlaw/db";
import { civilInstant } from "../contract-term.js";
import type { MailMessage } from "../mailer.js";

interface DigestRowBase {
  eventType: NotificationEventType;
  recordTitle: string;
  date: string;
  daysAway: number;
  label: string | null;
}

/** One date line handed over by the morning round. */
export type DigestRow = DigestRowBase &
  (
    | { entityType: "matter" | "contract"; recordNumber: number }
    | { entityType: "entity"; recordId: string }
  );

/** One published Knowledge item handed over by the morning round. */
export interface KnowledgeBriefingItem {
  id: string;
  title: string;
  publishedAt: Date;
}

/** Every section the round has assembled for one reader. */
export interface BriefingMail {
  recipientName: string;
  rows: readonly DigestRow[];
  knowledgeItems: readonly KnowledgeBriefingItem[];
}

const DIGEST_RANK: Record<string, number> = {
  "date.notice_deadline_approaching": 0,
  "date.expiry_approaching": 1,
  "date.key_date_approaching": 2,
  "date.obligation_approaching": 3,
};

const DIGEST_KIND: Record<string, string> = {
  "date.notice_deadline_approaching": "Notice deadline",
  "date.expiry_approaching": "Expiry",
  "date.key_date_approaching": "Key date",
  "date.obligation_approaching": "Obligation",
};

const DIGEST_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

function origin(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end -= 1;
  return baseUrl.slice(0, end);
}

function whenIs(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway === -1) return "Yesterday";
  return daysAway > 0 ? `In ${daysAway} days` : `${-daysAway} days ago`;
}

function digestLine(row: DigestRow): string {
  const kind = row.label ?? DIGEST_KIND[row.eventType] ?? "Date";
  const on = DIGEST_DATE.format(civilInstant(row.date));
  const reference =
    row.entityType === "entity"
      ? row.recordTitle
      : `${row.recordTitle} (${row.entityType === "matter" ? `M-${row.recordNumber}` : `#${row.recordNumber}`})`;
  return `${whenIs(row.daysAway)} (${on}) — ${kind}: ${reference}`;
}

function digestLink(row: DigestRow, baseUrl: string): string {
  if (row.entityType === "entity") {
    return `${origin(baseUrl)}/entities/${row.recordId}/obligations`;
  }
  const record =
    row.entityType === "matter"
      ? `${origin(baseUrl)}/matters/${row.recordNumber}`
      : `${origin(baseUrl)}/contracts/${row.recordNumber}`;
  return `${record}/key-dates`;
}

function knowledgeLink(item: KnowledgeBriefingItem, baseUrl: string): string {
  return `${origin(baseUrl)}/knowledge/${item.id}`;
}

function sortedDates(input: readonly DigestRow[]): DigestRow[] {
  return [...input].sort((left, right) => {
    const leftPast = left.daysAway < 0;
    const rightPast = right.daysAway < 0;
    if (leftPast !== rightPast) return leftPast ? 1 : -1;
    if (left.date !== right.date) {
      const ascending = left.date < right.date ? -1 : 1;
      return leftPast ? -ascending : ascending;
    }
    const byRank = (DIGEST_RANK[left.eventType] ?? 9) - (DIGEST_RANK[right.eventType] ?? 9);
    if (byRank !== 0) return byRank;
    const byTitle = left.recordTitle.localeCompare(right.recordTitle);
    if (byTitle !== 0) return byTitle;
    if (left.entityType === "entity" || right.entityType === "entity") {
      const leftId = left.entityType === "entity" ? left.recordId : String(left.recordNumber);
      const rightId = right.entityType === "entity" ? right.recordId : String(right.recordNumber);
      return leftId.localeCompare(rightId);
    }
    return left.recordNumber - right.recordNumber;
  });
}

function sortedKnowledge(input: readonly KnowledgeBriefingItem[]): KnowledgeBriefingItem[] {
  return [...input].sort(
    (left, right) =>
      left.publishedAt.getTime() - right.publishedAt.getTime() || left.id.localeCompare(right.id),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateSections(rows: readonly DigestRow[]) {
  return [
    { heading: "Dates", rows: rows.filter((row) => row.entityType !== "entity") },
    { heading: "Obligations", rows: rows.filter((row) => row.entityType === "entity") },
  ].filter((section) => section.rows.length > 0);
}

/** Renders no message when every section is empty. */
export function renderBriefingMail(
  briefing: BriefingMail,
  to: string,
  baseUrl: string,
): MailMessage | null {
  const rows = sortedDates(briefing.rows);
  const knowledgeItems = sortedKnowledge(briefing.knowledgeItems);
  if (rows.length === 0 && knowledgeItems.length === 0) return null;

  const dateCount = rows.length;
  const kinds = new Set(rows.map((row) => row.entityType));
  const destination =
    kinds.size > 1
      ? "your records"
      : kinds.has("matter")
        ? "your matters"
        : kinds.has("entity")
          ? "your entities"
          : "your contracts";
  const subject =
    knowledgeItems.length === 0
      ? `${dateCount} ${dateCount === 1 ? "date" : "dates"} on ${destination}`
      : dateCount === 0
        ? `${knowledgeItems.length} new Knowledge ${knowledgeItems.length === 1 ? "item" : "items"}`
        : "Your daily briefing";
  const introduction =
    knowledgeItems.length === 0
      ? `These dates are coming up on ${destination}, nearest first.`
      : dateCount === 0
        ? "These Knowledge items were published since your previous briefing."
        : "Here is your daily briefing.";

  const textSections = dateSections(rows).flatMap((section) => [
    section.heading,
    "",
    ...section.rows.flatMap((row) => [digestLine(row), digestLink(row, baseUrl), ""]),
  ]);
  if (knowledgeItems.length > 0) {
    textSections.push(
      "Knowledge",
      "",
      ...knowledgeItems.flatMap((item) => [item.title, knowledgeLink(item, baseUrl), ""]),
    );
  }

  const htmlDateSections = dateSections(rows)
    .map(
      (section) =>
        `<h2>${section.heading}</h2><ul>${section.rows
          .map((row) => {
            const link = escapeHtml(digestLink(row, baseUrl));
            return `<li>${escapeHtml(digestLine(row))}<br><a href="${link}">${link}</a></li>`;
          })
          .join("")}</ul>`,
    )
    .join("");
  const htmlKnowledge =
    knowledgeItems.length === 0
      ? ""
      : `<h2>Knowledge</h2><ul>${knowledgeItems
          .map((item) => {
            const link = escapeHtml(knowledgeLink(item, baseUrl));
            return `<li><a href="${link}">${escapeHtml(item.title)}</a></li>`;
          })
          .join("")}</ul>`;
  const settingsLink = `${origin(baseUrl)}/settings/notifications`;

  return {
    to,
    subject,
    text: [
      `Hello ${briefing.recipientName},`,
      "",
      introduction,
      "",
      ...textSections,
      "Change what reaches you in your notification settings:",
      settingsLink,
    ].join("\n"),
    html:
      `<!doctype html><html><body><p>Hello ${escapeHtml(briefing.recipientName)},</p>` +
      `<p>${escapeHtml(introduction)}</p>${htmlDateSections}${htmlKnowledge}` +
      `<p>Change what reaches you in your <a href="${escapeHtml(settingsLink)}">notification settings</a>.</p>` +
      "</body></html>",
  };
}
