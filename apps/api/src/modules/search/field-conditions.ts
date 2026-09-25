// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compiles a condition on a live catalog Field (CTR-016) against the
 * record's stored custom Fields. An absent key reads as empty, so
 * "is empty" matches a record the Field was never written on, and a
 * negative operator (does not contain, is none of, includes none)
 * matches that record too rather than skipping it. Dates are ISO
 * strings and compare as text; relative dates resolve through
 * `relative-dates.ts`.
 */

import { contracts, matters, entities, sql, type SQL } from "@openlaw/db";
import type { SearchField, SearchQuestion } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { escapeLikePattern } from "../../lib/like.js";
import { relativeDateRange } from "./relative-dates.js";

export function compileFieldCondition(
  condition: SearchQuestion["conditions"][number],
  field: SearchField,
  user: AuthenticatedUser,
  timeZone: string | undefined,
  now: Date,
): SQL {
  const column = {
    contract: contracts.customFields,
    matter: matters.customFields,
    entity: entities.customFields,
  }[field.moduleScope];
  const { operator, value } = condition;
  const present = sql`coalesce(${column} ? ${field.slug}, false)`;
  if (operator === "is_empty") return sql`not (${present})`;
  if (operator === "is_not_empty") return present;
  const text = sql`(${column} ->> ${field.slug})`;
  if (field.fieldType === "text" || field.fieldType === "long_text") {
    const match = sql`${text} ilike ${`%${escapeLikePattern(value as string)}%`}`;
    return operator === "does_not_contain" ? sql`not coalesce(${match}, false)` : match;
  }
  if (field.fieldType === "boolean")
    return sql`${text} = ${operator === "is_yes" ? "true" : "false"}`;
  if (field.fieldType === "number") {
    const number = sql`(case when ${text} ~ '^-?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then ${text}::numeric end)`;
    if (operator === "between") {
      const [from, to] = value as number[];
      return sql`${number} between ${from}::numeric and ${to}::numeric`;
    }
    if (operator === "greater_than") return sql`${number} > ${value as number}::numeric`;
    if (operator === "less_than") return sql`${number} < ${value as number}::numeric`;
    return sql`${number} = ${value as number}::numeric`;
  }
  if (field.fieldType === "date") {
    // ISO calendar dates sort chronologically without casting retained answers.
    const range = relativeDateRange(operator, value, now, timeZone ?? user.timezone ?? "UTC");
    if (range || operator === "between") {
      const [from, to] = range ?? (value as [string, string]);
      return sql`${text} between ${from} and ${to}`;
    }
    if (operator === "before") return sql`${text} < ${value as string}`;
    if (operator === "after") return sql`${text} > ${value as string}`;
    return sql`${text} = ${value as string}`;
  }
  const values = (value as string[]).map((id) =>
    field.fieldType === "user" && id === "me" ? user.id : id,
  );
  const matches =
    field.fieldType === "multi_select"
      ? sql`(${column} -> ${field.slug}) ${operator === "includes_all" ? sql`?&` : sql`?|`} ${sql.param(values)}::text[]`
      : sql`${text} = any(${sql.param(values)}::text[])`;
  return operator === "is_none_of" || operator === "includes_none"
    ? sql`not coalesce(${matches}, false)`
    : matches;
}
