// SPDX-License-Identifier: AGPL-3.0-only

/** Active users can approve, including business users through the Portal. */

import { inArray, users, type Executor } from "@openlaw/db";
import { httpError } from "./problem.js";

/** All current user roles can approve. */
export const APPROVER_ROLES = ["administrator", "legal_team_member", "business_user"] as const;

/** One eligible person, as both callers render them. */
export interface ApproverRow {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

/**
 * Checks a whole set at once and answers them in the order the ids
 * arrived, so the activity entries read in the order the caller picked
 * rather than in whatever order the database returned.
 *
 * `whenArchived` is the one sentence the two callers say differently: a
 * template holds members, and a record asks people. Everything else is
 * shared, because everything else is the same refusal.
 */
export async function eligibleApprovers(
  db: Executor,
  ids: readonly string[],
  whenArchived: (displayName: string) => string,
): Promise<ApproverRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      archivedAt: users.archivedAt,
    })
    .from(users)
    .where(inArray(users.id, [...ids]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw httpError(422, "No user exists with this id.");
    if (row.archivedAt) throw httpError(422, whenArchived(row.displayName));
    if (!(APPROVER_ROLES as readonly string[]).includes(row.role)) {
      throw httpError(422, `${row.displayName} cannot approve a contract.`);
    }
  }
  return ids.map((id) => {
    const row = byId.get(id)!;
    return { id: row.id, displayName: row.displayName, email: row.email, role: row.role };
  });
}
