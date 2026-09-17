// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002: conditions are data, and formatting uses a fixed set of directives. */
import type { AutoDocCondition, CustomFieldValue } from "@openlaw/db";
import { isAutoDocTextStyle, type TemplateToken } from "../auto-doc-template.js";
import { AutoDocFillError, type AutoDocFillInput } from "./engine.js";

export function evaluateCondition(
  condition: AutoDocCondition,
  answers: Record<string, CustomFieldValue>,
): boolean {
  const answer = Object.hasOwn(answers, condition.fieldSlug)
    ? answers[condition.fieldSlug]
    : undefined;
  if (condition.operator === "is_set")
    return answer !== undefined && answer !== "" && (!Array.isArray(answer) || answer.length > 0);
  const values = Array.isArray(answer) ? answer : [answer];
  const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
  const matches = values.some((value) => expected.some((candidate) => candidate === value));
  return condition.operator === "is_not" ? !matches : matches;
}

export function resolveAutoDocValue(token: TemplateToken, input: AutoDocFillInput): string {
  const field = input.definition.fields.find((candidate) => candidate.slug === token.name);
  if (!field) throw new AutoDocFillError(`Add a form field for Placeholder "${token.name}".`);
  const value = Object.hasOwn(input.answers, token.name) ? input.answers[token.name] : undefined;
  if (value === undefined) return "";
  const plain =
    field.fieldType === "entity"
      ? input.displayValues?.[token.name]
      : Array.isArray(value)
        ? value.join(", ")
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : String(value);
  if (plain === undefined) throw new AutoDocFillError(`Choose a live Entity for "${field.label}".`);
  if (!token.directive || isAutoDocTextStyle(token.directive)) return plain;
  if (token.directive === "upper") return plain.toLocaleUpperCase("en-US");
  if (token.directive.startsWith("currency:")) {
    if (
      (field.fieldType !== "number" && field.fieldType !== "currency") ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    )
      throw new AutoDocFillError(
        `Placeholder "${token.name}" needs a number for its currency format.`,
      );
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: token.directive.slice(9),
    }).format(value);
  }
  if (field.fieldType !== "date" || typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AutoDocFillError(`Placeholder "${token.name}" needs a date for its date format.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new AutoDocFillError(`Placeholder "${token.name}" needs a valid calendar date.`);
  if (token.directive === "date:YYYY-MM-DD") return value;
  if (token.directive === "date:DD/MM/YYYY")
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
