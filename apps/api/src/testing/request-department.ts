// SPDX-License-Identifier: AGPL-3.0-only

import { departments, eq, type Db } from "@openlaw/db";

/** A real selectable Department for Request submission fixtures. */
export async function requestDepartment(db: Db) {
  await db
    .insert(departments)
    .values({ slug: "request-fixture", displayName: "Request Department", displayOrder: 1 })
    .onConflictDoNothing();
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.slug, "request-fixture"));
  return department!.id;
}
