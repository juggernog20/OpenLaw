// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-010 applies the same eligibility rule to every Portal picker and write. */

import { and, asc, entities, eq, isNull, sql, type Executor, type Transaction } from "@openlaw/db";
import { httpError } from "./problem.js";

export const portalEntityScope = and(
  eq(entities.portalListed, true),
  eq(entities.isConfidential, false),
  isNull(entities.archivedAt),
)!;

export async function assertPortalEntity(tx: Transaction, id: string, fieldName: string) {
  const [entity] = await tx
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, id), portalEntityScope))
    .limit(1)
    .for("update");
  if (!entity) throw httpError(400, `${fieldName}: choose a Portal-listed Entity from the list.`);
}

export async function listPortalEntities(db: Executor) {
  return db
    .select({ id: entities.id, name: entities.legalName })
    .from(entities)
    .where(portalEntityScope)
    .orderBy(asc(sql`lower(${entities.legalName})`), asc(entities.id));
}
