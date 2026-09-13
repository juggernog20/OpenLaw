// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-003: form answers have one stored shape, with Entity ids checked at submission. */
import {
  and,
  entities,
  eq,
  isNull,
  type AutoDocFormDefinition,
  type CustomFieldValue,
  type Transaction,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { entityReachScope } from "../../lib/entity-access.js";
import { httpError } from "../../lib/problem.js";

export async function validateGenerationAnswers(
  tx: Transaction,
  user: AuthenticatedUser,
  definition: AutoDocFormDefinition,
  raw: Record<string, CustomFieldValue | null>,
) {
  const answers: Record<string, CustomFieldValue> = {};
  const displayValues: Record<string, string> = {};
  const gaps: string[] = [];
  for (const slug of Object.keys(raw))
    if (!definition.fields.some((field) => field.slug === slug))
      gaps.push(`Remove unknown form field "${slug}".`);
  for (const field of definition.fields) {
    let value = Object.hasOwn(raw, field.slug) ? raw[field.slug] : null;
    if (typeof value === "string") value = value.trim();
    const absent =
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (absent) {
      if (field.required) gaps.push(`Fill "${field.label}" first.`);
      continue;
    }
    const refuse = (detail: string) => gaps.push(`"${field.label}": ${detail}`);
    switch (field.fieldType) {
      case "text":
      case "long_text":
        if (
          typeof value !== "string" ||
          value.length > (field.fieldType === "text" ? 500 : 10_000)
        ) {
          refuse("give a text value within the field limit.");
          continue;
        }
        break;
      case "number":
      case "currency":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          refuse("give a number.");
          continue;
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          refuse("answer yes or no.");
          continue;
        }
        break;
      case "date": {
        const date =
          typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? new Date(`${value}T00:00:00Z`)
            : null;
        if (
          !date ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        ) {
          refuse("give a valid date as YYYY-MM-DD.");
          continue;
        }
        break;
      }
      case "single_select":
        if (typeof value !== "string" || !field.options?.includes(value)) {
          refuse("pick one of the options.");
          continue;
        }
        break;
      case "multi_select":
        if (
          !Array.isArray(value) ||
          new Set(value).size !== value.length ||
          value.some((choice) => !field.options?.includes(choice))
        ) {
          refuse("pick each option once from the list.");
          continue;
        }
        value = field.options!.filter((option) => (value as string[]).includes(option));
        break;
      case "entity": {
        if (typeof value !== "string") {
          refuse("choose a live Entity from the list.");
          continue;
        }
        const [entity] = await tx
          .select({ name: entities.legalName })
          .from(entities)
          .where(
            and(eq(entities.id, value), isNull(entities.archivedAt), entityReachScope(tx, user)),
          )
          .for("share");
        if (!entity) {
          refuse("choose a live Entity from the list.");
          continue;
        }
        displayValues[field.slug] = entity.name;
        break;
      }
      default: {
        const unhandled: never = field.fieldType;
        throw new Error(`Unsupported Auto-Doc field type: ${unhandled}`);
      }
    }
    answers[field.slug] = value!;
  }
  if (gaps.length) throw httpError(400, gaps.join(" "));
  return { answers, displayValues };
}
