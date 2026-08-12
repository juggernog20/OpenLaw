// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The entity-type live-usage machinery (#100): the registry is the
 * first record milestone to arm the SET-003 archive guard, so the
 * taxonomy factory's placeholder zero becomes a genuine query over
 * `entities.entity_type_id` here. Archived entities count and move too
 * (ENT-009): the counted set, the moved set, and the set the records'
 * FK protects are one set — a restored entity must never come back
 * holding an archived type. Each moved entity gets its own DD-017 feed
 * entry, written on the caller's executor: the archive route passes
 * its transaction, with the type rows already locked, so the move
 * serializes against concurrent registrations and re-types.
 */

import { count, entities, eq, inArray } from "@openlaw/db";
import { recordActivity, type ActivityWriter } from "../../lib/activity.js";
import type { TaxonomyUsage } from "../../lib/taxonomy-routes.js";

export const entityTypeUsage: TaxonomyUsage = {
  async counts(db: ActivityWriter, ids: string[]) {
    const rows = await db
      .select({ typeId: entities.entityTypeId, inUse: count() })
      .from(entities)
      .where(inArray(entities.entityTypeId, ids))
      .groupBy(entities.entityTypeId);
    return new Map(rows.map((row) => [row.typeId, row.inUse]));
  },

  async reassign(tx, { from, to, actorId }) {
    const moved = await tx
      .update(entities)
      .set({ entityTypeId: to.id })
      .where(eq(entities.entityTypeId, from.id))
      .returning({ id: entities.id, legalName: entities.legalName });
    // Per-entity feed rows (DD-017): the M9 record feed must explain
    // why the type changed. Legal Only, like every registry action
    // (ENT-004); the admin-side story is the system-level
    // `entity_type.archived` entry the archive route writes.
    await recordActivity(
      tx,
      moved.map((row) => ({
        entityType: "entity" as const,
        entityId: row.id,
        actorId,
        action: "entity.type_reassigned" as const,
        visibility: "legal_only" as const,
        payload: { legalName: row.legalName, from: from.displayName, to: to.displayName },
      })),
    );
    return moved.length;
  },
};
