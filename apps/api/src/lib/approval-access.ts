// SPDX-License-Identifier: AGPL-3.0-only

import {
  and,
  contractApprovals,
  contracts,
  eq,
  inArray,
  isNull,
  users,
  type Executor,
} from "@openlaw/db";

/** Pending approval notifications only reach the people still named on a live request. */
export async function approvalRecipients(
  db: Executor,
  contractId: string,
  userIds: readonly string[],
  approvalId?: string,
) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ id: users.id })
    .from(contractApprovals)
    .innerJoin(contracts, eq(contracts.id, contractApprovals.contractId))
    .innerJoin(users, eq(users.id, contractApprovals.approverId))
    .where(
      and(
        eq(contracts.id, contractId),
        isNull(contracts.archivedAt),
        isNull(users.archivedAt),
        eq(contractApprovals.status, "pending"),
        inArray(users.id, [...userIds]),
        approvalId ? eq(contractApprovals.id, approvalId) : undefined,
      ),
    );
  return new Set(rows.map((row) => row.id));
}
