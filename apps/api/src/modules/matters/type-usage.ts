// SPDX-License-Identifier: AGPL-3.0-only

/** Matter-type SET-003 usage counts and transactional reassignment. */
import { count, eq, inArray, matters, type Executor } from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import type { TaxonomyUsage } from "../../lib/taxonomy-routes.js";

export const matterTypeUsage: TaxonomyUsage = {
  async counts(db: Executor, ids: string[]) {
    const rows = await db
      .select({ typeId: matters.matterTypeId, inUse: count() })
      .from(matters)
      .where(inArray(matters.matterTypeId, ids))
      .groupBy(matters.matterTypeId);
    return new Map(rows.map((row) => [row.typeId, row.inUse]));
  },
  async reassign(tx, { from, to, actorId }) {
    const moved = await tx
      .update(matters)
      .set({ matterTypeId: to.id })
      .where(eq(matters.matterTypeId, from.id))
      .returning({ id: matters.id, number: matters.number, title: matters.title });
    if (moved.length === 0) return 0;
    await recordActivity(
      tx,
      moved.map((row) => ({
        entityType: "matter" as const,
        entityId: row.id,
        actorId,
        action: "matter.type_reassigned" as const,
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
