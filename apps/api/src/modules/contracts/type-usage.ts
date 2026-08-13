// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-type live-usage machinery (#113): the contract record
 * arms the SET-003 archive guard for CTR-002's taxonomy, so the factory's
 * placeholder zero becomes a genuine query over `contracts.contract_type_id`.
 * Entity types got here first (#100) and this is the same shape, with the
 * same counting rule: archived contracts count and move too (ENT-009,
 * inherited by the contract taxonomy with this milestone). The counted
 * set, the moved set, and the set the records' FK protects are one set,
 * and a restored contract never comes back holding an archived type.
 *
 * The move is a system move, not a re-type a person chose. Two things
 * follow from that.
 *
 * - **The hard-required rule does not run.** `assertRequiredCustomFields`
 *   (CTR-016, MTR-014) is the one entry point for that refusal and this
 *   path deliberately does not call it: a refusal here would strand every
 *   contract on a type an Administrator is archiving. The target type's
 *   required fields become gaps to fill on each record.
 * - **Values are retained.** `custom_fields` is keyed by field slug, so
 *   the move touches the type column and nothing else. A slug the new
 *   type also attaches reads straight through; a slug it does not attach
 *   is held, not shown (the same rule that retains a detached field's
 *   value).
 *
 * Each moved contract gets its own DD-017 feed entry under a dedicated
 * verb, `contract.type_reassigned` — `contract.updated` would claim a
 * person edited the record. Everything runs on the caller's executor: the
 * archive route passes its transaction, with the type rows already
 * locked, so the move serializes against concurrent creates and re-types,
 * which lock the same row before they write.
 */

import { contracts, count, eq, inArray } from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER, type ActivityWriter } from "../../lib/activity.js";
import type { TaxonomyUsage } from "../../lib/taxonomy-routes.js";

export const contractTypeUsage: TaxonomyUsage = {
  async counts(db: ActivityWriter, ids: string[]) {
    const rows = await db
      .select({ typeId: contracts.contractTypeId, inUse: count() })
      .from(contracts)
      .where(inArray(contracts.contractTypeId, ids))
      .groupBy(contracts.contractTypeId);
    return new Map(rows.map((row) => [row.typeId, row.inUse]));
  },

  async reassign(tx, { from, to, actorId }) {
    const moved = await tx
      .update(contracts)
      .set({ contractTypeId: to.id })
      .where(eq(contracts.contractTypeId, from.id))
      .returning({ id: contracts.id, number: contracts.number, title: contracts.title });
    // An archived type with no contracts on it is the ordinary case, and
    // `recordActivity` forwards its entries straight into `values()`,
    // which Drizzle refuses when the list is empty. Leave before the
    // write rather than let the archive transaction abort on a 500.
    if (moved.length === 0) return 0;
    // Working Team, like every other contract-record entry (DD-017,
    // M9/6): the record's working group reads its own narrative. The
    // Administrator-side story is the system-level
    // `contract_type.archived` entry the archive route writes.
    await recordActivity(
      tx,
      moved.map((row) => ({
        entityType: "contract" as const,
        entityId: row.id,
        actorId,
        action: "contract.type_reassigned" as const,
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
