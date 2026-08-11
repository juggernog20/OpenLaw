// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The matter type editor's attachment routes (MTR-011, #85): the
 * shared per-type field attachment machinery (`typeFieldRoutes`)
 * mounted on `matter_type_fields`. The scope rule is global-only for
 * now: the `matter` field scope opens with the matter record milestone
 * (M22), which widens `attachableScopes` to match CTR-016's sibling
 * rule; contract-scoped fields are refused here for good. See the
 * factory for the behavior set.
 */

import { matterTypeFields, matterTypes } from "@openlaw/db";
import { typeFieldRoutes } from "../../lib/type-field-routes.js";

export const matterAttachedFieldsRoutes = typeFieldRoutes({
  typesTable: matterTypes,
  joinTable: matterTypeFields,
  path: "matter-types",
  tag: "matter-types",
  idInfix: "MatterType",
  noun: "matter type",
  attachableScopes: ["global"],
  scopeRefusal: "Only global fields attach to matter types until the matter milestone (M22).",
  scopeSummary: "global fields only until M22 opens the matter scope (MTR-011)",
  actionPrefix: "matter_type_field",
  requiredMilestone: "M22",
});
