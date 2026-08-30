// SPDX-License-Identifier: AGPL-3.0-only

/** SET-003 usage guard for Knowledge types; archived items still count (ENT-009 rule). */
import { count, eq, inArray, knowledgeItems, type Executor } from "@openlaw/db";
import { recordActivity } from "../../lib/activity.js";
import type { TaxonomyUsage } from "../../lib/taxonomy-routes.js";

export const knowledgeTypeUsage: TaxonomyUsage = {
  async counts(db: Executor, ids: string[]) {
    const rows = await db
      .select({ typeId: knowledgeItems.knowledgeTypeId, inUse: count() })
      .from(knowledgeItems)
      .where(inArray(knowledgeItems.knowledgeTypeId, ids))
      .groupBy(knowledgeItems.knowledgeTypeId);
    return new Map(rows.map((row) => [row.typeId, row.inUse]));
  },

  async reassign(tx, { from, to, actorId }) {
    const moved = await tx
      .update(knowledgeItems)
      .set({ knowledgeTypeId: to.id, updatedBy: actorId })
      .where(eq(knowledgeItems.knowledgeTypeId, from.id))
      .returning({ id: knowledgeItems.id, title: knowledgeItems.title });
    await recordActivity(
      tx,
      moved.map((row) => ({
        entityType: "knowledge_item" as const,
        entityId: row.id,
        actorId,
        action: "knowledge_item.type_reassigned" as const,
        visibility: "legal_only" as const,
        payload: { title: row.title, from: from.displayName, to: to.displayName },
      })),
    );
    return moved.length;
  },
};
