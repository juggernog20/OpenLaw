// SPDX-License-Identifier: AGPL-3.0-only

/** The one live fact for INT-006's shared Inbox queue. */
import {
  ADVISORY_LOCK,
  and,
  count,
  eq,
  isNull,
  requests,
  sql,
  type Transaction,
} from "@openlaw/db";
import { publishLiveEvent } from "../../lib/live-events.js";

/**
 * Reads the new queue total once and publishes it from the transaction
 * that changed the Request. Postgres delivers the frame only on commit.
 */
export async function publishInboxTotal(tx: Transaction): Promise<void> {
  // Queue changes can finish on different Request rows at the same
  // time. Serialize their final count and commit so two transactions
  // cannot both publish the same intermediate total.
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.inboxTotal})`);
  const [queue] = await tx
    .select({ total: count() })
    .from(requests)
    .where(and(isNull(requests.archivedAt), eq(requests.status, "new")));
  await publishLiveEvent(tx, { kind: "inbox", total: queue!.total });
}
