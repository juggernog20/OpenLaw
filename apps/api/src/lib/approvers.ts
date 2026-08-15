// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who may approve a contract (CTR-012, DD-013).
 *
 * One rule, asked in two places. An approver group's member list asks
 * it when an Administrator saves a template (#231); a contract's
 * approval request asks it when somebody names a colleague on a record
 * (#233). The two must answer the same, or a template would be able to
 * hold a person the record then refuses — and the Administrator would
 * find that out from a failed request rather than from the pane.
 *
 * The rule is short: an approver is a live **Member+** user. A
 * Contributor and a Business User never sign a contract off (DD-013),
 * and an archived person has left (SET-005), so a request addressed to
 * them reaches nobody.
 *
 * It is application-enforced rather than a database constraint, because
 * a role change cannot be checked by one. Somebody who loses their
 * standing after being named stays on the template and on the request:
 * dropping them silently would edit the record behind the people
 * reading it.
 *
 * The refusal **names the person** rather than counting the offenders.
 * Every picker that leads here offers eligible people only, so a
 * refusal means the list the caller was holding went stale — and which
 * row went stale is the thing they can act on.
 */

import { inArray, users } from "@openlaw/db";
import type { ContractAccessReader } from "./contract-access.js";
import { httpError } from "./problem.js";

/** Only a Member+ user can be an approver (CTR-012, DD-013). */
export const APPROVER_ROLES = ["administrator", "legal_team_member"] as const;

/** One eligible person, as both callers render them. */
export interface ApproverRow {
  id: string;
  displayName: string;
  email: string;
}

/**
 * Checks a whole set at once and answers them in the order the ids
 * arrived — so the activity entries read in the order the caller picked
 * rather than in whatever order the database returned.
 *
 * `whenArchived` is the one sentence the two callers say differently: a
 * template holds members, and a record asks people. Everything else is
 * shared, because everything else is the same refusal.
 */
export async function eligibleApprovers(
  db: ContractAccessReader,
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
      throw httpError(
        422,
        `${row.displayName} is not an Administrator or a Legal Team Member, ` +
          "so they can't approve a contract.",
      );
    }
  }
  return ids.map((id) => {
    const row = byId.get(id)!;
    return { id: row.id, displayName: row.displayName, email: row.email };
  });
}
