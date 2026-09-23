// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pin and settle approval notifications (NOT-001).
 * Reading does not handle an approval. An answer or cancellation stamps
 * handledAt and reads every copy, then tells each recipient to refresh their bell.
 */
import { and, eq, isNotNull, isNull, notifications, sql, type Transaction } from "@openlaw/db";

import { publishLiveEvents } from "../live-events.js";

export const openApproval = and(
  isNotNull(notifications.approvalKind),
  isNull(notifications.handledAt),
)!;

/** Settle every recipient's item in the transaction that handles the approval. */
export async function handleApprovalItems(
  db: Transaction,
  kind: "contract" | "api_key",
  id: string,
) {
  const handled = await db
    .update(notifications)
    .set({ handledAt: sql`now()`, readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(
      and(
        openApproval,
        eq(notifications.approvalKind, kind),
        kind === "contract"
          ? and(
              eq(notifications.entityType, "contract"),
              sql`${notifications.payload}->>'approvalId' = ${id}`,
            )
          : and(eq(notifications.entityType, "api_key_request"), eq(notifications.entityId, id)),
      ),
    )
    .returning({ userId: notifications.userId });
  await publishLiveEvents(
    db,
    handled.map((row) => ({ kind: "bell", userId: row.userId })),
  );
}
