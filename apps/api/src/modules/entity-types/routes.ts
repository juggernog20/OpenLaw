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

import { entityTypes } from "@openlaw/db";
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
});
