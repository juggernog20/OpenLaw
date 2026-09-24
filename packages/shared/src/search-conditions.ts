// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

export type SearchProperty = {
  kind: "contract" | "matter";
  key: string;
  label: string;
  type: "choices" | "text" | "flag" | "date";
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
];

export const SEARCH_OPERATORS = {
  choices: ["is_any_of", "is_none_of"],
  text: ["contains", "does_not_contain"],
  flag: ["is"],
  date: ["before", "after", "on", "between"],
} as const;

export function searchProperty(kind: string, key: string): SearchProperty | undefined {
  return SEARCH_PROPERTIES.find((property) => property.kind === kind && property.key === key);
}

const choices = z
  .array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
  .min(1)
  .max(50);
const date = z.iso.date().refine((value) => value >= "0001-01-01");
const range = z.tuple([date, date]).refine(([from, to]) => from <= to);

export function conditionProblem(condition: {
  kind: string;
  property: string;
  operator: string;
  value: unknown;
}): string | null {
  const property = searchProperty(condition.kind, condition.property);
  if (!property) return "Unknown search property.";
  if (!(SEARCH_OPERATORS[property.type] as readonly string[]).includes(condition.operator))
    return "The operator does not fit this property's value type.";
  const schema =
    property.type === "choices"
      ? choices
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
