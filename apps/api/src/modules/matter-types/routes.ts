// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The matter-type taxonomy routes (MTR-001, #85): the shared taxonomy
 * machinery (`taxonomyRoutes`) mounted on `matter_types` with the
 * MTR-001 vocabulary — the point of #85 is that this file is
 * configuration, not a copy. The `other` row is system-protected;
 * every mutation is Administrator-only and audit-logged (DD-017) —
 * see the factory for the behavior set.
 */

import { matterTypes } from "@openlaw/db";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";

export const matterTypesRoutes = taxonomyRoutes({
  table: matterTypes,
  path: "matter-types",
  tag: "matter-types",
  idSingular: "MatterType",
  idPlural: "MatterTypes",
  keySingular: "matterType",
  keyPlural: "matterTypes",
  noun: "matter type",
  decision: "MTR-001",
  actionPrefix: "matter_type",
  recordsMilestone: "M22",
  recordNoun: { singular: "matter", plural: "matters" },
});
