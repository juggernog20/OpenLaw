// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  SEARCH_FIELD_KINDS,
  SEARCH_FIELD_TYPES,
  isValuelessOperator,
  type SearchField,
} from "./search-fields.js";
import type { SEARCH_KINDS } from "./search-question.js";

export type SearchProperty = {
  kind: (typeof SEARCH_KINDS)[number];
  key: string;
  label: string;
  type: "choices" | "text" | "flag" | "date" | "number";
  operators?: readonly string[];
  options?: readonly string[];
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
  number: ["equals", "greater_than", "less_than", "between"],
  choices: ["is_any_of", "is_none_of"],
  text: ["contains", "does_not_contain"],
  flag: ["is"],
  date: ["before", "after", "on", "between", ...RELATIVE_DATE_OPERATORS],
} as const;

/** The operator set per Field type (#1092). A currency Field stores an
 * ISO code, not an amount, so it takes the choice operators; numeric
 * comparison is for number Fields only. */
export const FIELD_OPERATORS = {
  text: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  long_text: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  number: [...SEARCH_OPERATORS.number, "is_empty", "is_not_empty"],
  currency: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  date: [...SEARCH_OPERATORS.date, "is_empty", "is_not_empty"],
  boolean: ["is_yes", "is_no", "is_empty"],
  single_select: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  multi_select: ["includes_any", "includes_all", "includes_none", "is_empty"],
  user: ["is_any_of", "is_none_of", "is_empty"],
  entity: ["is_any_of", "is_none_of", "is_empty"],
} as const;

/** A live Field as a search property: `field:<slug>` under its module's kind. */
export function fieldProperty(field: SearchField): SearchProperty {
  const type = field.fieldType;
  return {
    kind: field.moduleScope,
    key: `field:${field.slug}`,
    label: field.displayName,
    type:
      type === "text" || type === "long_text"
        ? "text"
        : type === "number"
          ? "number"
          : type === "date"
            ? "date"
            : type === "boolean"
              ? "flag"
              : "choices",
    // Option labels are free strings, so a comma inside one is data.
    free: type === "single_select" || type === "multi_select" ? true : undefined,
    operators: FIELD_OPERATORS[type],
    options: field.options ?? undefined,
  };
}

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

export function conditionProblem(
  condition: {
    kind: string;
    property: string;
    operator: string;
    value?: unknown;
  },
  catalog?: readonly SearchField[],
): string | null {
  if (condition.property.startsWith("field:") && catalog === undefined) {
    if (
      !(SEARCH_FIELD_KINDS as readonly string[]).includes(condition.kind) ||
      !/^field:[a-z0-9_-]+$/.test(condition.property)
    )
      return "Unknown search Field.";
    // The codec checks the operand shape; the server resolves the live type.
    return SEARCH_FIELD_TYPES.some(
      (fieldType) =>
        conditionProblem(condition, [
          {
            slug: condition.property.slice(6),
            displayName: "",
            moduleScope: condition.kind as SearchField["moduleScope"],
            fieldType,
            options: null,
          },
        ]) === null,
    )
      ? null
      : "Invalid Field condition.";
  }
  const field = catalog?.find(
    (field) => field.moduleScope === condition.kind && `field:${field.slug}` === condition.property,
  );
  const property = field
    ? fieldProperty(field)
    : searchProperty(condition.kind, condition.property);
  if (!property) return "Unknown search property.";
  if (
    !((property.operators ?? SEARCH_OPERATORS[property.type]) as readonly string[]).includes(
      condition.operator,
    )
  )
    return "The operator does not fit this property's value type.";
  if (isValuelessOperator(condition.operator))
    return condition.value == null ? null : "This operator takes no value.";
  if (
    property.options &&
    Array.isArray(condition.value) &&
    condition.value.some((value) => !property.options!.includes(value))
  )
    return "Choose an option from this Field.";
  if (property.type === "date" && isRelativeDateOperator(condition.operator)) {
    if (needsRelativeDayCount(condition.operator))
      return z.number().int().min(1).max(3650).safeParse(condition.value).success
        ? null
        : "Relative day count N must be a whole number from 1 to 3650.";
    return condition.value == null ? null : "This relative date operator takes no value.";
  }
  if (condition.value === undefined) return "A condition value is required.";
  const schema =
    property.type === "number"
      ? condition.operator === "between"
        ? z.tuple([z.number(), z.number()]).refine(([from, to]) => from <= to)
        : z.number()
      : property.type === "choices"
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
