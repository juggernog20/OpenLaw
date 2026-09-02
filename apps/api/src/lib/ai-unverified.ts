// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-008's rule for a human write: the slot it lands on is verified by
 * definition, so the slot's `ai_unverified` entry goes in the same
 * transaction. The Contract PATCH clears its slugs from the row it holds;
 * this helper is for write paths that never load the map.
 */

import { and, contracts, eq, sql, type Executor } from "@openlaw/db";

/**
 * Removes one slug's entry from a Contract's `ai_unverified` map. The
 * UPDATE runs only when the entry exists, so a record with nothing to
 * clear is not rewritten, and an emptied map is stored as null.
 */
export async function clearAiUnverified(
  db: Executor,
  contractId: string,
  slug: string,
): Promise<void> {
  await db
    .update(contracts)
    .set({ aiUnverified: sql`nullif(${contracts.aiUnverified} - ${slug}, '{}'::jsonb)` })
    .where(and(eq(contracts.id, contractId), sql`${contracts.aiUnverified} ? ${slug}`));
}
