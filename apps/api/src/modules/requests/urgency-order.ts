// SPDX-License-Identifier: AGPL-3.0-only

/** INT-006's database ordering for requester-supplied urgency. */
import { SEVERITY_LEVELS, sql, type AnyPgColumn, type SQL } from "@openlaw/db";

/**
 * DES-018's severity ramp as a number the database can order.
 * Descending on this expression is critical first — which holds only
 * while SEVERITY_LEVELS stays ordered least urgent to most urgent, as
 * the rank is the level's position in that list.
 */
export function requestUrgencyRank(column: AnyPgColumn): SQL {
  const arms = SEVERITY_LEVELS.map(
    (level, index) => sql`when ${level} then ${sql.raw(String(index + 1))}`,
  );
  return sql`case ${column} ${sql.join(arms, sql` `)} end`;
}
