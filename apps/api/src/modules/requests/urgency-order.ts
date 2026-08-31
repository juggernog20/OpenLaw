// SPDX-License-Identifier: AGPL-3.0-only

/** INT-006's database ordering for requester-supplied urgency. */
import { SEVERITY_LEVELS, sql, type AnyPgColumn, type SQL } from "@openlaw/db";

/**
 * DES-018's severity ramp as a number the database can order.
 * Descending on this expression is critical first.
 */
export function requestUrgencyRank(column: AnyPgColumn): SQL {
  const arms = SEVERITY_LEVELS.map(
    (level, index) => sql`when ${level} then ${sql.raw(String(index + 1))}`,
  );
  return sql`case ${column} ${sql.join(arms, sql` `)} end`;
}
