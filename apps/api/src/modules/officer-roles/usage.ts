// SPDX-License-Identifier: AGPL-3.0-only

/** SET-003 usage guard for officer roles. Resigned officers still count (ENT-009 rule). */
import { count, entityOfficers, eq, inArray, type Executor } from "@openlaw/db";
import type { TaxonomyUsage } from "../../lib/taxonomy-routes.js";

export const officerRoleUsage: TaxonomyUsage = {
  async counts(db: Executor, ids: string[]) {
    const rows = await db
      .select({ roleId: entityOfficers.officerRoleId, inUse: count() })
      .from(entityOfficers)
      .where(inArray(entityOfficers.officerRoleId, ids))
      .groupBy(entityOfficers.officerRoleId);
    return new Map(rows.map((row) => [row.roleId, row.inUse]));
  },

  async reassign(tx, { from, to }) {
    const moved = await tx
      .update(entityOfficers)
      .set({ officerRoleId: to.id })
      .where(eq(entityOfficers.officerRoleId, from.id))
      .returning({ id: entityOfficers.id });
    return moved.length;
  },
};
