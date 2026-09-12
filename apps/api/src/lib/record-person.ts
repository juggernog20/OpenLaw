// SPDX-License-Identifier: AGPL-3.0-only

import { eq, users, type Executor } from "@openlaw/db";

/** Historical owner and Creator statements keep naming archived people. */
export async function recordPerson(db: Executor, id: string | null) {
  if (!id) return null;
  const [person] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return person
    ? {
        id: person.id,
        displayName: person.displayName,
        image: person.image,
        archived: person.archivedAt !== null,
      }
    : null;
}
