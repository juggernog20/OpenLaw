// SPDX-License-Identifier: AGPL-3.0-only
import {
  ADVISORY_LOCK,
  and,
  entities,
  entityTypes,
  eq,
  sql,
  type Entity,
  type Executor,
  type RegisterKind,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/guards.js";
import { reachedEntity } from "./entity-access.js";
import { httpError } from "./problem.js";

export const REGISTER_LOCK_REASON = "The register kind cannot change while a register holds data.";

/** Take before type or Entity rows, in the same order as register writes. */
export async function lockEntityRegisters(tx: Executor) {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.entityHoldings})`);
}

/** New register engines add their entry tables here when their migrations land. */
export const registerHasData = sql<boolean>`(
  exists (select 1 from entity_share_classes c where c.entity_id = ${entities.id})
  or exists (select 1 from entity_share_entries r where r.entity_id = ${entities.id})
)`;

export async function entityRegisterState(db: Executor, entity: Entity) {
  const [state] = await db
    .select({
      typeRegisterKind: entityTypes.registerKind,
      registerKindLocked: registerHasData,
    })
    .from(entities)
    .innerJoin(entityTypes, eq(entityTypes.id, entities.entityTypeId))
    .where(eq(entities.id, entity.id));
  if (!state) throw httpError(404, "No entity exists with this id.");
  return {
    ...state,
    registerKind: entity.registerKind ?? state.typeRegisterKind,
    registerKindSource: entity.registerKind === null ? ("type" as const) : ("entity" as const),
    registerKindLockReason: state.registerKindLocked ? REGISTER_LOCK_REASON : null,
  };
}

export async function assertRegisterKind(db: Executor, entity: Entity, kind: RegisterKind) {
  if ((await entityRegisterState(db, entity)).registerKind !== kind)
    throw httpError(
      409,
      `This Entity does not keep a ${kind === "shares" ? "share" : kind} register.`,
    );
}

export async function registerKindPatch(
  tx: Executor,
  user: AuthenticatedUser,
  entity: Entity,
  typeKind: RegisterKind,
  body: { registerKind?: RegisterKind | null; headOfficeEntityId?: string | null },
) {
  const state = await entityRegisterState(tx, entity);
  const override =
    body.registerKind === undefined
      ? entity.registerKind
      : body.registerKind === typeKind
        ? null
        : body.registerKind;
  const kind = override ?? typeKind;
  if (kind !== state.registerKind && state.registerKindLocked)
    throw httpError(409, REGISTER_LOCK_REASON);
  if (body.headOfficeEntityId !== undefined && kind !== "none")
    throw httpError(409, "Only an Entity with no register can have a head office.");
  const headOffice =
    kind !== "none"
      ? null
      : body.headOfficeEntityId === undefined
        ? entity.headOfficeEntityId
        : body.headOfficeEntityId;
  if (headOffice !== null && headOffice !== entity.headOfficeEntityId) {
    if (headOffice === entity.id) throw httpError(409, "An Entity cannot be its own head office.");
    const target = await reachedEntity(tx, user, headOffice);
    if (!target || target.archivedAt)
      throw httpError(400, "Choose a live Entity you can open as the head office.");
    let next: string | null = headOffice;
    const visited = new Set<string>([entity.id]);
    while (next) {
      if (visited.has(next)) throw httpError(409, "The head office would create a loop.");
      visited.add(next);
      const [row] = await tx
        .select({ head: entities.headOfficeEntityId })
        .from(entities)
        .where(eq(entities.id, next));
      next = row?.head ?? null;
    }
  }
  const patch: Partial<Entity> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  if (override !== entity.registerKind) patch.registerKind = override;
  if (kind !== state.registerKind) {
    changed.registerKind = { from: state.registerKind, to: kind };
  }
  const source = override === null ? "type" : "entity";
  if (source !== state.registerKindSource)
    changed.registerKindSource = { from: state.registerKindSource, to: source };
  if (headOffice !== entity.headOfficeEntityId) {
    patch.headOfficeEntityId = headOffice;
    changed.headOfficeEntityId = { from: entity.headOfficeEntityId, to: headOffice };
  }
  return { patch, changed };
}

export async function changeTypeRegisterKind(tx: Executor, typeId: string, kind: RegisterKind) {
  const [type] = await tx.select().from(entityTypes).where(eq(entityTypes.id, typeId));
  if (!type || type.registerKind === kind) return {};
  const affected = await tx
    .select()
    .from(entities)
    .where(and(eq(entities.entityTypeId, typeId), sql`${entities.registerKind} is null`));
  const [held] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(entities)
    .where(
      and(
        eq(entities.entityTypeId, typeId),
        sql`${entities.registerKind} is null`,
        registerHasData,
      ),
    );
  if (held!.count)
    throw httpError(
      409,
      `${held!.count} ${held!.count === 1 ? "Entity holds" : "Entities hold"} register data. Their effective register kind cannot change.`,
    );
  return { type, affected };
}
