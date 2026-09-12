// SPDX-License-Identifier: AGPL-3.0-only

import { and, isNull, lt, or, sql, type SQL } from "@openlaw/db";
import { z } from "zod";

export const PortalListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  typeId: z.string().min(1).max(100).optional(),
  ownerId: z.string().min(1).max(100).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
export const ListChoice = z.object({ id: z.string(), displayName: z.string() });
export const ListFilterOptions = z.object({
  types: z.array(ListChoice),
  owners: z.array(ListChoice),
});

export function choices(values: { id: string | null; displayName: string | null }[]) {
  return [
    ...new Map(
      values.flatMap((value) =>
        value.id !== null && value.displayName !== null
          ? [[value.id, { id: value.id, displayName: value.displayName }] as const]
          : [],
      ),
    ).values(),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function searchPattern(query: string) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

/** The caller reads the boundary through the same membership and filters as the page. */
export function afterCursor(
  expr: SQL,
  number: SQL,
  cursor: number,
  value: unknown,
  dir: "asc" | "desc",
) {
  return value === null
    ? and(isNull(expr), lt(number, cursor))
    : or(
        isNull(expr),
        sql`${expr} ${sql.raw(dir === "asc" ? ">" : "<")} ${value}`,
        and(sql`${expr} = ${value}`, lt(number, cursor)),
      );
}
export function listOrder(expr: SQL, number: SQL, dir: "asc" | "desc") {
  return [sql`${expr} ${sql.raw(dir === "asc" ? "asc" : "desc")} nulls last`, sql`${number} desc`];
}
