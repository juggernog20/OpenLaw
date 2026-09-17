// SPDX-License-Identifier: AGPL-3.0-only

/** Request-type SET-003 usage counts and transactional reassignment. */
import { count, eq, inArray, requests, type Executor } from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import type { TaxonomyUsage } from "../../lib/taxonomy-routes.js";

export const requestTypeUsage: TaxonomyUsage = {
  async counts(db: Executor, ids: string[]) {
    const rows = await db
      .select({ typeId: requests.requestTypeId, inUse: count() })
      .from(requests)
      .where(inArray(requests.requestTypeId, ids))
      .groupBy(requests.requestTypeId);
    return new Map(rows.map((row) => [row.typeId, row.inUse]));
  },
  async reassign(tx, { from, to, actorId }) {
    const moved = await tx
      .update(requests)
      .set({ requestTypeId: to.id })
      .where(eq(requests.requestTypeId, from.id))
      .returning({ id: requests.id, number: requests.number, title: requests.title });
    if (moved.length === 0) return 0;
    await recordActivity(
      tx,
      moved.map((row) => ({
        entityType: "request" as const,
        entityId: row.id,
        actorId,
        action: "request.type_reassigned" as const,
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          number: row.number,
          title: row.title,
          from: from.displayName,
          to: to.displayName,
        },
      })),
    );
    return moved.length;
  },
};
