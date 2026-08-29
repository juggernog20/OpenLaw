// SPDX-License-Identifier: AGPL-3.0-only

/** Entity Fields, the third record-type mount of the shared attachment machinery. */
import { entityTypeFields, entityTypes } from "@openlaw/db";
import { typeFieldRoutes } from "../../lib/type-field-routes.js";

export const entityAttachedFieldsRoutes = typeFieldRoutes({
  typesTable: entityTypes,
  joinTable: entityTypeFields,
  path: "entity-types",
  tag: "entity-types",
  idInfix: "EntityType",
  noun: "entity type",
  scopeRule: {
    scopes: ["entity", "global"],
    refusal: "Only entity-scoped and global fields attach to entity types.",
  },
  scopeSummary: "entity-scoped and global fields (ENT-001)",
  actionPrefix: "entity_type_field",
  requiredMilestone: "M27 record fields",
});
