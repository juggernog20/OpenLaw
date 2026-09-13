// SPDX-License-Identifier: AGPL-3.0-only

/** SET-010 Department pickers, assignment checks, and names for retained references. */

import { and, asc, departments, eq, isNull, type Executor } from "@openlaw/db";
import { httpError } from "../../lib/problem.js";

export function departmentOptions(db: Executor) {
  return db
    .select({ id: departments.id, displayName: departments.displayName })
    .from(departments)
    .where(isNull(departments.archivedAt))
    .orderBy(asc(departments.displayOrder), asc(departments.id));
}

export async function lockedDepartment(db: Executor, id: string) {
  const [row] = await db.select().from(departments).where(eq(departments.id, id)).for("share");
  if (!row || row.archivedAt) throw httpError(400, "Choose a live Department.");
  return row;
}

export async function departmentName(db: Executor, id: string | null) {
  if (!id) return null;
  const [row] = await db
    .select({ name: departments.displayName })
    .from(departments)
    .where(eq(departments.id, id));
  return row?.name ?? null;
}

export async function departmentByName(db: Executor, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const [row] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.displayName, value.trim()), isNull(departments.archivedAt)))
    .orderBy(asc(departments.displayOrder), asc(departments.id))
    .limit(1)
    .for("share");
  return row?.id ?? null;
}
