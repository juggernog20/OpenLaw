// SPDX-License-Identifier: AGPL-3.0-only

/** Commit-gated publication for TECH-009's live prompts. */

import { sql, type Transaction } from "@openlaw/db";
import { LIVE_EVENT_CHANNEL, type LiveEvent } from "@openlaw/shared";

/**
 * Publishes one prompt from inside the transaction that changed the row.
 * Postgres delivers it only if that transaction commits.
 */
export async function publishLiveEvent(tx: Transaction, event: LiveEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${LIVE_EVENT_CHANNEL}, ${JSON.stringify(event)})`);
}
