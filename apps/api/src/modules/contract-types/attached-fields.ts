// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract type editor's attachment routes (CTR-016, #84): the
 * shared per-type field attachment machinery (`typeFieldRoutes`,
 * extracted with #85) mounted on `contract_type_fields` with the
 * CTR-016 scope rule — contract-scoped and global fields only; other
 * modules' scopes are refused. See the factory for the behavior set.
 */

import { contractTypeFields, contractTypes } from "@openlaw/db";
import { typeFieldRoutes } from "../../lib/type-field-routes.js";

export const attachedFieldsRoutes = typeFieldRoutes({
  typesTable: contractTypes,
  joinTable: contractTypeFields,
  path: "contract-types",
  tag: "contract-types",
  idInfix: "ContractType",
  noun: "contract type",
  attachableScopes: ["contract", "global"],
  scopeRefusal: "Only contract-scoped and global fields attach to contract types.",
  scopeSummary: "contract-scoped and global fields only (CTR-016)",
  actionPrefix: "contract_type_field",
  requiredMilestone: "M8",
});
