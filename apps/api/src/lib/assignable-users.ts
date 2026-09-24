// SPDX-License-Identifier: AGPL-3.0-only
import { asc, isNull, sql, users, type Executor } from "@openlaw/db";

/** Live team candidates. Owner and Request assignment enforce their own role rules. */
export function listAssignableUsers(db: Executor) {
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
      role: users.role,
    })
    .from(users)
    .where(isNull(users.archivedAt))
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
}
