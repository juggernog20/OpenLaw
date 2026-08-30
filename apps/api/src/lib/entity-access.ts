// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity reach predicate (ENT-004, DD-014).
 *
 * Administrators reach every Entity. Legal Team Members reach open
 * Entities and Confidential Entities carrying an explicit entity_grants
 * row for them. Contributors and Business Users reach none. Every Entity
 * read composes this predicate before ordering, paging, or projection.
 */
import {
  COMMENT_VISIBILITIES,
  and,
  entities,
  entityGrants,
  eq,
  inArray,
  or,
  sql,
  type CommentVisibility,
  type Entity,
  type Executor,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";

export const NO_ENTITY = "No entity exists with this id.";

export function entityReachScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
      return undefined;
    case "legal_team_member":
      return or(
        eq(entities.isConfidential, false),
        inArray(
          entities.id,
          db
            .select({ entityId: entityGrants.entityId })
            .from(entityGrants)
            .where(eq(entityGrants.userId, user.id)),
        ),
      );
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
    .where(and(eq(entities.id, id), entityReachScope(db, user)))
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
    .where(and(eq(entities.id, entityId), entityReachScope(db, user)))
    .limit(1);
  if (!row) return null;
  return {
    entityType: "entity",
    entityId: row.id,
    tiers: COMMENT_VISIBILITIES,
    seesConfidentialDocuments: true,
  };
}
