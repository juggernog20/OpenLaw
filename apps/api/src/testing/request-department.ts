// SPDX-License-Identifier: AGPL-3.0-only

/** Creates a live Department fixture for Request submission tests (TECH-019). */

import { departments, eq, type Db } from "@openlaw/db";

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
