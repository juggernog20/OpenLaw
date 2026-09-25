// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The morning briefing (NOT-003, NOT-004, NOT-008) — anatomy in NOT-006,
 * register in DES-051. The round decides what belongs in each section;
 * this file decides how those sections read, in one text part and one
 * HTML part that carry the same sections in the same order.
 *
 * **One message a day, not one per date.** NOT-003's whole argument is
 * that date noise is the likeliest unsubscribe trigger, so the renewal
 * calendar arrives as a briefing: the reader scans a list, and the nine
 * separate mails the naive design would have sent are the thing this
 * layer exists to prevent. Knowledge (M28/6) rides the same message for
 * the same reason: a publication is ambient, and the briefing is its
 * only channel.
 *
 * **Every section is optional on its own.** A section with nothing in
 * it is left out of both parts, and a briefing with no section at all
 * is not sent (`null` below). The date order is the deadline union's
 * (CTR-009, M16/3): outward from today, ahead nearest first, then gone
 * by most recently first. Knowledge is oldest first, so a reader who
 * follows the list reads in the order things were published.
 *
 * **The register is DES-051's**: a briefing states, it does not urge.
 */

import type { NotificationEventType } from "@openlaw/db";
import { civilInstant } from "../contract-term.js";
import type { MailMessage } from "../mailer.js";
import type { ApprovalsHomeSection } from "../../modules/home/sections/approvals.js";
import type { InboxHomeSection } from "../../modules/home/sections/inbox.js";
import type { TasksHomeSection } from "../../modules/home/sections/tasks.js";
import {
  renderEmailLayout,
  type EmailBrand,
  type EmailSection,
  type EmailStatus,
} from "../email-layout.js";
import { matterLink, origin, recordLink } from "./email.js";

interface DigestRowBase {
  /** Which tracked date this is (NOT-002 group 3). */
  eventType: NotificationEventType;
  recordTitle: string;
  /** The date itself, as a civil date. */
  date: string;
  /**
   * Whole days from the **reader's own** today, negative once the date
   * has gone by.
   *
   * Counted at send time rather than taken from the row's offset: a row
   * whose digest was missed rides the next one, and a briefing that said
   * "in 1 day" about yesterday would be worse than no briefing.
   */
  daysAway: number;
  /** What somebody called this date (CTR-009), or null on the two the
   * term derives — they are named by their kind, not by a person. */
  label: string | null;
  /** Whether this Contract date still reads from an unconfirmed AI
   * source when the briefing is assembled. Other date kinds are false. */
  unverified: boolean;
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
  /** The morning round's civil date in the reader's timezone. */
  localDate: string;
  surface?: "staff" | "portal";
  approvals: ApprovalsHomeSection | null;
  tasks: TasksHomeSection | null;
  rows: readonly DigestRow[];
  knowledgeItems: readonly KnowledgeBriefingItem[];
  intake: InboxHomeSection | null;
  /** The reader's profile timezone (SET-006), or null for UTC. Civil
   * dates stay anchored to UTC; this zone only places true instants —
   * an approval's `requestedAt` — on the reader's own calendar. */
  readerTimeZone: string | null;
}

/** Which of the three sources leads when two dates fall on one day —
 * the deadline union's own rank (M16/3): the deadline that warns of the
 * expiry, then the expiry, then the record's own dates. */
const DIGEST_RANK: Record<string, number> = {
  "date.notice_deadline_approaching": 0,
  "date.expiry_approaching": 1,
  "date.key_date_approaching": 2,
  "date.obligation_approaching": 3,
};

/** What each kind of date is called when it has no name of its own. */
const DIGEST_KIND: Record<string, string> = {
  "date.notice_deadline_approaching": "Notice deadline",
  "date.expiry_approaching": "Expiry",
  "date.key_date_approaching": "Key date",
  "date.obligation_approaching": "Obligation",
};

/** One date as a reader reads it: `Mar 12, 2026`. Rendered in UTC
 * because the value is a civil date and not a moment — shifting it into
 * a zone is what would move it a day. */
const DIGEST_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const BRIEFING_COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function civilDateLabel(value: string): string {
  return DIGEST_DATE.format(civilInstant(value));
}

function instantDateLabel(value: string, timeZone: string | null): string {
  if (!timeZone) return DIGEST_DATE.format(new Date(value));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function recordReference(kind: "contract" | "matter", number: number): string {
  return kind === "matter" ? `M-${number}` : `#${number}`;
}

/** How far away one date is, in the words a briefing uses. Digits rather
 * than words (DES-015 rule 9), and the two days either side of today are
 * named because that is how people say them. */
function whenIs(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway === -1) return "Yesterday";
  return daysAway > 0 ? `In ${daysAway} days` : `${-daysAway} days ago`;
}

/** One row's own headline: when, what kind of date, and which record. */
function digestLine(row: DigestRow): string {
  const kind = row.label ?? DIGEST_KIND[row.eventType] ?? "Date";
  const on = DIGEST_DATE.format(civilInstant(row.date));
  const reference =
    row.entityType === "entity"
      ? row.recordTitle
      : `${row.recordTitle} (${row.entityType === "matter" ? `M-${row.recordNumber}` : `#${row.recordNumber}`})`;
  const verification = row.unverified ? " unverified" : "";
  return `${whenIs(row.daysAway)} (${on})${verification} — ${kind}: ${reference}`;
}

function digestLink(row: DigestRow, baseUrl: string, surface: "staff" | "portal"): string {
  if (row.entityType === "entity") {
    return `${origin(baseUrl)}/entities/${row.recordId}/obligations`;
  }
  if (surface === "portal") {
    return `${origin(baseUrl)}/portal/${row.entityType}s/${row.recordNumber}`;
  }
  // The Key dates section is the address (DES-049 clause 9) — landing a
  // reader on the overview and making them find the date they were just
  // told about is one click short of the promise.
  const record =
    row.entityType === "matter"
      ? matterLink(baseUrl, row.recordNumber)
      : recordLink(baseUrl, row.recordNumber);
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

function dateSections(rows: readonly DigestRow[]) {
  return [
    { heading: "Dates", rows: rows.filter((row) => row.entityType !== "entity") },
    { heading: "Obligations", rows: rows.filter((row) => row.entityType === "entity") },
  ].filter((section) => section.rows.length > 0);
}

function approvalLink(row: ApprovalsHomeSection["rows"][number], baseUrl: string): string {
  return `${recordLink(baseUrl, row.contract.number)}/approvals`;
}

function taskLink(row: TasksHomeSection["rows"][number], baseUrl: string): string {
  const record =
    row.record.kind === "matter"
      ? matterLink(baseUrl, row.record.number)
      : recordLink(baseUrl, row.record.number);
  return `${record}/tasks`;
}

function intakeLink(row: InboxHomeSection["rows"][number], baseUrl: string): string {
  return `${origin(baseUrl)}/inbox/${row.number}`;
}

function approvalLine(
  row: ApprovalsHomeSection["rows"][number],
  readerTimeZone: string | null,
): string {
  return `${row.contract.title} (#${row.contract.number}) — requested by ${row.requestedBy.displayName} on ${instantDateLabel(row.requestedAt, readerTimeZone)}`;
}

function taskLine(row: TasksHomeSection["rows"][number]): string {
  const due = row.dueDate ? ` — due ${civilDateLabel(row.dueDate)}` : "";
  return `${row.title} — ${row.record.title} (${recordReference(row.record.kind, row.record.number)})${due}`;
}

function intakeLine(row: InboxHomeSection["rows"][number]): string {
  return `R-${row.number} ${row.title} — ${row.requestType.displayName}, ${row.urgency}`;
}

interface OverflowLine {
  line: string;
  href: string;
}

/** What a section's cap kept out, named so the mail never understates
 * the day. The Home section reads cut at their card's preview limit but
 * carry the window total; the card wears "View all {total}", and this
 * line is the mail's version of it. */
function moreOnHome(total: number, shown: number, baseUrl: string): OverflowLine | null {
  if (total <= shown) return null;
  return {
    line: `And ${BRIEFING_COUNT.format(total - shown)} more on Home.`,
    href: `${origin(baseUrl)}/`,
  };
}

function textRows<T>(
  heading: string,
  rows: readonly T[],
  line: (row: T) => string,
  link: (row: T) => string,
  more: OverflowLine | null = null,
): string[] {
  if (rows.length === 0) return [];
  const body = rows.flatMap((row) => [line(row), link(row), ""]);
  if (more) body.push(more.line, more.href, "");
  return [heading, "", ...body];
}

const URGENCY: Record<InboxHomeSection["rows"][number]["urgency"], EmailStatus> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "severe" },
  critical: { label: "Critical", tone: "danger" },
};

/**
 * The morning briefing one person is owed, or `null` when they are owed
 * none.
 *
 * `null` for an empty briefing is what lets the round call this
 * unconditionally: "nothing is due" and "a message went" are then one
 * branch at the caller rather than two, and no empty briefing can ever
 * leave — a daily email that says nothing happened is the noise NOT-003
 * exists to avoid.
 *
 * The HTML part escapes every value it did not write itself. Titles are
 * typed by people, and a Knowledge title is the one string here that a
 * non-administrator can put in front of every Member's mail client.
 */
export function renderBriefingMail(
  briefing: BriefingMail,
  to: string,
  baseUrl: string,
  brand: EmailBrand = {},
): MailMessage | null {
  const surface = briefing.surface ?? "staff";
  const rows = sortedDates(briefing.rows);
  const knowledgeItems = sortedKnowledge(briefing.knowledgeItems);
  const approvals = briefing.approvals?.rows ?? [];
  const tasks = briefing.tasks?.rows ?? [];
  const intake = briefing.intake?.rows ?? [];
  const hasWorkSections = approvals.length > 0 || tasks.length > 0 || intake.length > 0;
  if (!hasWorkSections && rows.length === 0 && knowledgeItems.length === 0) return null;

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
  // Digits, sentence case, no full stop — a subject is a fragment
  // (DES-015 rules 6, 7, 9). The one-section subjects say what the
  // section holds; a briefing with both is just the briefing.
  const datesOnly = !hasWorkSections && knowledgeItems.length === 0;
  const subject = datesOnly
    ? `${BRIEFING_COUNT.format(dateCount)} ${dateCount === 1 ? "date" : "dates"} on ${destination}`
    : !hasWorkSections && dateCount === 0
      ? `${BRIEFING_COUNT.format(knowledgeItems.length)} new Knowledge ${knowledgeItems.length === 1 ? "item" : "items"}`
      : "Your daily briefing";
  const introduction = datesOnly
    ? `These dates are coming up on ${destination}, nearest first.`
    : !hasWorkSections && dateCount === 0
      ? "These Knowledge items were published since your previous briefing."
      : "Here is your daily briefing.";

  const approvalsMore = moreOnHome(briefing.approvals?.total ?? 0, approvals.length, baseUrl);
  const tasksMore = moreOnHome(briefing.tasks?.total ?? 0, tasks.length, baseUrl);
  const intakeMore = moreOnHome(briefing.intake?.total ?? 0, intake.length, baseUrl);

  const textSections = [
    ...textRows(
      "Approvals",
      approvals,
      (row) => approvalLine(row, briefing.readerTimeZone),
      (row) => approvalLink(row, baseUrl),
      approvalsMore,
    ),
    ...textRows("Tasks", tasks, taskLine, (row) => taskLink(row, baseUrl), tasksMore),
    ...dateSections(rows).flatMap((section) => [
      section.heading,
      "",
      ...section.rows.flatMap((row) => [digestLine(row), digestLink(row, baseUrl, surface), ""]),
    ]),
  ];
  if (knowledgeItems.length > 0) {
    textSections.push(
      "Knowledge",
      "",
      ...knowledgeItems.flatMap((item) => [item.title, knowledgeLink(item, baseUrl), ""]),
    );
  }
  textSections.push(
    ...textRows("Intake", intake, intakeLine, (row) => intakeLink(row, baseUrl), intakeMore),
  );

  const homeHref = `${origin(baseUrl)}/`;
  const sections: EmailSection[] = [
    {
      heading: "Approvals",
      total: briefing.approvals?.total ?? 0,
      href: homeHref,
      rows: approvals.map((row) => ({
        title: row.contract.title,
        href: approvalLink(row, baseUrl),
        ref: recordReference("contract", row.contract.number),
        meta: `Requested by ${row.requestedBy.displayName} on ${instantDateLabel(row.requestedAt, briefing.readerTimeZone)}`,
      })),
    },
    {
      heading: "Tasks",
      total: briefing.tasks?.total ?? 0,
      href: homeHref,
      rows: tasks.map((row) => ({
        title: row.title,
        href: taskLink(row, baseUrl),
        ref: recordReference(row.record.kind, row.record.number),
        meta: row.record.title,
        due: row.dueDate ? `Due ${civilDateLabel(row.dueDate)}` : undefined,
        tone: row.isOverdue ? "danger" : "warning",
      })),
    },
    ...dateSections(rows).map((section): EmailSection => ({
      heading: section.heading,
      total: section.rows.length,
      href: homeHref,
      rows: section.rows.map((row) => ({
        title: row.recordTitle,
        href: digestLink(row, baseUrl, surface),
        ref:
          row.entityType === "entity"
            ? undefined
            : recordReference(row.entityType, row.recordNumber),
        meta: `${row.label ?? DIGEST_KIND[row.eventType] ?? "Date"}${row.unverified ? " · unverified" : ""}`,
        when: whenIs(row.daysAway),
        date: civilDateLabel(row.date),
        tone: row.daysAway < 0 ? "danger" : row.daysAway <= 1 ? "warning" : "neutral",
      })),
    })),
    {
      heading: "Knowledge",
      total: knowledgeItems.length,
      href: homeHref,
      rows: knowledgeItems.map((item) => ({
        title: item.title,
        href: knowledgeLink(item, baseUrl),
        meta: `Published ${instantDateLabel(item.publishedAt.toISOString(), briefing.readerTimeZone)}`,
      })),
    },
    {
      heading: "Intake",
      total: briefing.intake?.total ?? 0,
      href: homeHref,
      rows: intake.map((row) => ({
        title: row.title,
        href: intakeLink(row, baseUrl),
        ref: `R-${row.number}`,
        meta: row.requestType.displayName,
        status: URGENCY[row.urgency],
      })),
    },
  ];
  const settingsLink = `${origin(baseUrl)}${surface === "portal" ? "/portal/settings" : "/settings/notifications"}`;

  return {
    to,
    subject,
    text: [
      `Hello ${briefing.recipientName},`,
      "",
      introduction,
      "",
      ...textSections,
      // The way out, on the one channel where the reader is not already
      // in the app. A digest with no way to turn it down is what trains
      // people to filter the sender.
      "Change what reaches you in your notification settings:",
      settingsLink,
    ].join("\n"),
    // The HTML part says the same things in the same order (DES-093
    // clause 1): label and headline, then the greeting, the framing
    // sentence, and the sections. A dates-only briefing is labelled by
    // what it holds, in the warning tone, as the #1080 table has it.
    ...renderEmailLayout(
      {
        subject,
        baseUrl,
        surface,
        preheader: introduction,
        tone: datesOnly ? "warning" : "neutral",
        label: datesOnly ? "Dates" : "Daily briefing",
        dateline: civilDateLabel(briefing.localDate),
        headline: subject,
        greeting: `Hello ${briefing.recipientName},`,
        body: [introduction],
        sections: sections.filter((section) => section.rows.length > 0),
        footer: { kind: "notification", why: "You get a morning briefing." },
      },
      brand,
    ),
  };
}
