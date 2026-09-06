// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { and, inArray, isNull, or, sql, type AnyPgColumn, type SQL } from "@openlaw/db";

/** Commas mean OR within a property; separate properties are ANDed by the list. */
export const FilterChoices = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      value.split(",").length <= 50 &&
      value.split(",").every((part) => /^[a-zA-Z0-9_-]{1,64}$/.test(part)),
    "Choose up to 50 values",
  );

export function choiceFilter(
  column: AnyPgColumn,
  value?: string,
  viewer?: string,
): SQL | undefined {
  if (!value) return undefined;
  const values = [
    ...new Set(value.split(",").map((item) => (item === "me" && viewer ? viewer : item))),
  ];
  const assigned = values.filter((item) => item !== "unassigned");
  return or(
    assigned.length ? inArray(column, assigned) : undefined,
    values.includes("unassigned") ? isNull(column) : undefined,
  );
}

export function dateFilter(column: AnyPgColumn | SQL, from?: string, to?: string): SQL | undefined {
  return and(
    from ? sql`${column} >= ${from}::date` : undefined,
    to ? sql`${column} <= ${to}::date` : undefined,
  );
}

export function validDateRanges(query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, from]) => {
    if (!key.endsWith("From") || typeof from !== "string") return true;
    const to = query[key.slice(0, -4) + "To"];
    return typeof to !== "string" || from <= to;
  });
}

export const FilterOptionsSchema = z.object({
  types: z.array(z.object({ id: z.string(), displayName: z.string() })),
  statuses: z.array(z.object({ id: z.string(), displayName: z.string() })),
  people: z.array(z.object({ id: z.string(), displayName: z.string() })),
});
