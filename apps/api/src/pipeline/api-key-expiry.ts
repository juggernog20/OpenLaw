// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-029 expiry audit on a daily pg-boss schedule, following TECH-007. Reads derive
 * expiry from the credential timestamp; this sweep only records the first observation.
 */

import { apiKeyRequests, apikeys, and, eq, isNull, lte, type Db } from "@openlaw/db";
import { recordActivity } from "../lib/activity.js";
export const API_KEY_EXPIRY_CRON = "0 0 * * *";

/** The timestamp determines expiry immediately; the daily job records it once. */
export async function sweepApiKeyExpiry(
  db: Db,
  now = new Date(),
  signal?: AbortSignal,
): Promise<number> {
  let count = 0;
  while (!signal?.aborted) {
    const written = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ request: apiKeyRequests })
        .from(apiKeyRequests)
        .innerJoin(apikeys, eq(apikeys.id, apiKeyRequests.keyId))
        .where(
          and(
            isNull(apiKeyRequests.expiryAuditedAt),
            isNull(apiKeyRequests.revokedAt),
            lte(apikeys.expiresAt, now),
          ),
        )
        .orderBy(apiKeyRequests.id)
        .limit(100)
        .for("update", { of: apiKeyRequests, skipLocked: true });
      for (const { request } of rows) {
        await tx
          .update(apiKeyRequests)
          .set({ expiryAuditedAt: now, sealedKey: null })
          .where(eq(apiKeyRequests.id, request.id));
        await recordActivity(tx, {
          entityType: "system",
          action: "api_key.expired",
          visibility: "admin_only",
          payload: {
            requestId: request.id,
            requesterId: request.requesterId,
            clientName: request.clientName,
            keyId: request.keyId!,
          },
        });
      }
      return rows.length;
    });
    count += written;
    if (written < 100) break;
  }
  return count;
}
