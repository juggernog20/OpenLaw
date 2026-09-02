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

/**
 * Publishes many prompts in one round trip.
 *
 * A fan-out addresses one prompt per recipient, and the transaction
 * holds its row locks until every one of them is issued. One statement
 * over the whole list keeps that window the same size whatever the
 * audience. Postgres collapses identical payloads within a transaction,
 * so a repeated recipient costs nothing.
 */
export async function publishLiveEvents(
  tx: Transaction,
  events: readonly LiveEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const payloads = JSON.stringify(events.map((event) => JSON.stringify(event)));
  await tx.execute(
    sql`select pg_notify(${LIVE_EVENT_CHANNEL}, payload)
        from json_array_elements_text(${payloads}::json) as payload`,
  );
}
