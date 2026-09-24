// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { SEARCH_KINDS } from "./search-question.js";

export type SearchProperty = {
  kind: (typeof SEARCH_KINDS)[number];
  key: string;
  label: string;
  type: "choices" | "text" | "flag" | "date";
  /** The choices are the column's own stored strings, not record ids or
   * viewer tokens, so any string is a valid pick and a comma inside one
   * is data. */
  free?: true;
};

export const SEARCH_PROPERTIES: readonly SearchProperty[] = [
  { kind: "contract", key: "status", label: "Status", type: "choices" },
  { kind: "contract", key: "type", label: "Type", type: "choices" },
  { kind: "contract", key: "owner", label: "Owner", type: "choices" },
  { kind: "contract", key: "counterparty", label: "Counterparty", type: "choices" },
  { kind: "contract", key: "entity", label: "Signing Entity", type: "choices" },
  { kind: "contract", key: "effective", label: "Effective date", type: "date" },
  { kind: "contract", key: "expiry", label: "Expiry date", type: "date" },
  { kind: "contract", key: "noticeDeadline", label: "Notice deadline", type: "date" },
  { kind: "contract", key: "confidential", label: "Confidential", type: "flag" },
  { kind: "contract", key: "includeEnded", label: "Show ended", type: "flag" },
  { kind: "contract", key: "includeArchived", label: "Show archived", type: "flag" },
  { kind: "contract", key: "title", label: "Title", type: "text" },
  { kind: "matter", key: "type", label: "Type", type: "choices" },
  { kind: "matter", key: "status", label: "Status", type: "choices" },
  { kind: "matter", key: "priority", label: "Priority", type: "choices" },
  { kind: "matter", key: "risk", label: "Risk", type: "choices" },
  { kind: "matter", key: "manager", label: "Matter Manager", type: "choices" },
  { kind: "matter", key: "businessOwner", label: "Business Owner", type: "choices" },
  { kind: "matter", key: "opened", label: "Opened date", type: "date" },
  { kind: "matter", key: "deadline", label: "Next deadline", type: "date" },
  { kind: "matter", key: "incomplete", label: "Incomplete", type: "flag" },
  { kind: "matter", key: "confidential", label: "Confidential", type: "flag" },
  { kind: "matter", key: "includeClosed", label: "Show closed", type: "flag" },
  { kind: "matter", key: "includeArchived", label: "Show archived", type: "flag" },
  { kind: "matter", key: "title", label: "Title", type: "text" },
  { kind: "document", key: "owner", label: "Owning module", type: "choices" },
  { kind: "document", key: "format", label: "Format", type: "choices" },
  { kind: "document", key: "type", label: "Document type", type: "choices" },
  { kind: "document", key: "counterparty", label: "Counterparty", type: "choices" },
  { kind: "document", key: "uploader", label: "Uploader", type: "choices" },
  { kind: "document", key: "uploaded", label: "Uploaded date", type: "date" },
  { kind: "document", key: "textState", label: "Text state", type: "choices" },
  { kind: "document", key: "includeArchived", label: "Show archived", type: "flag" },
  { kind: "entity", key: "type", label: "Type", type: "choices" },
  { kind: "entity", key: "jurisdiction", label: "Jurisdiction", type: "choices", free: true },
  { kind: "entity", key: "status", label: "Status", type: "choices" },
  { kind: "entity", key: "majorityOwner", label: "Majority owner", type: "choices" },
  { kind: "entity", key: "nextObligation", label: "Next obligation date", type: "date" },
  { kind: "entity", key: "includeArchived", label: "Show archived", type: "flag" },
  { kind: "counterparty", key: "jurisdiction", label: "Jurisdiction", type: "text" },
  { kind: "request", key: "type", label: "Type", type: "choices" },
  { kind: "request", key: "urgency", label: "Urgency", type: "choices" },
  { kind: "request", key: "status", label: "Status", type: "choices" },
  { kind: "request", key: "requester", label: "Requester", type: "choices" },
  { kind: "request", key: "received", label: "Received date", type: "date" },
  { kind: "knowledge_item", key: "type", label: "Type", type: "choices" },
  { kind: "knowledge_item", key: "state", label: "State", type: "choices" },
  { kind: "knowledge_item", key: "folder", label: "Knowledge Folder", type: "choices" },
];

export const RELATIVE_DATE_OPERATORS = [
  "in_last_days",
  "in_next_days",
  "today",
  "this_week",
  "this_month",
  "this_quarter",
  "this_year",
] as const;

export function isRelativeDateOperator(operator: string): boolean {
  return (RELATIVE_DATE_OPERATORS as readonly string[]).includes(operator);
}

export function needsRelativeDayCount(operator: string): boolean {
  return operator === "in_last_days" || operator === "in_next_days";
}

export const SEARCH_OPERATORS = {
  choices: ["is_any_of", "is_none_of"],
  text: ["contains", "does_not_contain"],
  flag: ["is"],
  date: ["before", "after", "on", "between", ...RELATIVE_DATE_OPERATORS],
} as const;

export function searchProperty(kind: string, key: string): SearchProperty | undefined {
  return SEARCH_PROPERTIES.find((property) => property.kind === kind && property.key === key);
}

const choices = z
  .array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
  .min(1)
  .max(50);
const freeChoices = z.array(z.string().min(1).max(200)).min(1).max(50);
const date = z.iso.date().refine((value) => value >= "0001-01-01");
const range = z.tuple([date, date]).refine(([from, to]) => from <= to);

export function conditionProblem(condition: {
  kind: string;
  property: string;
  operator: string;
  value?: unknown;
}): string | null {
  const property = searchProperty(condition.kind, condition.property);
  if (!property) return "Unknown search property.";
  if (!(SEARCH_OPERATORS[property.type] as readonly string[]).includes(condition.operator))
    return "The operator does not fit this property's value type.";
  if (property.type === "date" && isRelativeDateOperator(condition.operator)) {
    if (needsRelativeDayCount(condition.operator))
      return z.number().int().min(1).max(3650).safeParse(condition.value).success
        ? null
        : "Relative day count N must be a whole number from 1 to 3650.";
    return condition.value == null ? null : "This relative date operator takes no value.";
  }
  if (condition.value === undefined) return "A condition value is required.";
  const schema =
    property.type === "choices"
      ? property.free
        ? freeChoices
        : choices
      : property.type === "text"
        ? z.string().trim().min(1).max(200)
        : property.type === "flag"
          ? z.boolean()
          : condition.operator === "between"
            ? range
            : date;
  return schema.safeParse(condition.value).success
    ? null
    : "Choose a valid condition value. Date ranges must end on or after their start.";
}
