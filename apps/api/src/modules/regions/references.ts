// SPDX-License-Identifier: AGPL-3.0-only

import { asc, eq, isNull, regions, sql, type Executor } from "@openlaw/db";
import { httpError } from "../../lib/problem.js";

export function regionOptions(db: Executor) {
  return db
    .select({ id: regions.id, displayName: regions.displayName })
    .from(regions)
    .where(isNull(regions.archivedAt))
    .orderBy(asc(sql`lower(${regions.displayName})`), asc(regions.id));
}

export async function lockedRegionName(db: Executor, value: string | null | undefined) {
  if (!value?.trim()) return null;
  const [row] = await db
    .select()
    .from(regions)
    .where(eq(regions.displayName, value.trim()))
    .for("share");
  if (!row || row.archivedAt)
    throw httpError(400, "Choose an available Region from Organization Settings.");
  return row.displayName;
}
