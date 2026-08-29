// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity reach placeholder (ENT-004, M27/4).
 *
 * M27/8 will compose confidentiality and explicit grants here. Until
 * then Administrators and Legal Team Members reach every Entity, while
 * Contributors and Business Users reach none. Every Entity record read
 * and child read composes this predicate now, so arming confidentiality
 * later changes one helper instead of every route.
 */
import {
  COMMENT_VISIBILITIES,
  and,
  entities,
  eq,
  sql,
  type CommentVisibility,
  type Entity,
  type Executor,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";

export const NO_ENTITY = "No entity exists with this id.";

export function entityReachScope(user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
    case "legal_team_member":
      return undefined;
    case "contributor":
    case "business_user":
      return sql`false`;
    default: {
      const unanswered: never = user.role;
      throw new Error(`No Entity reach rule for role: ${unanswered}`);
    }
  }
}

declare const entityRowLockHeld: unique symbol;
export type LockedEntity = Entity & { readonly [entityRowLockHeld]: true };

export async function reachedEntity(
  db: Transaction,
  user: AuthenticatedUser,
  id: string,
  options: { lock: true },
): Promise<LockedEntity | null>;
export async function reachedEntity(
  db: Executor,
  user: AuthenticatedUser,
  id: string,
  options?: { lock?: false },
): Promise<Entity | null>;
export async function reachedEntity(
  db: Executor,
  user: AuthenticatedUser,
  id: string,
  options: { lock?: boolean } = {},
): Promise<Entity | null> {
  const query = db
    .select()
    .from(entities)
    .where(and(eq(entities.id, id), entityReachScope(user)))
    .limit(1);
  const [row] = await (options.lock ? query.for("update", { of: entities }) : query);
  return row ?? null;
}

export interface EntityAudience {
  entityType: "entity";
  entityId: string;
  tiers: readonly CommentVisibility[];
  seesConfidentialDocuments: boolean;
}

/** The Entity reach rule in the shape the generic Activity feed reads. */
export async function entityAudience(
  db: Executor,
  user: AuthenticatedUser,
  entityId: string,
): Promise<EntityAudience | null> {
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, entityId), entityReachScope(user)))
    .limit(1);
  if (!row) return null;
  return {
    entityType: "entity",
    entityId: row.id,
    tiers: COMMENT_VISIBILITIES,
    // M27/8 narrows this with the Entity grant list. It is true while
    // Entity confidentiality is only schema, not policy.
    seesConfidentialDocuments: true,
  };
}
