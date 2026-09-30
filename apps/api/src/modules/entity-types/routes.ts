// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The entity-type taxonomy routes (ENT-001, #97): the shared taxonomy
 * machinery (`taxonomyRoutes`) mounted on `entity_types` with the
 * ENT-001 vocabulary — the fourth instance of #85's one machinery,
 * configuration, not a copy. The `other` row is system-protected;
 * every mutation is Administrator-only and audit-logged (DD-017) —
 * see the factory for the behavior set. This is the first mount whose
 * record milestone has landed (M7), so `usage` is armed: the in-use
 * counts are genuine queries over the registry and the SET-003 archive
 * guard is live (#100).
 */

import { entities, eq, entityTypes, REGISTER_KINDS, type EntityType } from "@openlaw/db";
import { recordActivity } from "../../lib/activity.js";
import { z } from "zod";
import { lockEntityRegisters, changeTypeRegisterKind } from "../../lib/entity-register-kind.js";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { entityTypeUsage } from "../entities/type-usage.js";

export const entityTypesRoutes = taxonomyRoutes({
  table: entityTypes,
  path: "entity-types",
  tag: "entity-types",
  idSingular: "EntityType",
  idPlural: "EntityTypes",
  keySingular: "entityType",
  keyPlural: "entityTypes",
  noun: "entity type",
  decision: "ENT-001",
  actionPrefix: "entity_type",
  recordNoun: { singular: "entity", plural: "entities" },
  usage: entityTypeUsage,
  protectedSlug: "other",
  lockMutation: lockEntityRegisters,
  extras: {
    rowSchema: { registerKind: z.enum(REGISTER_KINDS) },
    projectRow: (row) => ({ registerKind: (row as EntityType).registerKind }),
    patchSchema: { registerKind: z.enum(REGISTER_KINDS).optional() },
    async applyPatch({ tx, row, body, actorId }) {
      if (body.registerKind === undefined) return {};
      const result = await changeTypeRegisterKind(tx, row.id, body.registerKind);
      if (!result.type) return {};
      for (const entity of result.affected) {
        const changed: Record<string, { from: unknown; to: unknown }> = {
          registerKind: { from: result.type.registerKind, to: body.registerKind },
        };
        if (entity.headOfficeEntityId !== null && body.registerKind !== "none") {
          await tx
            .update(entities)
            .set({ headOfficeEntityId: null })
            .where(eq(entities.id, entity.id));
          changed.headOfficeEntityId = { from: entity.headOfficeEntityId, to: null };
        }
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId,
          action: "entity.updated",
          visibility: "legal_only",
          payload: { legalName: entity.legalName, changed },
        });
      }
      return {
        columns: { registerKind: body.registerKind },
        changed: { registerKind: { from: result.type.registerKind, to: body.registerKind } },
      };
    },
  },
});
