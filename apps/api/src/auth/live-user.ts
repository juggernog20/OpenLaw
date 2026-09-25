// SPDX-License-Identifier: AGPL-3.0-only

/** DD-013 and DD-029: sessions, API keys and OAuth grants read the current account and refuse archived people. */

import { eq, users, type Executor } from "@openlaw/db";
import type { AuthenticatedUser } from "./user.js";
import { httpError } from "../lib/problem.js";

export async function readLiveUser(db: Executor, id: string): Promise<AuthenticatedUser> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      theme: users.theme,
      timezone: users.timezone,
      archivedAt: users.archivedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user || user.archivedAt !== null) throw httpError(401, "Authentication required.");
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    theme: user.theme,
    timezone: user.timezone,
  };
}
