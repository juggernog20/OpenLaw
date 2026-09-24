// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { SearchProperty } from "./search-conditions.js";

export const SearchFieldSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  moduleScope: z.enum(["contract", "matter", "entity"]),
  fieldType: z.enum([
    "text",
    "long_text",
    "number",
    "currency",
    "date",
    "boolean",
    "single_select",
    "multi_select",
    "user",
    "entity",
  ]),
  options: z.array(z.string()).nullable(),
});
export type SearchField = z.infer<typeof SearchFieldSchema>;
export const FIELD_OPERATORS = {
  text: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  long_text: ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  number: ["equals", "greater_than", "less_than", "between", "is_empty", "is_not_empty"],
  currency: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  date: [
    "before",
    "after",
    "on",
    "between",
    "in_last_days",
    "in_next_days",
    "today",
    "this_week",
    "this_month",
    "this_quarter",
    "this_year",
    "is_empty",
    "is_not_empty",
  ],
  boolean: ["is_yes", "is_no", "is_empty"],
  single_select: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  multi_select: ["includes_any", "includes_all", "includes_none", "is_empty"],
  user: ["is_any_of", "is_none_of", "is_empty"],
  entity: ["is_any_of", "is_none_of", "is_empty"],
} as const;
export function isValuelessOperator(operator: string): boolean {
  return ["is_empty", "is_not_empty", "is_yes", "is_no"].includes(operator);
}
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
    free: type === "single_select" || type === "multi_select" ? true : undefined,
    operators: FIELD_OPERATORS[type],
    options: field.options ?? undefined,
  };
}
